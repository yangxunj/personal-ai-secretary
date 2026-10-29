'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

declare global {
  interface Window { desktopApp?: { openPhoneAccess(): Promise<void> } }
}

export default function PhoneAccessSettings() {
  const t = useT();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setAvailable(!!window.desktopApp?.openPhoneAccess); }, []);

  return <section className="surface border rounded-2xl p-4" style={{ borderColor: 'var(--border)' }}>
    <h2 className="text-[15px] font-semibold mb-2">{t('用手机访问')}</h2>
    {available ? <>
      <p className="muted text-[12px] leading-relaxed mb-3">{t('点击下方按钮，在弹出的桌面窗口中开启手机访问并扫码配对。只有配对过的设备可以访问。')}</p>
      <button type="button" className="w-full rounded-xl border py-2.5 text-[14px] text-brand-500" style={{ borderColor: 'var(--border)' }}
        onClick={async () => {
          setError('');
          try { await window.desktopApp!.openPhoneAccess(); }
          catch { setError(t('无法打开手机访问设置，请使用桌面程序顶部菜单「设置 → 用手机访问…」。')); }
        }}>{t('打开手机访问设置')}</button>
    </> : available === false ? <p className="muted text-[12px] leading-relaxed">
      {t('你当前通过浏览器访问，这里没有手机访问开关。请在电脑上的桌面程序顶部菜单「设置 → 用手机访问…」中开启并扫码配对。')}
    </p> : null}
    {error && <p role="alert" className="text-red-500 text-[12px] mt-2">{error}</p>}
  </section>;
}
