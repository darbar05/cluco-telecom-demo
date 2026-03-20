import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getLLMCalls, getProducts } from '../api'
import { Zap, ChevronDown, ChevronRight, Bot, Copy, Check, DollarSign, Hash, Clock } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeleton'
import Pagination from '../components/ui/Pagination'
import { useClientPagination } from '../hooks/useClientPagination'
import { formatNumber, formatCost } from '../utils/format'

function ExpandableRow({ call }) {
  const [open, setOpen] = useState(false)
  // Prefer top-level (enriched from API), then nested llm — same shape as stored in MongoDB
  const promptMessages = call.prompt_messages ?? call.llm?.prompt_messages ?? []
  const completion = call.completion ?? call.response ?? call.llm?.completion ?? ''
  const hasMessages = Array.isArray(promptMessages) ? promptMessages.length > 0 : !!call.prompt
  const hasCompletion = !!completion

  const promptPreview =
    call.prompt_preview ??
    (Array.isArray(promptMessages) && promptMessages.length > 0
      ? (promptMessages[promptMessages.length - 1]?.content ?? '').slice(0, 80)
      : (call.prompt ?? promptMessages[0]?.content ?? '').slice(0, 80))

  return (
    <>
      <tr className={`cursor-pointer ${open ? 'bg-brand-50/30' : ''}`} onClick={() => setOpen(!open)}>
        <td className="!px-3">
          <span className="text-slate-400">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </td>
        <td>
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-brand-500" />
            <span className="font-medium text-slate-800">{call.model ?? call.llm?.model ?? '-'}</span>
          </div>
        </td>
        <td>
          {(call.parent_agent ?? call.agent_name) ? (
            <span className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{call.parent_agent || call.agent_name}</span>
          ) : <span className="text-slate-400 text-xs">-</span>}
        </td>
        <td className="text-right font-mono text-xs">
          <span className="text-slate-500">{call.input_tokens ?? call.llm?.input_tokens ?? 0}</span>
          <span className="text-slate-300 mx-1">/</span>
          <span className="text-slate-700">{call.output_tokens ?? call.llm?.output_tokens ?? 0}</span>
        </td>
        <td className="text-right">
          <span className="text-emerald-600 font-mono text-xs font-medium">${(call.cost_usd ?? call.llm?.cost_usd ?? 0).toFixed(4)}</span>
        </td>
        <td className="text-right font-mono text-xs">{(call.latency_ms ?? call.duration_ms ?? 0).toFixed(0)} ms</td>
        <td>
          <Link
            to={`/trace/${call.trace_id}`}
            className="text-brand-600 hover:text-brand-700 font-mono text-xs transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {call.trace_id?.slice(0, 16)}...
          </Link>
        </td>
        <td className="text-slate-500 text-xs truncate max-w-[200px]" title={promptPreview || undefined}>
          {promptPreview || '-'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="!p-0">
            <div className="p-5 bg-surface-1 border-t border-slate-100 space-y-4 animate-fade-in">
              {(hasMessages || call.prompt) && (
                <div>
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Prompt / Messages {Array.isArray(promptMessages) ? `(${promptMessages.length})` : ''}
                  </h4>
                  {Array.isArray(promptMessages) && promptMessages.length > 0 ? (
                    <div className="space-y-2">
                      {promptMessages.map((msg, mi) => {
                        const role = (msg.role || 'unknown').toLowerCase()
                        const colors = {
                          system: 'bg-amber-50 border-amber-200 text-amber-800',
                          human: 'bg-blue-50 border-blue-200 text-blue-800',
                          user: 'bg-blue-50 border-blue-200 text-blue-800',
                          ai: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                          assistant: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                        }
                        const label = role === 'user' ? 'human' : role === 'assistant' ? 'ai' : role
                        return (
                          <div key={mi} className={`rounded-lg border p-3 ${colors[label] || colors[role] || 'bg-slate-50 border-slate-200 text-slate-800'}`}>
                            <span className="text-xs font-semibold uppercase tracking-wider block mb-1">{label}</span>
                            <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed max-h-[400px] overflow-y-auto">{msg.content ?? JSON.stringify(msg)}</pre>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="content-block">
                      <pre className="max-h-64 overflow-auto">{call.prompt || '-'}</pre>
                    </div>
                  )}
                </div>
              )}
              {hasCompletion && (
                <div>
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Completion</h4>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 block mb-1">assistant</span>
                    <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-emerald-800 max-h-[400px] overflow-y-auto">
                      {typeof completion === 'object' ? JSON.stringify(completion, null, 2) : completion}
                    </pre>
                  </div>
                </div>
              )}
              {!hasMessages && !call.prompt && !hasCompletion && (
                <p className="text-slate-400 text-sm italic">No prompt or completion data for this call.</p>
              )}
              <div className="flex gap-4 text-xs text-slate-400">
                {(call.parent_agent || call.agent_name) && <span>Agent: <span className="badge-brand">{call.parent_agent || call.agent_name}</span></span>}
                {call.span_id && <span>Span: <span className="font-mono">{call.span_id}</span></span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function LLMCallsPage() {
  const [allCalls, setAllCalls] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const { page, setPage, pageSize, setPageSize, totalItems, paginatedData: calls, resetPage } = useClientPagination(allCalls)

  const load = async () => {
    setLoading(true)
    try {
      const [cr, pr] = await Promise.all([
        getLLMCalls({ product_id: productFilter || undefined, limit: 500 }),
        getProducts()
      ])
      setAllCalls(cr.data.llm_calls || cr.data.calls || [])
      setProducts(pr.data.products || [])
      resetPage()
    } catch (e) {
      setAllCalls([])
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productFilter])

  const summary = useMemo(() => {
    let inputTokens = 0, outputTokens = 0, totalCost = 0, totalLatency = 0
    for (const c of allCalls) {
      inputTokens += (c.input_tokens ?? c.llm?.input_tokens ?? 0)
      outputTokens += (c.output_tokens ?? c.llm?.output_tokens ?? 0)
      totalCost += (c.cost_usd ?? c.llm?.cost_usd ?? 0)
      totalLatency += (c.latency_ms ?? c.duration_ms ?? 0)
    }
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, totalCost, avgLatency: allCalls.length ? totalLatency / allCalls.length : 0 }
  }, [allCalls])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="LLM Calls"
        subtitle="Inspect individual LLM invocations across all traces"
        icon={Zap}
        actions={
          <FilterBar onRefresh={load}>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
          </FilterBar>
        }
      />

      {loading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : allCalls.length === 0 ? (
        <EmptyState icon={Zap} title="No LLM calls found" description="LLM calls will appear here once traces with LLM spans are ingested." />
      ) : (
        <>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="card p-3 flex items-center gap-3">
            <Zap size={16} className="text-violet-500" />
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Total Calls</div>
              <div className="text-lg font-bold text-violet-700">{allCalls.length}</div>
            </div>
          </div>
          <div className="card p-3 flex items-center gap-3">
            <Hash size={16} className="text-blue-500" />
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Input Tokens</div>
              <div className="text-lg font-bold text-blue-700">{formatNumber(summary.inputTokens).display}</div>
            </div>
          </div>
          <div className="card p-3 flex items-center gap-3">
            <Hash size={16} className="text-indigo-500" />
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Output Tokens</div>
              <div className="text-lg font-bold text-indigo-700">{formatNumber(summary.outputTokens).display}</div>
            </div>
          </div>
          <div className="card p-3 flex items-center gap-3">
            <DollarSign size={16} className="text-emerald-500" />
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Total Cost</div>
              <div className="text-lg font-bold text-emerald-700">{formatCost(summary.totalCost).display}</div>
            </div>
          </div>
          <div className="card p-3 flex items-center gap-3">
            <Clock size={16} className="text-amber-500" />
            <div>
              <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Avg Latency</div>
              <div className="text-lg font-bold text-amber-700">{summary.avgLatency.toFixed(0)} ms</div>
            </div>
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="!px-3 w-8"></th>
                <th className="text-left">Model</th>
                <th className="text-left">Agent</th>
                <th className="text-right">Tokens (in/out)</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Latency</th>
                <th className="text-left">Trace ID</th>
                <th className="text-left">Prompt Preview</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => (
                <ExpandableRow key={c.span_id || c.id || i} call={c} />
              ))}
            </tbody>
          </table>
          <Pagination
            currentPage={page}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
        </>
      )}
    </div>
  )
}
