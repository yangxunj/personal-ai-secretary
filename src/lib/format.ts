const CN_DATE = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return CN_DATE.format(date);
}

export function sameDay(a: Date | string, b: Date | string) {
  const x = typeof a === 'string' ? new Date(a) : a;
  const y = typeof b === 'string' ? new Date(b) : b;
  return x.toDateString() === y.toDateString();
}

/** 记录页的日期分隔标签：今天 / 昨天 / 8月20日 */
export function dayLabel(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(date, today)) return '今天';
  if (sameDay(date, yesterday)) return '昨天';
  const sameYear = date.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat('zh-CN', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatDate(d: Date | string | null) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
}

export const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  todo: { label: '待办', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
  doing: { label: '进行中', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
  blocked: { label: '卡住了', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
  cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-500/15 dark:text-gray-400' },
};

export const CATEGORIES = ['健康', '保险', '出行', '教育', '财务', '证件', '居家', '其他'] as const;

// 任务负责人的候选名单不在这里 —— 在设置页改，存库里，见 lib/owners.ts

export const VAULT_CATEGORIES = [
  '银行', '学校', '证件', '住址', '公用事业', '税务', '保险', '医疗', '会员', '工作', '其他',
] as const;

/**
 * 文件大小。★ 原来放在 storage.ts —— 但那个模块 `import 'node:path'`，
 * 客户端组件（AttachmentRow）一引用就打包失败：
 * `UnhandledSchemeError: Reading from "node:path" is not handled by plugins`。
 * 它本身是个纯函数，本来就该待在 format 这边。
 * **教训：纯工具函数别跟带 node: 依赖的东西住同一个模块。**
 */
export function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
