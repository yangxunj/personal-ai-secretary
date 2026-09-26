import { db } from './db';
import { money, CATEGORY_LABELS } from './finance';
import { formatDate, TASK_STATUS } from './format';
import { getLocale, getT } from './i18n/server';

export type Hit = {
  id: string;
  title: string;
  snippet: string;
  meta: string;
  href: string;
};

export type Group = {
  kind: 'vault' | 'tasks' | 'docs' | 'transactions' | 'files' | 'messages';
  /** 显示用，已按界面语言翻好 */
  label: string;
  href: string;
  hits: Hit[];
};

type Field = { label: string; value: string; secret?: boolean };

const WHITESPACE = /\s+/g;
const PER_GROUP = 12;

/** 取关键词前后各 span 字，长文只给一段能看懂的上下文 */
export function makeSnippet(text: string | null | undefined, q: string, span = 40): string {
  if (!text) return '';
  const flat = text.replace(WHITESPACE, ' ').trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) {
    return flat.length > span * 2 ? flat.slice(0, span * 2) + '…' : flat;
  }
  const start = Math.max(0, i - span);
  const end = Math.min(flat.length, i + q.length + span);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

/**
 * 资料条目的片段：优先给出命中的那个字段。
 * 标了 secret 的只显示字段名不显示值 —— 搜索结果页会被扫一眼就走，
 * 密码留在资料页里点开看。
 */
function vaultSnippet(fieldsJson: string, notes: string | null, q: string): string {
  let fields: Field[] = [];
  try {
    fields = JSON.parse(fieldsJson || '[]');
  } catch {
    fields = [];
  }
  const lower = q.toLowerCase();
  const show = (f: Field) => `${f.label}：${f.secret ? '••••••' : f.value}`;

  const hit = fields.find((f) => `${f.label}${f.value}`.toLowerCase().includes(lower));
  if (hit) return show(hit);

  // 命中的是标题或备注时，仍然把前几个字段亮出来 —— 搜「门锁」是想直接看到电话，
  // 而不是看一段说明再点进去
  if (fields.length > 0) return fields.slice(0, 3).map(show).join(' · ');

  return notes ? makeSnippet(notes, q) : '';
}

export async function search(q: string): Promise<Group[]> {
  const like = { contains: q };
  const t = await getT();
  const locale = await getLocale();

  const [vaults, tasks, docs, txs, files, messages] = await Promise.all([
    db.vaultItem.findMany({
      where: { OR: [{ title: like }, { category: like }, { tags: like }, { notes: like }, { fields: like }] },
      orderBy: { updatedAt: 'desc' },
      take: PER_GROUP,
    }),
    db.task.findMany({
      where: { OR: [{ title: like }, { detail: like }, { result: like }, { category: like }] },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }],
      take: PER_GROUP,
    }),
    db.document.findMany({
      where: { OR: [{ title: like }, { summary: like }, { occasion: like }, { tags: like }, { body: like }] },
      orderBy: { updatedAt: 'desc' },
      take: PER_GROUP,
    }),
    db.transaction.findMany({
      where: { OR: [{ counterparty: like }, { label: like }, { kind: like }, { rawText: like }] },
      include: { statement: { select: { period: true } } },
      orderBy: { date: 'desc' },
      take: PER_GROUP,
    }),
    db.attachment.findMany({
      where: { OR: [{ filename: like }, { category: like }, { note: like }] },
      orderBy: { createdAt: 'desc' },
      take: PER_GROUP,
    }),
    db.message.findMany({
      where: { content: like },
      orderBy: { createdAt: 'desc' },
      take: PER_GROUP,
      include: { conversation: { select: { title: true } } },
    }),
  ]);

  const groups: Group[] = [
    {
      kind: 'vault',
      label: t('资料'),
      href: `/vault?q=${encodeURIComponent(q)}`,
      hits: vaults.map((v) => ({
        id: v.id,
        title: v.title,
        snippet: vaultSnippet(v.fields, v.notes, q),
        meta: t(v.category),
        href: `/vault?q=${encodeURIComponent(q)}`,
      })),
    },
    {
      kind: 'tasks',
      label: t('任务'),
      href: '/tasks',
      hits: tasks.map((x) => ({
        id: x.id,
        title: x.title,
        snippet: makeSnippet(x.result || x.detail, q),
        meta: `${TASK_STATUS[x.status] ? t(TASK_STATUS[x.status].label) : x.status} · ${t(x.category)}${x.dueDate ? ` · ${formatDate(x.dueDate, locale)}` : ''}`,
        href: '/tasks',
      })),
    },
    {
      kind: 'docs',
      label: t('文稿'),
      href: '/docs',
      hits: docs.map((d) => ({
        id: d.id,
        title: d.title,
        snippet: makeSnippet(d.body, q),
        meta: [d.category && t(d.category), d.occasion, formatDate(d.date, locale)].filter(Boolean).join(' · '),
        href: `/docs/${d.id}`,
      })),
    },
    {
      kind: 'transactions',
      label: t('交易'),
      href: '/finance',
      hits: txs.map((x) => ({
        id: x.id,
        title: x.counterparty || x.label || x.kind || t('交易'),
        snippet: makeSnippet(x.rawText, q),
        meta: `${formatDate(x.date, locale)} · ${x.direction === 'debit' ? t('支出') : t('收入')} ${money(x.amountCents)} · ${t(CATEGORY_LABELS[x.category] ?? x.category)}`,
        href: `/finance/${x.statement.period}`,
      })),
    },
    {
      kind: 'files',
      label: t('文件'),
      href: '/files',
      hits: files.map((f) => ({
        id: f.id,
        title: f.filename,
        snippet: f.note ?? '',
        meta: [f.category && t(f.category), formatDate(f.createdAt, locale)].filter(Boolean).join(' · '),
        href: `/api/files/${f.id}`,
      })),
    },
    {
      kind: 'messages',
      label: t('记录'),
      href: '/chat',
      hits: messages.map((m) => ({
        id: m.id,
        title: m.role === 'user' ? t('主人') : t('管家'),
        snippet: makeSnippet(m.content, q, 60),
        meta: [formatDate(m.createdAt, locale), m.conversation?.title].filter(Boolean).join(' · '),
        // 对话里说的 → 定位到那个对话的那一条；任务页的留言不属于任何对话 → 去任务页
        href: m.conversationId
          ? `/chat/${m.conversationId}?m=${m.id}`
          : m.taskId
            ? `/tasks/${m.taskId}`
            : '/chat',
      })),
    },
  ];

  return groups.filter((g) => g.hits.length > 0);
}
