'use client';
import { useTransition } from 'react';
import { updateTaskStatus } from '@/app/(app)/actions';

/**
 * 卡片右下角的状态下拉，挨着负责人那个。未开始 / 进行中 / 已完成 随便切。
 *
 * 我先后否过两次（先说「进行中只有 4/64 不值当」，后说「三个控件挤坏了标签」），
 * 主人三次都要这个，所以按他的来。而且他这版把我第二个理由解掉了：
 * **「已完成」是下拉里的一项，那个「完成」按钮就没了** —— 右边还是两个控件，
 * 反而比「负责人 + 开关 + 完成」窄。「重新打开」也一并没了，
 * done 的任务直接在这里切回未开始。
 *
 * ⚠ 卡片整面盖着跳详情页的透明链接（z-[1]），所以要 relative z-[2]。
 */
const OPTIONS = [
  { value: 'todo', label: '未开始' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
] as const;

export default function StatusSelect({ taskId, status }: { taskId: string; status: string }) {
  const [pending, start] = useTransition();

  // 「已取消」不进常规选项（主人要的是三个），但库里真有 4 条是 cancelled ——
  // 当前值不在 options 里，<select> 会显示成空白。所以只在它本来就是这个值的
  // 时候补上，既不给正常任务多一项，也不出现空白框。
  const options = OPTIONS.some((o) => o.value === status)
    ? OPTIONS
    : [{ value: status, label: status === 'cancelled' ? '已取消' : status }, ...OPTIONS];

  return (
    // ⚠ 外面这层 relative 是给箭头用的：globals.css 的 .chip-select 里有
    // appearance:none，浏览器原生的下拉箭头被关掉了，得自己画一个绝对定位上去
    // （负责人那个下拉是同一套做法）。少了它，pr-6 留出来的位置就是一块空白，
    // 看不出这一格能点开。
    <span className="relative z-[2] inline-flex items-center">
    <select
      value={status}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        start(() => void updateTaskStatus(taskId, v));
      }}
      aria-label="状态"
      className={`chip-select rounded-lg border px-2.5 pr-6 py-1.5 active:opacity-60 disabled:opacity-50 ${
        status === 'doing'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium'
          : status === 'done'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium'
            : 'muted'
      }`}
      style={{ borderColor: 'var(--border)' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-1.5 h-3 w-3 opacity-60"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
