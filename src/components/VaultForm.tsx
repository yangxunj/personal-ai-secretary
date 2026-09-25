'use client';

import { useState } from 'react';
import { VAULT_CATEGORIES } from '@/lib/format';

export default function VaultForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [rows, setRows] = useState([0, 1]);

  return (
    <form action={action} className="space-y-3">
      <input
        name="title"
        required
        placeholder="名称，例如：招商银行储蓄卡"
        className="w-full rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500"
        style={{ borderColor: 'var(--border)' }}
      />
      <select name="category" className="w-full rounded-xl border px-3 py-2.5 bg-transparent" style={{ borderColor: 'var(--border)' }}>
        {VAULT_CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <div className="space-y-2">
        <p className="muted text-xs px-1">字段</p>
        {rows.map((r) => (
          <div key={r} className="flex gap-2">
            <input
              name="fieldLabel"
              placeholder="项目"
              className="w-1/3 rounded-xl border px-3 py-2.5 bg-transparent outline-none focus:border-brand-500"
              style={{ borderColor: 'var(--border)' }}
            />
            <input
              name="fieldValue"
              placeholder="内容"
              className="flex-1 rounded-xl border px-3 py-2.5 bg-transparent outline-none focus:border-brand-500"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((v) => [...v, v.length])}
          className="muted text-xs px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)' }}
        >
          + 加一行
        </button>
      </div>

      <textarea
        name="notes"
        rows={2}
        placeholder="备注（可选）"
        className="w-full rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500 resize-none"
        style={{ borderColor: 'var(--border)' }}
      />
      <input
        name="tags"
        placeholder="标签，逗号分隔（可选）"
        className="w-full rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500"
        style={{ borderColor: 'var(--border)' }}
      />
      <label className="flex items-center gap-2 text-sm px-1">
        <input type="checkbox" name="sensitive" className="h-4 w-4" />
        敏感信息（列表中默认打码）
      </label>
      <button className="w-full rounded-xl bg-brand-500 text-white font-medium py-2.5 active:bg-brand-700">
        保存
      </button>
    </form>
  );
}
