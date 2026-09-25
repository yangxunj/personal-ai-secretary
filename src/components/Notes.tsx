import ReactMarkdown from 'react-markdown';

/**
 * 卡片备注的排版。
 *
 * 为什么不复用 Prose：Prose 是长文阅读的参数（字号 15.5、行距 1.95、段距一整行），
 * 塞进资料卡片里会把一条两行的提醒撑成半屏。这里要的是「紧凑但能强调」。
 *
 * 为什么非要渲染 Markdown：备注里一直在写 `**重点**`，而原来是
 * `whitespace-pre-wrap` 纯文本 —— 主人在手机上看到的是一堆字面的星号，
 * 该被强调的那句反而最难读。截图之后才发现，五条资料都中招。
 *
 * 只开常用的几样（粗体、列表、行内代码、链接），不加 remarkGfm ——
 * 备注里不会出现表格，多引一个包只是多一份体积。
 */
export default function Notes({ children }: { children: string }) {
  return (
    <div className="muted text-sm mt-3 leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: 'var(--text)' }}>
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-2 pl-4 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 pl-4 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded text-[13px]" style={{ background: 'var(--bg)' }}>
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" className="underline underline-offset-2">
              {children}
            </a>
          ),
          // 备注里不该出现标题，真写了就按加粗段落处理，别撑出大字号
          h1: ({ children }) => <p className="my-2 font-semibold" style={{ color: 'var(--text)' }}>{children}</p>,
          h2: ({ children }) => <p className="my-2 font-semibold" style={{ color: 'var(--text)' }}>{children}</p>,
          h3: ({ children }) => <p className="my-2 font-semibold" style={{ color: 'var(--text)' }}>{children}</p>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
