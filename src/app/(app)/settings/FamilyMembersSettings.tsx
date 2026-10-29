'use client';

import { startTransition, useActionState, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { saveOwnersAction, type OwnersSaveResult } from './actions';

export default function FamilyMembersSettings({ owners }: { owners: string[] }) {
  const t = useT();
  const nextId = useRef(owners.length);
  const [members, setMembers] = useState(() => owners.map((name, id) => ({ id, name })));
  const [dirty, setDirty] = useState(false);
  const [result, save, pending] = useActionState<OwnersSaveResult, FormData>(saveOwnersAction, { ok: false, message: '' });

  return <section id="members" className="surface border rounded-2xl p-4 scroll-mt-4" style={{ borderColor: 'var(--border)' }}>
    <h2 className="text-[15px] font-semibold mb-1">{t('家里的人')}</h2>
    <p id="members-hint" className="muted text-[12px] leading-relaxed mb-3">{t('每人一行，填写姓名或常用称呼。标为“自己”的成员用于留言署名，AI 也会按这份名单填写任务负责人。')}</p>
    <form onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setDirty(false);
      startTransition(() => save(form));
    }}>
      <fieldset disabled={pending} className="min-w-0 space-y-3">
        <legend className="sr-only">{t('家里的人')}</legend>
        <ul className="space-y-2" aria-describedby="members-hint">
          {members.map((member, index) => <li key={member.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label htmlFor={`member-${member.id}`} className="text-[12px] muted">{t('成员 {n}', { n: index + 1 })}</label>
              {index === 0
                ? <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[12px] text-brand-500 dark:text-brand-300">{t('自己')}</span>
                : <button type="button" className="text-[12px] text-brand-500 dark:text-brand-300" aria-label={t('将成员 {n} 设为自己', { n: index + 1 })} onClick={() => {
                  setMembers([member, ...members.filter(item => item.id !== member.id)]);
                  setDirty(true);
                }}>{t('设为自己')}</button>}
            </div>
            <div className="flex items-center gap-2">
              <input id={`member-${member.id}`} name="owners" value={member.name} required maxLength={12} pattern="[^,，、\r\n]+"
                title={t('每行只填一个称呼，不需要逗号或顿号。')} placeholder={t('输入姓名或称呼')}
                autoFocus={member.id >= owners.length}
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 bg-transparent outline-none focus:border-brand-500"
                style={{ borderColor: 'var(--border)' }}
                onChange={event => {
                  setMembers(members.map(item => item.id === member.id ? { ...item, name: event.target.value } : item));
                  setDirty(true);
                }} />
              <button type="button" disabled={members.length === 1} aria-label={t('移除成员 {n}', { n: index + 1 })}
                className="shrink-0 rounded-lg px-2 py-2 text-[12px] text-red-600 dark:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={() => {
                  setMembers(members.filter(item => item.id !== member.id));
                  setDirty(true);
                }}>{t('移除')}</button>
            </div>
          </li>)}
        </ul>
        <button type="button" disabled={members.length >= 12}
          className="w-full rounded-xl border border-dashed py-2.5 text-sm text-brand-500 dark:text-brand-300 disabled:opacity-40"
          style={{ borderColor: 'var(--border)' }} onClick={() => {
            setMembers([...members, { id: nextId.current++, name: '' }]);
            setDirty(true);
          }}>{t('添加成员')}</button>
        <p className="muted text-[11px]">{t('最多 12 人，每个称呼最多 12 个字。移除自己后，列表中的下一位会成为自己。')}</p>
      </fieldset>
      {result.message && !dirty && <p role={result.ok ? 'status' : 'alert'} className={`text-[13px] mt-3 ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{result.message}</p>}
      <button type="submit" disabled={pending} aria-busy={pending} className="mt-3 w-full rounded-xl bg-brand-500 text-white py-2.5 text-[15px] disabled:opacity-50">
        {pending ? t('正在保存…') : t('保存')}
      </button>
    </form>
    <p className="muted text-[11px] leading-relaxed mt-3">{t('改名或删掉一个人，已经派给他的任务不会跟着变，还挂在原来的名字下。')}</p>
  </section>;
}
