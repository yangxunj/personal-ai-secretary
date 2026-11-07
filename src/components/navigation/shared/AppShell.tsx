import type { ReactNode } from 'react';

/** The same responsive outer frame is used by web, Windows and Android. */
export default function AppShell({ banner, side, bottom, children }: {
  banner?: ReactNode; side: ReactNode; bottom: ReactNode; children: ReactNode;
}) {
  return <div className="min-h-dvh">
    {banner}{side}
    <div className="lg:pl-56">
      <div className="mx-auto max-w-2xl lg:max-w-5xl xl:max-w-6xl lg:has-[[data-wide]]:max-w-none pb-24 lg:pb-10">{children}</div>
    </div>
    {bottom}
  </div>;
}
