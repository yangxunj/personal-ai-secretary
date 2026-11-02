import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { TABS, NavIcon } from '@/components/nav-tabs';
import { listCollections } from '@/lib/collections/service';
import { getT } from '@/lib/i18n/server';
export const dynamic = 'force-dynamic';
export default async function MorePage() {
  const t = await getT(), collections = await listCollections();
  return <><PageHeader title={t('更多')} back="/chat" /><div className="p-4 space-y-3">
    {TABS.filter(tab => ['/files', '/pages', '/mail', '/collections'].includes(tab.href)).map(tab => <Link key={tab.href} href={tab.href} className="surface flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}><NavIcon name={tab.icon} className="h-5 w-5" />{t(tab.label)}</Link>)}
    {!!collections.length && <h2 className="font-semibold pt-3">{t('自定义栏目')}</h2>}
    {collections.map(collection => <Link key={collection.id} href={'/collections/' + collection.id} className="surface block rounded-xl border p-4 break-words" style={{ borderColor: 'var(--border)' }}>{collection.definition.title}</Link>)}
  </div></>;
}
