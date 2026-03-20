import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getAgents, getProducts } from '../api'
import { Bot, ArrowUpRight, Cpu, DollarSign, Clock, AlertTriangle, Zap, Database, Wrench, CheckCircle, XCircle } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonPage } from '../components/ui/Skeleton'
import { formatNumber, formatCost, formatLatency } from '../utils/format'

export default function AgentsPage() {
  const [data, setData] = useState(null)
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getAgents(productFilter || undefined),
      getProducts()
    ]).then(([a, p]) => {
      setData(a.data)
      setProducts(p.data.products || [])
    }).catch(() => setData({ agents: [] })).finally(() => setLoading(false))
  }, [productFilter])

  const overview = data?.overview || {}
  const agents = data?.agents || []

  if (loading) return <SkeletonPage />

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Agents"
        subtitle={agents.length > 0 ? `${agents.length} agents across ${overview.sessions ?? 0} sessions` : 'Agent performance insights'}
        icon={Bot}
        actions={
          <FilterBar>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
          </FilterBar>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Start an observability-enabled application to send traces and see agent metrics here."
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {agents.map((a) => {
            const name = a.name || a.service_name || '-'
            const cost = formatCost(a.total_cost_usd || 0)
            const tokens = formatNumber(a.total_tokens || 0)
            const llmTok = formatNumber(a.llm_tokens || 0)
            const embTok = formatNumber(a.embedding_tokens || 0)
            const lat = formatLatency(a.p95_latency_ms, a.traces)
            const errRate = a.error_rate ?? 0
            const successRate = a.success_rate ?? 100
            const totalTok = a.total_tokens || 0
            const llmPct = totalTok > 0 ? ((a.llm_tokens || 0) / totalTok * 100) : 0
            const embPct = totalTok > 0 ? ((a.embedding_tokens || 0) / totalTok * 100) : 0

            return (
              <Link
                key={name}
                to={`/agents/${encodeURIComponent(name)}`}
                className="card p-5 group hover:shadow-card-hover hover:border-slate-300/80 transition-all"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                      <Bot size={18} className="text-brand-600" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800 group-hover:text-brand-700 transition-colors">
                        {name.length > 32 ? name.slice(0, 32) + '...' : name}
                      </div>
                      <div className="text-2xs text-slate-400">{a.environment ?? 'development'}</div>
                    </div>
                  </div>
                  <ArrowUpRight size={14} className="text-slate-300 group-hover:text-brand-500 transition-colors mt-1" />
                </div>

                {/* Cost + Tokens row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-emerald-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-2xs text-emerald-600/70 mb-0.5"><DollarSign size={10} /> Cost</div>
                    <div className="text-sm font-bold text-emerald-700" title={cost.full}>{cost.display}</div>
                  </div>
                  <div className="bg-violet-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-2xs text-violet-600/70 mb-0.5"><Zap size={10} /> LLM</div>
                    <div className="text-sm font-bold text-violet-700" title={`${(a.llm_tokens || 0).toLocaleString()} tokens`}>{llmTok.display}</div>
                    <div className="text-2xs text-violet-400">{a.llm_calls || 0} calls</div>
                  </div>
                  <div className="bg-cyan-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1 text-2xs text-cyan-600/70 mb-0.5"><Database size={10} /> Embed</div>
                    <div className="text-sm font-bold text-cyan-700" title={`${(a.embedding_tokens || 0).toLocaleString()} tokens`}>{embTok.display}</div>
                    <div className="text-2xs text-cyan-400">{a.embedding_calls || 0} calls</div>
                  </div>
                </div>

                {/* Token split bar */}
                {totalTok > 0 && (
                  <div className="mb-3">
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
                      {llmPct > 0 && <div className="bg-violet-500 h-full" style={{ width: `${llmPct}%` }} />}
                      {embPct > 0 && <div className="bg-cyan-400 h-full" style={{ width: `${embPct}%` }} />}
                    </div>
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-5 gap-1 text-center border-t border-slate-100 pt-3">
                  <div>
                    <div className="text-2xs text-slate-400">Sessions</div>
                    <div className="text-xs font-bold text-slate-700">{a.sessions ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-2xs text-slate-400">Traces</div>
                    <div className="text-xs font-bold text-slate-700">{a.traces ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-2xs text-slate-400">P95</div>
                    <div className="text-xs font-bold text-slate-700" title={lat.full}>{lat.display}</div>
                  </div>
                  <div>
                    <div className="text-2xs text-slate-400">Success</div>
                    <div className={`text-xs font-bold ${successRate >= 90 ? 'text-green-600' : 'text-amber-600'}`}>
                      {successRate.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-2xs text-slate-400">Errors</div>
                    <div className={`text-xs font-bold ${(a.errors || 0) > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                      {a.errors || 0}
                    </div>
                  </div>
                </div>

                {/* Sub-agents */}
                {(a.sub_agents || []).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1">
                    {(a.sub_agents || []).slice(0, 6).map((s, i) => (
                      <span key={String(s) || i} className="badge-neutral text-2xs">{s}</span>
                    ))}
                    {(a.sub_agents || []).length > 6 && (
                      <span className="text-2xs text-slate-400">+{(a.sub_agents || []).length - 6} more</span>
                    )}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
