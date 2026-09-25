/**
 * 服务商预设，单独一个文件：设置页的客户端组件要用，而 ai-config.ts 引了 db，
 * 进不了浏览器。
 */

/**
 * 服务商预设。设置页上点一下就填好接口地址和模型名 —— 原来地址藏在
 * 「一般不用动」里，想换 DeepSeek 官方的人得自己知道地址是什么。
 *
 * 后端本来就是通用的 OpenAI 兼容协议，换服务商只是换这三个值。
 *
 * 能不能看图是**按模型**分的，不是按服务商：DeepSeek 官方的 `deepseek-flash`
 * （背后是 V4.1 Flash）能看图，`deepseek-v4-pro` 不能 —— 给后者发图整个请求报错。
 * 口径以官方价格页为准：https://api-docs.deepseek.com/quick_start/pricing
 * （2026-09 核对；`deepseek-chat` 那一代名字已经不在列表里了）。
 */
export const PROVIDERS = [
  {
    id: 'dashscope',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v4.1-flash',
    keyHint: '在阿里云百炼控制台申请，形如 sk-xxxxxxxx',
    // 百炼文档 FAQ 说「DeepSeek 模型仅支持文本输入」—— 过时了。2026-09-23 实测
    // deepseek-v4.1-flash 读截图里的金额读对了，跟 DeepSeek 官方 deepseek-flash 一样。
    textOnly: null,
    /**
     * 联网搜索：Chat Completions 加一个 `enable_search` 就行，模型自己判断要不要搜。
     * 2026-09-23 实测（deepseek-v4.1-flash）：问天气会搜、给出处；记待办照常调
     * 工具；问 1+1 不搜、token 不涨。跟 function tools 同时开没冲突。
     * 百炼的 Responses API + web_search 工具也能搜，但那要换一套协议，没必要。
     */
    search: { enable_search: true },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyHint: '在 platform.deepseek.com 的「API keys」里创建，形如 sk-xxxxxxxx',
    /** 这家里看不了图的模型 */
    textOnly: /pro/i,
    /**
     * DeepSeek 官方没有联网搜索。2026-09-23 拿官方 key 实测四种写法：
     * 什么都不加 / enable_search / web_search_options / Responses API + web_search，
     * 输入 token 全是 62、回答全是「没法联网」—— 参数被静默忽略，不报错。
     */
    search: null,
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'] | 'custom';

/** 按接口地址认出是哪家。认不出的算「自定义」 */
export function providerOf(baseUrl: string): ProviderId {
  let host = '';
  try {
    host = new URL(baseUrl).host;
  } catch {
    return 'custom';
  }
  return PROVIDERS.find((p) => new URL(p.baseUrl).host === host)?.id ?? 'custom';
}

/**
 * 当前模型能不能收图片。
 *
 * 只对**明确知道是纯文本**的模型返回 false；认不出的一律按「能」处理 ——
 * 猜错了顶多报个错让人看见，反过来猜错则是图片被静默丢掉。
 */
export function modelSeesImages(cfg: { baseUrl: string; model: string }): boolean {
  const p = PROVIDERS.find((x) => x.id === providerOf(cfg.baseUrl));
  return !(p?.textOnly && p.textOnly.test(cfg.model));
}

/** 能不能联网搜索 —— 能的话返回要并进请求体的参数 */
export function searchOptions(cfg: { baseUrl: string }): Record<string, unknown> | null {
  return PROVIDERS.find((x) => x.id === providerOf(cfg.baseUrl))?.search ?? null;
}
