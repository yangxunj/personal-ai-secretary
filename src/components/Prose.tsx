import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 长文阅读排版。
 *
 * 平台其他页面是为「扫一眼、拿走一个值」设计的，字号小、行距紧；文稿要从头
 * 读到尾，用的是另一套参数：字号更大、行距接近 2、段间距明确。别去复用别处的
 * 文字样式。
 */
export default function Prose({ children }: { children: string }) {
  return (
    <div className="text-[15.5px] leading-[1.95]" style={{ color: 'var(--text)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-[1.15em]">{children}</p>,
          h1: ({ children }) => <h1 className="text-lg font-semibold mt-8 mb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-7 mb-2.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[15px] font-semibold mt-6 mb-2">{children}</h3>,
          ul: ({ children }) => <ul className="my-[1.15em] pl-5 list-disc space-y-1.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-[1.15em] pl-5 list-decimal space-y-1.5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="my-8 border-0 border-t" style={{ borderColor: 'var(--border)' }} />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--color-brand-500)' }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote
              className="my-[1.3em] pl-4 border-l-2 muted"
              style={{ borderColor: 'var(--border)' }}
            >
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code
              className="text-[13px] px-1.5 py-0.5 rounded-md"
              style={{ background: 'var(--bg)' }}
            >
              {children}
            </code>
          ),
          // 宽内容自己横向滚动，别把整页撑得能左右拖
          table: ({ children }) => (
            <div className="my-[1.3em] -mx-4 px-4 overflow-x-auto">
              <table className="w-full text-sm border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th
              className="text-left font-medium px-3 py-2 border-b whitespace-nowrap"
              style={{ borderColor: 'var(--border)' }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b align-top" style={{ borderColor: 'var(--border)' }}>
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
