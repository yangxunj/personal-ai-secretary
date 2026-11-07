import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import MoreNavigationView from '@/components/navigation/shared/MoreNavigationView';
import { listCollections } from '@/lib/collections/service';
import { getT } from '@/lib/i18n/server';
export const dynamic = 'force-dynamic';
export default async function MorePage() {
  const t = await getT(), collections = await listCollections();
  return <><PageHeader title={t('更多')} back="/chat" /><div className="p-4 space-y-3">
    <MoreNavigationView t={t} renderItem={({ href, children }) => <Link key={href} href={href} className="surface flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>{children}</Link>} />
    {!!collections.length && <h2 className="font-semibold pt-3">{t('自定义栏目')}</h2>}
    {collections.map(collection => <Link key={collection.id} href={'/collections/' + collection.id} className="surface block rounded-xl border p-4 break-words" style={{ borderColor: 'var(--border)' }}>{collection.definition.title}</Link>)}
  </div></>;
}
