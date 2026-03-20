import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SIZE_CLASSES = {
  xs: 'prose-xs text-xs',
  sm: 'prose-sm text-sm',
  md: 'prose-base text-base',
}

export default function MarkdownRenderer({ content, size = 'xs', className = '' }) {
  if (!content || typeof content !== 'string') return null

  return (
    <div className={`prose max-w-none ${SIZE_CLASSES[size] || SIZE_CLASSES.xs} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5 text-slate-800">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold mt-2.5 mb-1 text-slate-800">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-semibold mt-2 mb-1 text-slate-700">{children}</h3>,
          p: ({ children }) => <p className="my-1 leading-relaxed text-slate-700">{children}</p>,
          ul: ({ children }) => <ul className="my-1 pl-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 pl-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-slate-700">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          em: ({ children }) => <em className="italic text-slate-600">{children}</em>,
          code: ({ children, className: codeClass, node, ...rest }) => {
            const isBlock = codeClass || (node?.position?.start?.line !== node?.position?.end?.line)
            if (!isBlock) {
              return <code className="px-1 py-0.5 bg-slate-100 rounded text-violet-700 text-[0.85em] font-mono">{children}</code>
            }
            return (
              <pre className="my-2 p-2.5 bg-slate-900 text-slate-100 rounded-lg overflow-x-auto text-[0.85em]">
                <code className={`font-mono ${codeClass || ''}`}>{children}</code>
              </pre>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 pl-3 border-l-2 border-violet-300 text-slate-600 italic">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="px-2 py-1 bg-slate-100 border border-slate-200 font-semibold text-left text-slate-700">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1 border border-slate-200 text-slate-600">{children}</td>,
          a: ({ href, children }) => <a href={href} className="text-violet-600 underline hover:text-violet-800" target="_blank" rel="noopener noreferrer">{children}</a>,
          hr: () => <hr className="my-2 border-slate-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
