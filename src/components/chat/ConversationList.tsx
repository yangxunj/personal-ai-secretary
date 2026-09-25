'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { listConversations } from '@/app/(app)/chat/actions';
import type { ConversationItem } from '@/lib/conversations';
import { CONV_EVENT, type ConvEventDetail } from './events';

/**
 * 对话列表：按最后说话的时间分组（今天 / 昨天 / 7 天内 / 30 天内 / 更早），
 * 跟 ChatGPT、Vercel 的 Chatbot 模板一个路子。
 *
 * 当前是哪个对话看地址栏：新对话发出第一句后，地址是用 history.replaceState
 * 换成 /chat/<id> 的（不重新加载页面），usePathname 跟得上。
 */
export default function ConversationList({
  initial,
  onNavigate,
}: {
  initial: ConversationItem[];
  /** 手机上的抽屉点完一条要自己关掉 */
  onNavigate?: () => void;
}) {
  const [items, setItems] = useState(initial);
  /**
   * 乐观加上去、服务端还没建出来的新对话。
   * 第一句话一发出去就通知列表，可那时服务端多半还没 upsert 这个对话 ——
   * 紧接着拉回来的列表里没有它，直接 setItems 就把刚放上去的那条冲掉了。
   * 所以先记着，拉回来的列表里有了再撒手。
   */
  const optimistic = useRef(new Map<string, ConversationItem>());
  const pathname = usePathname();
  const activeId = pathname.startsWith('/chat/') ? pathname.slice('/chat/'.length).split('/')[0] : null;

  useEffect(() => setItems(initial), [initial]);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ConvEventDetail>).detail ?? {};
      if (d.id && d.removed) {
        optimistic.current.delete(d.id);
        setItems((xs) => xs.filter((x) => x.id !== d.id));
      } else if (d.id && d.title) {
        // 乐观更新：新对话一发出去就出现在最上面，标题回来了就换上
        if (d.provisional) {
          optimistic.current.set(d.id, { id: d.id, title: d.title, provisional: true, updatedAt: new Date().toISOString() });
        } else {
          optimistic.current.delete(d.id); // 标题都起好了，服务端肯定有它了
        }
        setItems((xs) => {
          const rest = xs.filter((x) => x.id !== d.id);
          const old = xs.find((x) => x.id === d.id);
          const keep = old && !old.provisional && d.provisional; // 已经有正式标题的，别被第一句话盖回去
          return [
            {
              id: d.id!,
              title: keep ? old.title : d.title!,
              provisional: keep ? false : !!d.provisional,
              updatedAt: new Date().toISOString(),
            },
            ...rest,
          ];
        });
      }
      // 不管有没有乐观更新，都跟服务端对一次：顺序、别的窗口里的改动
      listConversations()
        .then((server) => {
          const known = new Set(server.map((x) => x.id));
          for (const id of optimistic.current.keys()) if (known.has(id)) optimistic.current.delete(id);
          setItems([...optimistic.current.values(), ...server]);
        })
        .catch(() => {});
    };
    window.addEventListener(CONV_EVENT, on);
    return () => window.removeEventListener(CONV_EVENT, on);
  }, []);

  const groups = group(items);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <Link
          href="/chat"
          onClick={onNavigate}
          className="flex items-center justify-center gap-2 w-full rounded-xl border px-3 py-2.5 text-[14px] font-medium hover:border-brand-500 hover:text-brand-600 dark:hover:text-brand-300 transition"
          style={{ borderColor: 'var(--border)' }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新对话
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {items.length === 0 && <p className="muted text-[12px] text-center py-8">还没有对话</p>}
        {groups.map(([label, xs]) => (
          <div key={label} className="mt-3 first:mt-1">
            <p className="muted text-[11px] font-medium px-2.5 mb-1">{label}</p>
            {xs.map((c) => {
              const active = c.id === activeId;
              return (
                <Link
                  key={c.id}
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  title={c.title}
                  className={`block truncate rounded-lg px-2.5 py-2 text-[13.5px] transition ${
                    active ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300 font-medium' : 'hover:bg-brand-500/5'
                  } ${c.provisional && !active ? 'muted' : ''}`}
                >
                  {c.title}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function group(items: ConversationItem[]): [string, ConversationItem[]][] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const buckets: [string, (t: number) => boolean][] = [
    ['今天', (t) => t >= today],
    ['昨天', (t) => t >= today - DAY],
    ['7 天内', (t) => t >= today - 6 * DAY],
    ['30 天内', (t) => t >= today - 29 * DAY],
    ['更早', () => true],
  ];
  const out = new Map<string, ConversationItem[]>();
  for (const c of items) {
    const t = new Date(c.updatedAt).getTime();
    const label = buckets.find(([, f]) => f(t))![0];
    out.set(label, [...(out.get(label) ?? []), c]);
  }
  return buckets.map(([l]) => l).filter((l) => out.has(l)).map((l) => [l, out.get(l)!]);
}
