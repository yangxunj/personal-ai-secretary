'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import BottomNavView from '@/components/navigation/shared/BottomNavView';

export default function BottomNav({ badge }: { badge?: number }) {
  const pathname = usePathname();
  const t = useT();
  return <BottomNavView pathname={pathname} badge={badge} t={t}
    renderItem={({ href, className, style, children }) =>
      <Link key={href} href={href} className={className} style={style}>{children}</Link>} />;
}
