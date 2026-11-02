import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { listCollections } from '@/lib/collections/service';
import CollectionDesigner from '../CollectionDesigner';
export const dynamic = 'force-dynamic';
export default async function NewCollectionPage() {
  const t = await getT();
  return <><PageHeader title={t('新建栏目')} back="/collections" /><div className="p-4"><CollectionDesigner targets={await listCollections()} /></div></>;
}
