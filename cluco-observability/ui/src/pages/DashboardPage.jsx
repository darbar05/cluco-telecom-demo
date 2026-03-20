import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getMetrics, getProducts, getDashboards, getAgentBreakdown } from '../api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts'
import {
  LayoutDashboard, Activity, Clock, Cpu, Plus, ExternalLink,
  Zap, DollarSign, Bot, AlertTriangle, Users, Award, FileText,
  GitCompare, ArrowUpRight, TrendingUp, TrendingDown
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonCard } from '../components/ui/Skeleton'
import { formatNumber, formatLatency, formatCost } from '../utils/format'

const chartTooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
  fontSize: '12px',
}

/* Compact KPI card shown at the top of the dashboard */
function KpiCard({ label, value, tooltip, icon: Icon, color = 'text-brand-600', subtitle }) {
  return (
    <div className="card p-4 flex items-center gap-4 group hover:shadow-card-hover transition-shadow">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-opacity-10 shrink-0`} style={{ backgroundColor: `color-mix(in srgb, currentColor 8%, transparent)` }}>
        <Icon size={20} className={color} />
      </div>
      <div className="min-w-0">
        <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
        <div className={`text-xl font-bold ${color} truncate`} title={tooltip}>{value}</div>
        {subtitle && <div className="text-2xs text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  )
}

/* Navigation card linking to a detail page */
function NavCard({ to, icon: Icon, label, value, description, color = 'text-brand-600' }) {
  return (
    <Link
      to={to}
      className="card p-4 flex items-start gap-3 group hover:shadow-card-hover hover:border-slate-300/80 transition-all"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0`} style={{ backgroundColor: `color-mix(in srgb, currentColor 8%, transparent)` }}>
        <Icon size={16} className={color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 group-hover:text-brand-700 transition-colors">{label}</span>
          <ArrowUpRight size={14} className="text-slate-300 group-hover:text-brand-500 transition-colors shrink-0" />
        </div>
        {value !== undefined && <div className={`text-lg font-bold ${color} mt-0.5`}>{value}</div>}
        {description && <div className="text-2xs text-slate-400 mt-0.5 truncate">{description}</div>}
      </div>
    </Link>
  )
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState(null)
  const [products, setProducts] = useState([])
  const [dashboards, setDashboards] = useState([])
  const [agentData, setAgentData] = useState(null)
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setApiError(null)
    Promise.all([
      getMetrics(productFilter || undefined),
      getProducts(),
      getDashboards(productFilter || undefined),
      getAgentBreakdown({ product_id: productFilter || undefined }),
    ]).then(([m, p, d, ab]) => {
      setMetrics(m.data)
      setProducts(p.data.products || [])
      setDashboards(d.data.dashboards || [])
      setAgentData(ab.data)
    }).catch((err) => {
      const isNetwork = err.code === 'ECONNREFUSED' || err.message?.includes('Network')
      setApiError(isNetwork
        ? 'Cannot reach Cluco backend. Is it running on port 9410?'
        : (err.response?.data?.detail ?? err.message) || 'Failed to load dashboard metrics.')
      setMetrics({ trace_count: 0 })
    }).finally(() => setLoading(false))
  }, [productFilter])

  const m = metrics || {}
  const timeline = Array.isArray(m.timeline) ? m.timeline : []
  const agents = Array.isArray(agentData?.agents) ? agentData.agents : []

  const traceCount = m.trace_count ?? 0
  const totalCost = formatCost(m.total_cost_usd)
  const totalTokens = formatNumber(m.total_tokens ?? 0)
  const rawLlmTokens = m.llm_tokens ?? 0
  const rawEmbTokens = m.embedding_tokens ?? 0
  const rawTotalTokens = m.total_tokens ?? 0
  const hasTokenBreakdown = rawLlmTokens > 0 || rawEmbTokens > 0
  const llmTokens = formatNumber(rawLlmTokens)
  const embTokens = formatNumber(rawEmbTokens)
  const avgLat = formatLatency(m.latency?.avg_ms ?? m.avg_latency_ms ?? 0, traceCount)
  const errorRate = (m.error_rate ?? 0).toFixed(1)
  const llmCalls = m.llm_calls ?? 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle="System health at a glance"
        icon={LayoutDashboard}
        actions={
          <div className="flex items-center gap-2">
            <FilterBar>
              <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
            </FilterBar>
          </div>
        }
      />

      {apiError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Backend:</strong> {apiError}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Primary KPIs ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <KpiCard label="Total Traces" value={traceCount || '—'} icon={Activity} color="text-brand-600" subtitle={`${m.session_count ?? 0} sessions`} />
            <KpiCard label="Total Cost" value={traceCount ? totalCost.display : '—'} tooltip={totalCost.full} icon={DollarSign} color="text-emerald-600" />
            {hasTokenBreakdown ? (
              <>
                <KpiCard label="LLM Tokens" value={llmTokens.display} tooltip={llmTokens.full} icon={Zap} color="text-violet-600" subtitle={`$${(m.llm_cost_usd ?? 0).toFixed(4)}`} />
                <KpiCard label="Embed Tokens" value={embTokens.display} tooltip={embTokens.full} icon={Cpu} color="text-cyan-600" subtitle={`$${(m.embedding_cost_usd ?? 0).toFixed(4)}`} />
              </>
            ) : (
              <>
                <KpiCard label="LLM Tokens" value={rawTotalTokens > 0 ? totalTokens.display : '—'} tooltip={totalTokens.full} icon={Zap} color="text-violet-600" subtitle={rawTotalTokens > 0 ? 'Breakdown pending' : undefined} />
                <KpiCard label="Embed Tokens" value="—" icon={Cpu} color="text-cyan-600" subtitle={rawTotalTokens > 0 ? 'Breakdown pending' : undefined} />
              </>
            )}
            <KpiCard label="Total Tokens" value={rawTotalTokens > 0 ? totalTokens.display : '—'} tooltip={totalTokens.full} icon={Cpu} color="text-blue-600" />
            <KpiCard label="LLM Calls" value={llmCalls || '—'} icon={Zap} color="text-indigo-600" />
            <KpiCard label={avgLat.label} value={traceCount ? avgLat.display : '—'} tooltip={avgLat.full} icon={Clock} color="text-amber-600" />
            <KpiCard label="Error Rate" value={traceCount ? `${errorRate}%` : '—'} icon={AlertTriangle} color={parseFloat(errorRate) > 0 ? 'text-red-600' : 'text-emerald-600'} subtitle={`${m.error_count ?? 0} errors`} />
          </div>

          {/* ── Activity chart (single, clean visualization) ── */}
          {timeline.length > 1 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-800">Pipeline Activity</h2>
                <Link to="/cost-analytics" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                  Detailed breakdown <ArrowUpRight size={12} />
                </Link>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline}>
                    <defs>
                      <linearGradient id="traceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4c6ef5" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#4c6ef5" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#12b886" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#12b886" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Area type="monotone" dataKey="traces" stroke="#4c6ef5" fill="url(#traceGrad)" strokeWidth={2} name="Traces" />
                    {timeline.some(t => (t.errors || 0) > 0) && (
                      <Area type="monotone" dataKey="errors" stroke="#e64980" fill="none" strokeWidth={1.5} strokeDasharray="4 2" name="Errors" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Navigation cards: guide users to the right detail page ── */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 px-1">Explore</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <NavCard to="/llm-calls" icon={Zap} label="LLM Calls" value={formatNumber(m.llm_calls ?? 0).display} description="Inspect prompts, completions, and tokens" color="text-violet-600" />
              <NavCard to="/cost-analytics" icon={DollarSign} label="Cost & Tokens" description="Model breakdowns, tool usage, RAG metrics" color="text-emerald-600" />
              <NavCard to="/agents" icon={Bot} label="Agents" value={agents.length || undefined} description="Per-agent performance and breakdown" color="text-brand-600" />
              <NavCard to="/quality-trends" icon={Award} label="Quality" description="Evaluation scores and pass rates" color="text-amber-600" />
            </div>
          </div>

          {/* ── Top agents (compact, at-a-glance) ── */}
          {agents.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Agent Performance</h2>
                  <p className="text-2xs text-slate-400 mt-0.5">Top agents by cost</p>
                </div>
                <Link to="/agents" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                  View all <ArrowUpRight size={12} />
                </Link>
              </div>
              <div className="divide-y divide-slate-50">
                {agents.slice(0, 8).map((a) => {
                  const cost = formatCost(a.cost_usd)
                  const tok = formatNumber(a.total_tokens || 0)
                  const lat = formatLatency(a.avg_latency_ms, a.invocations)
                  return (
                    <div key={a.name} className="flex items-center gap-4 px-5 py-3 hover:bg-brand-50/30 transition-colors">
                      <Bot size={14} className="text-brand-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-800 flex-1 min-w-0 truncate">{a.name}</span>
                      <div className="flex items-center gap-5 text-xs text-slate-500 shrink-0">
                        <span title={tok.full}>{tok.display} tok</span>
                        <span className="text-emerald-600 font-medium" title={cost.full}>{cost.display}</span>
                        <span title={lat.full}>{lat.display}</span>
                        {(a.error_rate ?? 0) > 0 && (
                          <span className="text-red-500 font-medium">{a.error_rate.toFixed(1)}% err</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Custom dashboards (if any) ── */}
          {dashboards.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Custom Dashboards</h2>
                <Link to="/dashboard/new" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                  <Plus size={12} /> New
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {dashboards.map((db) => (
                  <Link key={db.id} to={`/dashboard/${db.id}`} className="card-hover p-4 flex items-center justify-between group">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{db.name}</div>
                      {db.description && <div className="text-2xs text-slate-400 mt-0.5">{db.description}</div>}
                    </div>
                    <ExternalLink size={14} className="text-slate-300 group-hover:text-brand-600 transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
