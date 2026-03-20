import { useState, useEffect } from 'react'
import { getMetrics, getProducts } from '../api'
import { DollarSign, Cpu, Database, Wrench, Search, Zap, Bot } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonPage } from '../components/ui/Skeleton'
import Tip from '../components/ui/Tip'
import { formatNumber, formatLatency, formatCost } from '../utils/format'

const chartTooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
  fontSize: '12px',
}

const COST_PIE_COLORS = ['#7c3aed', '#06b6d4', '#f59e0b', '#e64980', '#7950f2']

/* ── Metric Card ─────────────────────────────────────────────────────── */
function MetricCard({ icon: Icon, label, value, subtitle, color, bg }) {
  return (
    <div className="card p-4 flex items-start gap-3 hover:shadow-card-hover transition-shadow">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
        <Icon size={18} className={color} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
        <div className={`text-xl font-bold ${color} mt-0.5 truncate`}>{value}</div>
        {subtitle && <div className="text-2xs text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  )
}

export default function CostAnalyticsPage() {
  const [metrics, setMetrics] = useState(null)
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [mr, pr] = await Promise.all([
        getMetrics(productFilter || undefined),
        getProducts()
      ])
      setMetrics(mr.data)
      setProducts(pr.data.products || [])
    } catch (e) {
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productFilter])

  const m = metrics || {}
  const llmCost = m.llm_cost_usd ?? 0
  const embeddingCost = m.embedding_cost_usd ?? 0
  const llmTokens = m.llm_tokens ?? 0
  const embTokens = m.embedding_tokens ?? 0
  const totalTokens = m.total_tokens ?? 0
  const modelBreakdown = m.model_breakdown || []
  const embeddingBreakdown = m.embedding_breakdown || []
  const toolUsage = m.tool_breakdown || m.tool_usage || m.tools || []
  const ragBreakdown = m.rag_breakdown || []
  const timeline = m.timeline || m.daily || []
  const latencyPercentiles = m.latency || {}

  const costPieData = [
    llmCost > 0 && { name: 'LLM', value: llmCost },
    embeddingCost > 0 && { name: 'Embedding', value: embeddingCost },
  ].filter(Boolean)

  if (loading) return <SkeletonPage />

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Cost & Tokens"
        subtitle="Detailed spending, token usage, and resource consumption breakdowns"
        icon={DollarSign}
        actions={
          <FilterBar onRefresh={load}>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
          </FilterBar>
        }
      />

      {!metrics ? (
        <EmptyState icon={DollarSign} title="No metrics available" description="Cost data will appear once traces with cost information are ingested." />
      ) : (
        <div className="space-y-5">
          {/* ── KPI Cards — 6 key metrics ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <MetricCard
              icon={DollarSign} label="Total Cost"
              value={`$${(m.total_cost_usd ?? 0).toFixed(4)}`}
              subtitle={`${m.trace_count ?? 0} traces`}
              color="text-emerald-600" bg="bg-emerald-50"
            />
            <MetricCard
              icon={Zap} label="LLM Cost"
              value={`$${llmCost.toFixed(4)}`}
              subtitle={`${m.llm_calls ?? 0} calls`}
              color="text-violet-600" bg="bg-violet-50"
            />
            <MetricCard
              icon={Database} label="Embedding Cost"
              value={`$${embeddingCost.toFixed(4)}`}
              subtitle={`${m.embedding_calls ?? 0} calls`}
              color="text-cyan-600" bg="bg-cyan-50"
            />
            <MetricCard
              icon={Zap} label="LLM Tokens"
              value={formatNumber(llmTokens).display}
              subtitle={llmTokens > 0 && totalTokens > 0 ? `${(llmTokens / totalTokens * 100).toFixed(0)}% of total` : undefined}
              color="text-violet-600" bg="bg-violet-50"
            />
            <MetricCard
              icon={Database} label="Embed Tokens"
              value={formatNumber(embTokens).display}
              subtitle={embTokens > 0 && totalTokens > 0 ? `${(embTokens / totalTokens * 100).toFixed(0)}% of total` : undefined}
              color="text-cyan-600" bg="bg-cyan-50"
            />
            <MetricCard
              icon={Cpu} label="Total Tokens"
              value={formatNumber(totalTokens).display}
              subtitle={`LLM + Embeddings`}
              color="text-blue-600" bg="bg-blue-50"
            />
          </div>

          {/* ── Token split bar ── */}
          {totalTokens > 0 && (
            <div className="card px-5 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700">Token Distribution</span>
                <div className="flex items-center gap-4 text-2xs text-slate-500">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500 inline-block" /> LLM: {formatNumber(llmTokens).display}</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" /> Embedding: {formatNumber(embTokens).display}</span>
                </div>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
                {llmTokens > 0 && <div className="bg-violet-500 h-full rounded-l-full transition-all" style={{ width: `${llmTokens / totalTokens * 100}%` }} />}
                {embTokens > 0 && <div className="bg-cyan-400 h-full rounded-r-full transition-all" style={{ width: `${embTokens / totalTokens * 100}%` }} />}
              </div>
            </div>
          )}

          {/* ── Charts row: Cost breakdown + daily timeline ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {costPieData.length > 0 && (
              <div className="card p-5 lg:col-span-2">
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Cost Split</h2>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={costPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value"
                        label={({ name, value }) => `${name}: $${value.toFixed(4)}`}>
                        {costPieData.map((_, idx) => (
                          <Cell key={idx} fill={COST_PIE_COLORS[idx % COST_PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [`$${value.toFixed(6)}`, 'Cost']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Latency percentiles inline */}
                {(latencyPercentiles.p50_ms != null || latencyPercentiles.p95_ms != null) && (
                  <div className="flex justify-around mt-4 pt-4 border-t border-slate-100">
                    {[
                      { label: 'P50', value: latencyPercentiles.p50_ms, color: 'text-brand-600' },
                      { label: 'P95', value: latencyPercentiles.p95_ms, color: 'text-amber-600' },
                      { label: 'P99', value: latencyPercentiles.p99_ms, color: 'text-red-600' },
                    ].map(({ label, value, color }) => {
                      const lat = formatLatency(value ?? 0, 1)
                      return (
                        <div key={label} className="text-center">
                          <div className="text-2xs font-semibold uppercase text-slate-400">{label}</div>
                          <div className={`text-sm font-bold ${color}`} title={lat.full}>{lat.display}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {timeline.length > 0 && (
              <div className={`card p-5 ${costPieData.length > 0 ? 'lg:col-span-3' : 'lg:col-span-5'}`}>
                <h2 className="text-sm font-semibold text-slate-800 mb-3">Daily Timeline</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="tracesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#4c6ef5" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#4c6ef5" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#12b886" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#12b886" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                      <Area yAxisId="left" type="monotone" dataKey="traces" stroke="#4c6ef5" fill="url(#tracesGrad)" strokeWidth={2} name="Traces" />
                      <Area yAxisId="right" type="monotone" dataKey="cost_usd" stroke="#12b886" fill="url(#costGrad)" strokeWidth={2} name="Cost ($)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* ── Model breakdowns side by side ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {modelBreakdown.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Zap size={14} className="text-violet-500" />
                  <h2 className="text-sm font-semibold text-slate-800">LLM Models</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Model</th>
                      <th className="text-right">Calls</th>
                      <th className="text-right">Input Tok</th>
                      <th className="text-right">Output Tok</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelBreakdown.map((mb, i) => {
                      const c = formatCost(mb.cost_usd)
                      const lat = formatLatency(mb.avg_latency_ms, mb.calls)
                      return (
                        <tr key={mb.model || i}>
                          <td><div className="flex items-center gap-2"><Bot size={14} className="text-violet-400" /><span className="font-medium text-slate-800 text-xs">{mb.model || '-'}</span></div></td>
                          <td className="text-right font-mono text-xs">{mb.calls ?? 0}</td>
                          <td className="text-right font-mono text-xs text-violet-600"><Tip value={formatNumber(mb.input_tokens ?? 0).display} full={(mb.input_tokens ?? 0).toLocaleString()} /></td>
                          <td className="text-right font-mono text-xs text-violet-600"><Tip value={formatNumber(mb.output_tokens ?? 0).display} full={(mb.output_tokens ?? 0).toLocaleString()} /></td>
                          <td className="text-right text-emerald-600 font-mono text-xs font-medium"><Tip value={c.display} full={c.full} /></td>
                          <td className="text-right font-mono text-xs"><Tip value={lat.display} full={lat.full} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {embeddingBreakdown.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Database size={14} className="text-cyan-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Embedding Models</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Model</th>
                      <th className="text-right">Calls</th>
                      <th className="text-right">Tokens</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {embeddingBreakdown.map((e, i) => {
                      const tok = formatNumber(e.tokens ?? 0)
                      const c = formatCost(e.cost_usd)
                      const lat = formatLatency(e.avg_latency_ms, e.calls)
                      return (
                        <tr key={e.model || i}>
                          <td><div className="flex items-center gap-2"><Database size={14} className="text-cyan-400" /><span className="font-medium text-slate-800 text-xs">{e.model || '-'}</span></div></td>
                          <td className="text-right font-mono text-xs">{e.calls ?? 0}</td>
                          <td className="text-right font-mono text-xs text-cyan-600"><Tip value={tok.display} full={tok.full} /></td>
                          <td className="text-right text-emerald-600 font-mono text-xs font-medium"><Tip value={c.display} full={c.full} /></td>
                          <td className="text-right font-mono text-xs"><Tip value={lat.display} full={lat.full} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Tool & RAG breakdowns side by side ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {toolUsage.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Wrench size={14} className="text-slate-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Tool Usage</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Tool</th>
                      <th className="text-right">Calls</th>
                      <th className="text-right">Latency</th>
                      <th className="text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolUsage.map((t, i) => {
                      const calls = t.calls ?? t.count ?? 0
                      const avgLat = formatLatency(t.avg_latency_ms ?? t.avg_latency ?? 0, calls)
                      return (
                        <tr key={t.tool || t.name || i}>
                          <td><div className="flex items-center gap-2"><Wrench size={14} className="text-slate-400" /><span className="font-medium text-slate-800 text-xs">{t.tool || t.name || '-'}</span></div></td>
                          <td className="text-right font-mono text-xs">{calls}</td>
                          <td className="text-right font-mono text-xs"><Tip value={avgLat.display} full={avgLat.full} /></td>
                          <td className="text-right">
                            {(t.errors ?? 0) > 0
                              ? <span className="badge-error text-xs">{t.errors}</span>
                              : <span className="text-slate-400 text-xs">0</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {ragBreakdown.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Search size={14} className="text-cyan-500" />
                  <h2 className="text-sm font-semibold text-slate-800">RAG Sources</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Source</th>
                      <th className="text-right">Queries</th>
                      <th className="text-right">Docs</th>
                      <th className="text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ragBreakdown.map((r, i) => {
                      const lat = formatLatency(r.avg_latency_ms, r.queries)
                      return (
                        <tr key={r.source || i}>
                          <td><div className="flex items-center gap-2"><Search size={14} className="text-cyan-400" /><span className="font-medium text-slate-800 text-xs">{r.source || '-'}</span></div></td>
                          <td className="text-right font-mono text-xs">{r.queries ?? 0}</td>
                          <td className="text-right font-mono text-xs">{r.total_docs_retrieved ?? 0}</td>
                          <td className="text-right font-mono text-xs"><Tip value={lat.display} full={lat.full} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
