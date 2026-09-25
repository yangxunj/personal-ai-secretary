/**
 * 对话列表和对话本身之间的通知。
 *
 * 为什么不用 router.refresh()：刷新会让服务端重新读一遍历史传给 <Chat>，
 * 而 <Chat> 手里还有 useChat 内存里的同几条 —— 页面上就重复了。
 * 所以对话进行中，列表自己去拉（listConversations），对话本身不动。
 */
export const CONV_EVENT = 'conversations:changed';

export type ConvEventDetail = {
  /** 有 id + title 时列表先乐观地更新这一条，不等服务端 */
  id?: string;
  title?: string;
  provisional?: boolean;
  /** 删掉了 */
  removed?: boolean;
};

export function emitConversations(detail: ConvEventDetail = {}) {
  window.dispatchEvent(new CustomEvent<ConvEventDetail>(CONV_EVENT, { detail }));
}
