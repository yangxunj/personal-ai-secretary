import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { getT } from '@/lib/i18n/server';
import { listCollections } from '@/lib/collections/service';
import { collectionTemplates } from '@/lib/collections/templates';
import { installCollectionTemplateAction, toggleCollectionAction } from './actions';

export const dynamic = 'force-dynamic';
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = await getT(), collections = await listCollections(true), { error } = await searchParams;
  return <><PageHeader title={t('自定义栏目')} back="/more" />
    <div className="p-4 space-y-5">
      <p className="muted text-sm leading-relaxed">{t('用字段配置自己的档案和记录，界面与 AI 共用同一份数据。关闭栏目保留数据，重新启用即可继续使用。')}</p>
      <Link href="/collections/new" className="block rounded-xl bg-brand-500 p-3 text-center text-white">{t('新建空白栏目')}</Link>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <section className="space-y-3"><h2 className="font-semibold">{t('我的栏目')}</h2>
        {!collections.length && <p className="muted text-sm">{t('还没有自定义栏目，可以先用下方模板试试。')}</p>}
        {collections.map(collection => <article key={collection.id} className="surface rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between gap-3"><Link href={collection.draft || !collection.enabled ? '/collections/' + collection.id + '/configure' : '/collections/' + collection.id} className="min-w-0 break-words font-medium text-brand-500 dark:text-brand-300">{collection.definition.title}</Link><span className="shrink-0 text-xs muted">{collection.draft ? t('待确认草案') : collection.enabled ? t('已启用') : t('未启用')}</span></div>
          {collection.definition.description && <p className="mt-2 text-sm muted break-words">{collection.definition.description}</p>}
          <div className="mt-3 flex items-center gap-4 text-sm"><Link href={'/collections/' + collection.id + '/configure'} className="text-brand-500 dark:text-brand-300">{collection.draft ? t('审阅并确认') : t('配置栏目')}</Link>
            {!collection.draft && <form action={toggleCollectionAction}><input type="hidden" name="collectionId" value={collection.id} /><input type="hidden" name="version" value={collection.version} /><input type="hidden" name="enabled" value={String(!collection.enabled)} /><button className="muted">{collection.enabled ? t('停用') : t('启用')}</button></form>}
          </div>
        </article>)}
      </section>
      <section className="space-y-3"><h2 className="font-semibold">{t('从模板开始')}</h2>
        {collectionTemplates(t).map(template => <form key={template.id} action={installCollectionTemplateAction} className="surface rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
          <h3 className="font-medium">{template.title}</h3><p className="muted text-xs leading-relaxed">{template.description}</p><p className="muted text-xs">{t('创建两个空栏目，不包含示例记录，可以继续调整字段。')}</p>
          <button name="template" value={template.id} className="rounded-lg border px-3 py-2 text-sm text-brand-500 dark:text-brand-300" style={{ borderColor: 'var(--border)' }}>{t('使用模板')}</button>
        </form>)}
      </section>
    </div></>;
}
