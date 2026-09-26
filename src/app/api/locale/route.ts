import { getLocale } from '@/lib/i18n/server';

/**
 * 当前界面语言。给桌面外壳（desktop/main.js）用 —— 主进程读不到库，
 * 设置页切了语言后，它靠问这里把菜单换过来。
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ locale: await getLocale() });
}
