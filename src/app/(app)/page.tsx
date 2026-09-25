import { redirect } from 'next/navigation';

/**
 * 首页 = 对话页。
 *
 * 这里原来是「记录」（消息时间线，主平台留下来的首页）。这一版的对话长在
 * 网页里，两个页面读的是同一张 Message 表，并排放着只有三个坏处：
 * 落地页在侧栏里一格都不亮、对话里发的附件要切到另一页才看得见、
 * 侧栏第一格「对话」点进去反而比首页显示得少。
 *
 * 所以合并到 `/chat`，这里只留一句 redirect —— 老书签和 `/api/files` 里
 * 写死的相对路径都还能用。
 */
export default function Home() {
  redirect('/chat');
}
