'use client';
import { useRef, useState, useTransition } from 'react';
import { postTaskMessage } from '@/app/(app)/actions';

/**
 * 任务留言框 —— 这一页上**唯一**跟管家说话的地方。
 *
 * ★ 原来是两个控件：留言列表上面一个「+ 交结果」（附件 + 一句话），
 * 下面一个留言框（一句话 + 发言人）。一件事两个入口、还分在一屏两端，
 * 主人说详情页「看着头晕」，这是其中一条。
 * **说一句话，或者带着文件说一句话，本来就是同一个动作**，合成一个。
 *
 * ★ 是留言板，不是聊天框 —— 发出去不会立刻有人答，所以按钮上写「留言」，
 * 发完给一句明确的「已留言，管家下次会看到」。**别做成气泡 + 转圈**，
 * 那会让人以为几秒后就有回复，然后干等。这是这个组件最重要的一条设计。
 *
 * 发言人默认取任务负责人。平台不做登录，没有「谁在问」这个概念，
 * 只能自己选；而管家回主人和回代办人，答案是不一样的。
 */
export default function TaskComposer({
  taskId,
  defaultSender,
  members,
}: {
  taskId: string;
  defaultSender: string | null;
  /** 设置页里填的家里人。负责人不在名单里（改过名、AI 写的）也补进来，否则下拉会显示成第一个人 */
  members: string[];
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [files, setFiles] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setDone(false);
        start(async () => {
          await postTaskMessage(fd);
          formRef.current?.reset();
          setFiles(0);
          setDone(true);
        });
      }}
      className="mt-3 surface border rounded-2xl p-3"
      style={{ borderColor: 'var(--border)' }}
    >
      <input type="hidden" name="taskId" value={taskId} />
      <textarea
        name="content"
        rows={3}
        disabled={pending}
        onInput={() => setDone(false)}
        placeholder="想问的、想说的、办事时发现的情况，写在这里。也可以只传文件。"
        className="w-full bg-transparent outline-none resize-y leading-relaxed placeholder:opacity-50 disabled:opacity-50"
      />

      {/* 手机上这个 input 直接调起相册和文件选择，截图可以直接选。
          ⚠ 藏在 label 里而不是裸露 —— 裸的 <input type=file> 在 iOS 上
          是个又宽又丑的原生控件，会把这个框撑成一张表单。 */}
      <div className="flex items-center gap-2 mt-1">
        <label className="inline-flex items-center gap-1.5 text-[11px] muted px-2 py-1 rounded-lg border cursor-pointer active:opacity-60"
          style={{ borderColor: 'var(--border)' }}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          {files > 0 ? `已选 ${files} 个文件` : '加文件'}
          <input
            type="file"
            name="files"
            multiple
            disabled={pending}
            onChange={(e) => {
              setFiles(e.target.files?.length ?? 0);
              setDone(false);
            }}
            className="hidden"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 mt-2">
        <label className="flex items-center gap-1.5 muted text-[11px]">
          <span className="shrink-0">留言人</span>
          <select
            name="sender"
            defaultValue={defaultSender ?? members[0]}
            disabled={pending}
            className="chip-select rounded-lg border px-2 py-1 disabled:opacity-50"
            style={{ borderColor: 'var(--border)' }}
          >
            {[...new Set([...members, ...(defaultSender ? [defaultSender] : [])])].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          {done && !pending && (
            <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
              已留言，管家下次会看到
            </span>
          )}
          <button
            disabled={pending}
            className="text-xs px-3.5 py-1.5 rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium active:opacity-60 disabled:opacity-50"
          >
            {pending ? (files > 0 ? '上传中…' : '发送中…') : '留言'}
          </button>
        </div>
      </div>
    </form>
  );
}
