'use client';
import { useTransition } from 'react';
import { updateTaskOwner } from '@/app/(app)/actions';

/** 「待定」就是 owner 为 null —— 不另立一个状态值，否则筛选那边要认两种「没人」。 */
const UNASSIGNED = '待定';

/**
 * 任务卡片上的负责人下拉。
 *
 * 换掉原来那排「派给主人」「派给代办人」「取消指派」按钮：三个按钮占掉小半行，
 * 而且**当前是谁**要去另一处的小胶囊上看 —— 看和改分在两个地方。
 * 一个下拉两件事一起办：框里显示的就是当前负责人，点开就能换。
 *
 * ⚠ 卡片整面盖着一层跳详情页的透明链接（z-[1]），所以这里必须 relative z-[2]，
 * 否则点下拉会跳走。
 */
export default function OwnerSelect({
  taskId,
  owner,
  members,
  className = '',
}: {
  taskId: string;
  owner: string | null;
  /** 设置页里填的家里人（lib/owners.ts），服务端取好传进来 */
  members: string[];
  className?: string;
}) {
  const [pending, start] = useTransition();
  const value = owner ?? UNASSIGNED;

  return (
    <span className={`relative z-[2] inline-flex items-center ${className}`}>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(() => {
            updateTaskOwner(taskId, v === UNASSIGNED ? null : v);
          });
        }}
        aria-label="负责人"
        className={`chip-select rounded-lg border pl-6 pr-6 py-1.5 active:opacity-60 disabled:opacity-50 ${
          owner
            ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium'
            : 'muted'
        }`}
        style={{ borderColor: 'var(--border)' }}
      >
        {/* ⚠ 当前负责人不在名单里（CLI/AI 写进来的名字、改过配置），也要进选项 ——
            否则 <select> 找不到这个值，就显示成第一项，看上去像是派给了别人。 */}
        {[...new Set([...members, ...(owner ? [owner] : []), UNASSIGNED])].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {/* 人像图标压在左边，让它在一排按钮里一眼认得出是「谁负责」而不是别的开关 */}
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-1.5 h-3.5 w-3.5 opacity-70"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </svg>
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
