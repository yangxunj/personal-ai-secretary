/**
 * 健康列表页和报告详情页共用的两张表。
 *
 * 放在一起是因为**两边必须一致**：列表页把「肾功能」排第一、详情页按字母序排，
 * 主人翻进去会以为是两份不同的报告。同理状态颜色，偏高在一页是红的、另一页
 * 是黄的，那这个颜色就不再有意义。
 */

export const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  high: { label: '偏高', cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200' },
  low: { label: '偏低', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200' },
  abnormal: { label: '异常', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-100' },
};

/**
 * 异常项的展示顺序。
 *
 * 默认按 category 字母序排的话，「肾功能」会掉到最后 —— 而主人那份报告里
 * 医生建议的第 2 条正是肾功能损害，最该先看到的东西反而在最底下。
 * 化验数值排前面、体格和影像所见排后面，大致对应「要不要复查」的紧迫度。
 *
 * **新增分类记得往这里补一行**，不然它会掉到队尾。
 */
export const CATEGORY_ORDER = [
  '肾功能', '肝功能', '血糖', '血脂', '血常规', '尿常规',
  '维生素', '骨密度', '甲状腺', '肿瘤标志物', '一般检查', '影像', '其他',
];

export const catRank = (c: string) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};
