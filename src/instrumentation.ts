/**
 * Next 在服务启动时调一次 register()。桌面端老用户的库在这里补表结构，
 * 见 lib/schema-upgrade.ts —— 必须赶在第一个页面查库之前。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { upgradeSchema } = await import('@/lib/schema-upgrade');
  try {
    const done = await upgradeSchema();
    if (done.length) console.log(`[schema] 已补上：${done.join('、')}`);
  } catch (e) {
    // 补不上也照常起服务：新装的库本来就是全的，别因为这一步整个起不来
    console.error('[schema] 表结构升级失败', e);
  }
  // 示例页面：新库放上，老库补没放过的（删掉的不回来）。见 lib/sample-pages.ts
  try {
    const { ensureSamplePages } = await import('@/lib/sample-pages');
    const added = await ensureSamplePages();
    if (added.length) console.log(`[samples] 放上示例页面：${added.join('、')}`);
  } catch (e) {
    console.error('[samples] 示例页面没放上', e);
  }
}
