import { useState } from 'react'
import { Bot, MessageSquare, Wrench, Search, ChevronDown, ChevronRight, Clock, Cpu, DollarSign, CheckCircle, AlertCircle, Copy, Check } from 'lucide-react'
import { formatLabel } from './AgentFlowGraph'
import { formatLatency, formatCost } from '../utils/format'

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const doCopy = () => {
    navigator.clipboard.writeText(typeof text === 'string' ? text : JSON.stringify(text, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={doCopy} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  )
}

function Collapsible({ title, icon: Icon, count, defaultOpen, children, badge }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        <Icon size={14} className="text-slate-500" />
        <span className="text-xs font-semibold text-slate-700 flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-2xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">{count}</span>
        )}
        {badge}
      </button>
      {open && <div className="p-3 border-t border-slate-200 bg-white">{children}</div>}
    </div>
  )
}

function MessageBubble({ role, content }) {
  const isUser = role === 'user' || role === 'human'
  const isSystem = role === 'system'
  const truncated = typeof content === 'string' && content.length > 600
  const [expanded, setExpanded] = useState(false)
  const display = truncated && !expanded ? content.slice(0, 600) + '...' : content

  return (
    <div className={`rounded-lg p-2.5 text-xs ${
      isSystem ? 'bg-amber-50 border border-amber-200' :
      isUser ? 'bg-blue-50 border border-blue-200' :
      'bg-emerald-50 border border-emerald-200'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-2xs font-semibold uppercase tracking-wider ${
          isSystem ? 'text-amber-600' : isUser ? 'text-blue-600' : 'text-emerald-600'
        }`}>{role}</span>
        <CopyButton text={content} />
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-slate-700">{typeof display === 'string' ? display : JSON.stringify(display, null, 2)}</pre>
      {truncated && (
        <button onClick={() => setExpanded(!expanded)} className="text-2xs text-brand-600 hover:text-brand-700 mt-1 font-medium">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function formatJson(val) {
  if (val === null || val === undefined) return 'null'
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return val
    }
  }
  return JSON.stringify(val, null, 2)
}

export default function AgentDetailPanel({ event }) {
  if (!event) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm p-6">
        <div className="text-center">
          <Bot size={32} className="mx-auto mb-2 opacity-50" />
          <p>Press Play to step through the trace</p>
        </div>
      </div>
    )
  }

  const { agentId, llmCalls, toolCalls, ragQueries, totalTokens, totalCost, durationMs, status, inputs, outputs } = event

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={18} className="text-brand-600" />
        <h3 className="text-base font-bold text-slate-800">{formatLabel(agentId)}</h3>
        <span className={`ml-auto text-2xs font-medium px-2 py-0.5 rounded-full ${
          status === 'error' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {status === 'error' ? <AlertCircle size={10} className="inline mr-0.5" /> : <CheckCircle size={10} className="inline mr-0.5" />}
          {status || 'ok'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-50 rounded-lg p-2 text-center">
          <Clock size={12} className="mx-auto text-amber-500 mb-0.5" />
          <div className="text-xs font-semibold text-slate-700">{durationMs ? formatLatency(durationMs, 1).display : '-'}</div>
          <div className="text-2xs text-slate-400">Duration</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-2 text-center">
          <Cpu size={12} className="mx-auto text-blue-500 mb-0.5" />
          <div className="text-xs font-semibold text-slate-700">{totalTokens?.toLocaleString() || '0'}</div>
          <div className="text-2xs text-slate-400">Tokens</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-2 text-center">
          <DollarSign size={12} className="mx-auto text-emerald-500 mb-0.5" />
          <div className="text-xs font-semibold text-slate-700">{totalCost ? formatCost(totalCost).display : '$0'}</div>
          <div className="text-2xs text-slate-400">Cost</div>
        </div>
      </div>

      {llmCalls.length > 0 && (
        <Collapsible title="LLM Calls" icon={MessageSquare} count={llmCalls.length} defaultOpen={true}>
          <div className="space-y-3">
            {llmCalls.map((call, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between text-2xs text-slate-500">
                  <span className="font-medium bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{call.model}</span>
                  <span>{call.inputTokens + call.outputTokens} tokens &middot; {call.durationMs ? `${Math.round(call.durationMs)}ms` : ''}</span>
                </div>
                {call.promptMessages?.length > 0 && (
                  <div className="space-y-1.5">
                    {call.promptMessages.map((msg, j) => (
                      <MessageBubble key={j} role={msg.role || 'user'} content={msg.content || msg.text || JSON.stringify(msg)} />
                    ))}
                  </div>
                )}
                {call.completion && (
                  <div className="rounded-lg p-2.5 bg-emerald-50 border border-emerald-200 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-2xs font-semibold uppercase tracking-wider text-emerald-600">completion</span>
                      <CopyButton text={call.completion} />
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-slate-700">
                      {typeof call.completion === 'string' ? call.completion.slice(0, 1000) : JSON.stringify(call.completion, null, 2)?.slice(0, 1000)}
                      {typeof call.completion === 'string' && call.completion.length > 1000 ? '...' : ''}
                    </pre>
                  </div>
                )}
                {i < llmCalls.length - 1 && <hr className="border-slate-100" />}
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {toolCalls.length > 0 && (
        <Collapsible title="Tool Calls" icon={Wrench} count={toolCalls.length} defaultOpen={true}>
          <div className="space-y-3">
            {toolCalls.map((call, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded">{call.toolName}</span>
                  <div className="flex items-center gap-2 text-2xs text-slate-500">
                    {call.durationMs ? <span>{Math.round(call.durationMs)}ms</span> : null}
                    <span className={call.status === 'error' ? 'text-red-500' : 'text-emerald-500'}>
                      {call.status === 'error' ? 'failed' : 'ok'}
                    </span>
                  </div>
                </div>
                {call.toolInput && (
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-2xs font-semibold text-slate-500">INPUT</span>
                      <CopyButton text={call.toolInput} />
                    </div>
                    <pre className="text-2xs font-mono text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{formatJson(call.toolInput)}</pre>
                  </div>
                )}
                {call.toolOutput && (
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-2xs font-semibold text-slate-500">OUTPUT</span>
                      <CopyButton text={call.toolOutput} />
                    </div>
                    <pre className="text-2xs font-mono text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{formatJson(call.toolOutput)}</pre>
                  </div>
                )}
                {i < toolCalls.length - 1 && <hr className="border-slate-100" />}
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {ragQueries.length > 0 && (
        <Collapsible title="RAG Queries" icon={Search} count={ragQueries.length} defaultOpen={true}>
          <div className="space-y-3">
            {ragQueries.map((q, i) => (
              <div key={i} className="space-y-1.5">
                <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
                  <span className="text-2xs font-semibold text-amber-600">QUERY</span>
                  <p className="text-xs text-slate-700 mt-0.5">{q.query || 'N/A'}</p>
                </div>
                {q.documents?.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                    <span className="text-2xs font-semibold text-slate-500">RETRIEVED ({q.documents.length} docs)</span>
                    <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                      {q.documents.slice(0, 5).map((doc, j) => (
                        <div key={j} className="text-2xs font-mono text-slate-600 bg-white rounded p-1.5 border border-slate-100">
                          {typeof doc === 'string' ? doc.slice(0, 200) : JSON.stringify(doc, null, 2)?.slice(0, 200)}
                          {(typeof doc === 'string' ? doc.length : JSON.stringify(doc)?.length || 0) > 200 ? '...' : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {q.durationMs ? <span className="text-2xs text-slate-400">{Math.round(q.durationMs)}ms</span> : null}
                {i < ragQueries.length - 1 && <hr className="border-slate-100" />}
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {llmCalls.length === 0 && toolCalls.length === 0 && ragQueries.length === 0 && (
        <div className="text-center py-6 text-slate-400 text-sm">
          <p>No LLM calls, tool calls, or RAG queries recorded for this agent step.</p>
        </div>
      )}
    </div>
  )
}
