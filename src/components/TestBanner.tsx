import { IS_TEST } from '@/lib/instance';

/**
 * 测试实例顶部那条横幅。生产实例上什么都不渲染。
 *
 * **两个站长得一模一样，这条是唯一的区别。** 没有它，使用者迟早会把
 * 真的身份证号填进测试库（那个库开发者天天在看），或者在测试站里记了
 * 一堆真待办，然后发现生产站什么都没有。
 *
 * 所以它刻意做得难看又占地方：`sticky` 钉在顶上不随滚动消失，橙色，
 * 直接写明「开发者能看到」。这不是装饰，是安全提示。
 */
export default function TestBanner() {
  if (!IS_TEST) return null;
  return (
    <div
      className="sticky top-0 z-50 px-4 py-2 text-center text-xs font-medium leading-relaxed"
      style={{ background: '#b45309', color: '#fff' }}
    >
      测试环境 · 这里的数据开发者会看到 · <strong>别填真实证件号和卡号</strong>
    </div>
  );
}
