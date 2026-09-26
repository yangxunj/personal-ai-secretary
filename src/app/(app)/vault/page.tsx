import { db } from '@/lib/db';
import { createVaultItem, deleteVaultItem } from '../actions';
import PageHeader from '@/components/PageHeader';
import FormDialog from '@/components/FormDialog';
import VaultForm from '@/components/VaultForm';
import SecretValue from '@/components/SecretValue';
import ImageGallery from '@/components/ImageGallery';
import Notes from '@/components/Notes';
import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

type Field = { label: string; value: string; secret?: boolean };

const splitTags = (s: string) => s.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; q?: string; t?: string }>;
}) {
  const { c, q, t: tag } = await searchParams;
  const t = await getT();

  const items = await db.vaultItem.findMany({
    where: {
      ...(c ? { category: c } : {}),
      // 标签筛选。tags 是逗号分隔的字符串，contains 会命中「主人」也命中「主人」，
      // 对「按人看证件」这个用法来说宽一点反而好用，不做精确匹配。
      ...(tag ? { tags: { contains: tag } } : {}),
      ...(q
        ? { OR: [{ title: { contains: q } }, { notes: { contains: q } }, { tags: { contains: q } }, { fields: { contains: q } }] }
        : {}),
    },
    orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    include: { attachments: true },
  });

  const all = await db.vaultItem.groupBy({ by: ['category'], _count: true });

  return (
    <>
      <PageHeader
        title={t('资料库')}
        subtitle={tag ? t('标签「{tag}」· {n} 条', { tag, n: items.length }) : t('{n} 条记录', { n: items.length })}
        action={
          <FormDialog label={t('+ 新建')} title={t('新建资料')}>
            <VaultForm action={createVaultItem} />
          </FormDialog>
        }
      />

      <div className="px-4 py-3 space-y-3">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder={t('搜索账号、地址、号码…')}
            className="flex-1 rounded-xl border px-4 py-2.5 bg-transparent outline-none focus:border-brand-500"
            style={{ borderColor: 'var(--border)' }}
          />
          {c && <input type="hidden" name="c" value={c} />}
          {tag && <input type="hidden" name="t" value={tag} />}
        </form>

        {tag && (
          <Link
            href={c ? `/vault?c=${encodeURIComponent(c)}` : '/vault'}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand-500 text-white"
          >
            {t('标签：')}{tag}
            <span className="opacity-70">×</span>
          </Link>
        )}

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          <Link
            href={tag ? `/vault?t=${encodeURIComponent(tag)}` : '/vault'}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${!c ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
            style={!c ? undefined : { borderColor: 'var(--border)' }}
          >
            {t('全部')}
          </Link>
          {all.map((g) => (
            <Link
              key={g.category}
              href={`/vault?c=${encodeURIComponent(g.category)}${tag ? `&t=${encodeURIComponent(tag)}` : ''}`}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border ${c === g.category ? 'bg-brand-500 text-white border-brand-500' : 'muted'}`}
              style={c === g.category ? undefined : { borderColor: 'var(--border)' }}
            >
              {t(g.category)} {g._count}
            </Link>
          ))}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2">
        {items.length === 0 && (
          <p className="muted text-sm text-center py-20 leading-relaxed">
            {t('资料库还是空的。')}
            <br />
            {t('银行账号、学校账号、住址、证件号都可以存在这里。')}
          </p>
        )}

        {items.map((item) => {
          let fields: Field[] = [];
          try {
            fields = JSON.parse(item.fields);
          } catch {}
          // 图片走图片墙（缩略图 + 页内大图），PDF 之类仍旧是文字链接 ——
          // 证件是看图的，合同是下载的，两种场景不该长一个样
          const shots = item.attachments
            .filter((a) => a.mimeType.startsWith('image/'))
            .map((a) => ({ id: a.id, label: a.note || a.filename }));
          const docs = item.attachments.filter((a) => !a.mimeType.startsWith('image/'));
          return (
            <div key={item.id} className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium leading-snug">{item.title}</h3>
                  <span className="muted text-[11px] flex items-center gap-1">
                    {t(item.category)}
                    {item.sensitive && (
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                    )}
                  </span>
                </div>
                <form action={deleteVaultItem.bind(null, item.id)} className="shrink-0">
                  <button className="muted text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap" style={{ borderColor: 'var(--border)' }}>
                    {t('删除')}
                  </button>
                </form>
              </div>

              {fields.length > 0 && (
                <dl className="mt-3 space-y-1.5">
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      {/* w-24 才装得下「学生登入名称」这种六字标签 */}
                      <dt className="muted shrink-0 w-24 text-[13px] leading-5">{f.label}</dt>
                      <dd className="min-w-0 flex-1">
                        {/* 只打码字段自己标了 secret 的（密码类），
                            网址和登入名称照常显示，否则一整条都成了圆点 */}
                        <SecretValue value={f.value} masked={!!f.secret} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {shots.length > 0 && <ImageGallery shots={shots} />}

              {docs.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {docs.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/files/${a.id}`}
                      target="_blank"
                      className="flex items-start gap-2.5 rounded-xl px-3 py-2 active:opacity-70 transition"
                      style={{ background: 'var(--bg)' }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5" />
                      </svg>
                      <span className="text-xs break-all">{a.note || a.filename}</span>
                    </a>
                  ))}
                </div>
              )}

              {item.notes && <Notes>{item.notes}</Notes>}

              {item.tags && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {splitTags(item.tags).map((x) => (
                    <Link
                      key={x}
                      href={`/vault?t=${encodeURIComponent(x)}`}
                      className="muted text-[11px] px-2 py-0.5 rounded-md active:opacity-60"
                      style={{ background: 'var(--bg)' }}
                    >
                      {x}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
