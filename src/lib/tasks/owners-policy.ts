import { makeT, type T } from '../i18n/core';

/** Shared owner-name validation. Removing a name never changes existing tasks. */
export function parseOwners(raw: string, t: T = makeT(null)):
  { ok: true; owners: string[] } | { ok: false; error: string } {
  const owners = [...new Set(raw.split(/[,，、\n]+/).map(name => name.trim()).filter(Boolean))];
  if (!owners.length) return { ok: false, error: t('至少留一个人') };
  if (owners.length > 12) return { ok: false, error: t('最多 {n} 个人', { n: 12 }) };
  const bad = owners.find(name => ['待定', '未指派', 'unassigned'].includes(name.toLowerCase()));
  if (bad) return { ok: false, error: t('「{name}」是没人认领时的显示，换个名字', { name: bad }) };
  const long = owners.find(name => name.length > 12);
  if (long) return { ok: false, error: t('「{name}」太长了，写个称呼就行', { name: long }) };
  return { ok: true, owners };
}
