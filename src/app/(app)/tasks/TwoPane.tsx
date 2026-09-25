/**
 * 任务页的宽屏骨架：左列表、右详情。
 *
 * **URL 方案没变** —— 还是 `/tasks` 和 `/tasks/<id>`，卡片上的链接一个字没改。
 * 宽屏时是 `/tasks/<id>` 这个路由自己把列表画在左边，不是列表页把详情塞进来。
 * 这么选是因为另外两条路都更贵：
 *
 * - 平行路由（`@detail` slot）要写 default.tsx、要处理软硬导航不一致，
 *   而且详情页还得能单独打开。
 * - 让卡片按屏幕宽度指向不同的地址，`<a href>` 做不到，得上客户端组件。
 *
 * 代价是**详情页要多跑一次列表的查询**。单人 SQLite，认了。
 *
 * 窄屏行为一行没改：`/tasks` 只有列表，`/tasks/<id>` 只有详情。
 */
export default function TwoPane({
  list,
  detail,
  /** 窄屏上这一屏该显示哪一栏 —— 另一栏在窄屏上完全不渲染 */
  narrow,
}: {
  list: React.ReactNode;
  detail: React.ReactNode;
  narrow: 'list' | 'detail';
}) {
  return (
    <div data-wide className="lg:grid lg:grid-cols-[24rem_1fr] xl:grid-cols-[28rem_1fr]">
      {/* 列表自己滚，详情跟着页面滚 —— 两栏各自很长，捆在一起滚的话
          翻详情翻到一半，左边列表早就滚出视野了。 */}
      <div
        className={`${narrow === 'list' ? '' : 'hidden'} lg:block lg:h-dvh lg:sticky lg:top-0 lg:overflow-y-auto lg:border-r`}
        style={{ borderColor: 'var(--border)' }}
      >
        {list}
      </div>
      {/* 详情限在阅读宽度内、靠左 —— 铺满 1200px 的正文一行读不完。 */}
      <div className={`min-w-0 ${narrow === 'detail' ? '' : 'hidden'} lg:block`}>
        <div className="lg:max-w-4xl lg:px-4">{detail}</div>
      </div>
    </div>
  );
}
