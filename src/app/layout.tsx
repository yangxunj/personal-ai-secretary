import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/client';
import { clientDict, getLocale, getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('家庭管家'),
    description: t('私人生活秘书平台'),
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: t('家庭管家') },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#12151b' },
  ],
};

/**
 * 在 <head> 里同步跑，**必须在首次绘制之前** —— 否则手动选了浅色的人，
 * 在深色系统上会先闪一下深色再跳回来（FOUC），比不给选择还难受。
 *
 * 只写 data-theme 这一个明确的值（light / dark），system 在这里当场解析掉。
 * CSS 那边就只有一个来源，不用维护「媒体查询」和「手动选择」两套规则。
 *
 * try/catch 是必须的：隐身模式或禁用站点数据时读 localStorage 会直接抛异常，
 * 抛在这里会整页白屏。
 */
const THEME_INIT = `(function(){try{
var p=localStorage.getItem('theme')||'system';
var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme=d?'dark':'light';
}catch(e){document.documentElement.dataset.theme='light'}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale === 'en' ? 'en' : 'zh-CN'} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <I18nProvider locale={locale} dict={await clientDict()}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
