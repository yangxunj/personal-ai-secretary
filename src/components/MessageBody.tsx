import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 对话气泡里的正文。
 *
 * 为什么需要它：记录页原来是 `whitespace-pre-wrap` 纯文本，而我写汇报时一直
 * 在用 `**重点**`、列表和表格 —— 主人在手机上看到的是一堆字面星号和挤成一团
 * 的竖线。资料库那次（见 Notes.tsx）修过同样的毛病，但只修了备注，记录页漏了，
 * 而记录页是底部第一个标签，是他最常看的地方。
 *
 * 为什么不复用 Notes：Notes 写死了 `muted` 色，只能用在浅色卡片上。气泡有两种
 * 底 —— 主人那侧是 brand-500 深蓝配白字。所以这里所有颜色都用 `inherit`，
 * 背景色用 `bg-black/10 dark:bg-white/10` 这种半透明叠加，深浅底上都成立。
 *
 * 开了 remarkGfm（Notes 没开）：汇报里真的会出现表格，比如两家医院参考范围
 * 对照。表格在 85% 宽的气泡里必然放不下，所以套一层横向滚动，
 * **让表格自己滚，不要把整个页面撑宽**。
 */
/**
 * 单个换行在 Markdown 里会被当成空格吞掉，但这些正文原来是按纯文本
 * (`whitespace-pre-wrap`) 写的 —— 待办清单一行一项、逐笔流水一行一笔，
 * 全靠单换行断行。直接交给 Markdown 会挤成一整段。
 *
 * 所以在行尾补两个空格（Markdown 的硬换行），**但跳过围栏代码块** ——
 * 那里面的空格是内容，不是格式。
 */
function keepLineBreaks(src: string) {
  return src
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, i) =>
      i % 2 === 1 ? chunk : chunk.replace(/([^\n])\n(?!\n)/g, '$1  \n')
    )
    .join('');
}

export default function MessageBody({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" className="underline underline-offset-2">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="px-1 py-0.5 rounded text-[13px] bg-black/10 dark:bg-white/10">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="my-2 p-2.5 rounded-lg overflow-x-auto text-[13px] bg-black/10 dark:bg-white/10">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 pl-3 border-l-2 border-current/30 opacity-90">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-current/20" />,
        // 标题在气泡里不该放大字号，按加粗段落处理
        h1: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
        h2: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
        h3: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
        // 表格自己横向滚动，别把页面撑宽
        table: ({ children }) => (
          <div className="my-2 -mx-1 px-1 overflow-x-auto">
            <table className="text-[13px] border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-current/25">{children}</thead>,
        th: ({ children }) => (
          <th className="text-left font-semibold px-2 py-1 whitespace-nowrap">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-2 py-1 align-top border-t border-current/10">{children}</td>
        ),
      }}
    >
      {keepLineBreaks(children)}
    </ReactMarkdown>
  );
}
