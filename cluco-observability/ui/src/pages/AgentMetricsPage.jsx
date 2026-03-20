import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgentMetrics, getAgentBreakdown, sendAgentReport } from '../api'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts'
import {
  Bot, Users, Activity, Cpu, ArrowLeft, AlertTriangle, Wrench, Search,
  Database, Zap, DollarSign, Clock, CheckCircle, XCircle, ArrowUpRight, TrendingUp, Mail, Send, X,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
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

const PIE_COLORS = ['#7c3aed', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#6366f1']

/* ── Metric Card ── */
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

/* ── Rate Badge ── */
function RateBadge({ rate, good = true }) {
  const isGood = good ? rate >= 90 : rate < 5
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
      isGood ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
    }`}>
      {isGood ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
      {rate.toFixed(1)}%
    </span>
  )
}

export default function AgentMetricsPage() {
  const { serviceName } = useParams()
  const decoded = decodeURIComponent(serviceName || '')
  const [metrics, setMetrics] = useState(null)
  const [agentBreakdown, setAgentBreakdown] = useState([])
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportEmails, setReportEmails] = useState('')
  const [reportPeriod, setReportPeriod] = useState(7)
  const [reportSending, setReportSending] = useState(false)
  const [reportMsg, setReportMsg] = useState('')

  useEffect(() => {
    if (!decoded) return
    setError(null)
    Promise.all([
      getAgentMetrics(decoded),
      getAgentBreakdown({ service_name: decoded }),
    ]).then(([m, ab]) => {
      setMetrics(m.data)
      setAgentBreakdown(ab.data?.agents || [])
      setSummary(ab.data?.summary || {})
    }).catch((e) => {
      setMetrics(null)
      setError(e?.response?.status === 404 ? 'Agent not found' : 'Failed to load metrics. Is the backend running?')
    }).finally(() => setLoading(false))
  }, [decoded])

  if (loading) return <SkeletonPage />
  if (error) return (
    <div className="animate-fade-in">
      <div className="card border-red-200 bg-red-50/50 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800">{error}</h3>
            <Link to="/agents" className="text-sm text-brand-600 hover:underline mt-2 inline-block">Back to agents</Link>
          </div>
        </div>
      </div>
    </div>
  )
  const handleSendReport = async () => {
    const emails = reportEmails.split(',').map(e => e.trim()).filter(Boolean)
    if (emails.length === 0) return
    setReportSending(true)
    try {
      const res = await sendAgentReport(decoded, { recipient_emails: emails, period_days: reportPeriod })
      setReportMsg(res.data?.ok ? 'Report sent!' : (res.data?.detail || 'Failed'))
      if (res.data?.ok) setTimeout(() => { setShowReportModal(false); setReportMsg('') }, 2000)
    } catch (e) {
      setReportMsg(e.response?.data?.detail || 'Failed to send report')
    } finally { setReportSending(false) }
  }

  if (!metrics) return null

  const totalCost = formatCost(metrics.total_cost_usd || 0)
  const totalTokens = formatNumber(metrics.total_tokens ?? 0)
  const inputTokens = metrics.input_tokens || 0
  const outputTokens = metrics.output_tokens || 0
  const successRate = metrics.traces > 0 ? ((metrics.traces - (metrics.errors || 0)) / metrics.traces * 100) : 100
  const errorRate = metrics.traces > 0 ? ((metrics.errors || 0) / metrics.traces * 100) : 0

  const tracesByDate = metrics.traces_by_date || []
  const spanData = (metrics.spans || []).slice(0, 12)

  // Aggregate tools from all agents in breakdown
  const allTools = new Map()
  for (const a of agentBreakdown) {
    for (const tool of (a.tools_used || [])) {
      if (!allTools.has(tool)) {
        allTools.set(tool, { name: tool, agents: [], totalCalls: 0 })
      }
      allTools.get(tool).agents.push(a.name)
      allTools.get(tool).totalCalls += a.tool_calls || 0
    }
  }
  const toolsList = [...allTools.values()].sort((a, b) => b.totalCalls - a.totalCalls)

  // Token distribution data for pie chart
  const tokenPieData = [
    inputTokens > 0 && { name: 'LLM Input', value: inputTokens },
    outputTokens > 0 && { name: 'LLM Output', value: outputTokens },
    (summary.total_embedding_calls ?? 0) > 0 && { name: 'Embedding', value: agentBreakdown.reduce((s, a) => s + (a.embedding_tokens || 0), 0) },
  ].filter(Boolean)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={decoded}
        subtitle="Agent performance, tools, and resource consumption"
        icon={Bot}
        breadcrumbs={[
          { label: 'Agents', to: '/agents' },
          { label: decoded },
        ]}
        actions={
          <button onClick={() => setShowReportModal(true)} className="btn-ghost text-xs flex items-center gap-1.5">
            <Mail size={14} /> Send Report
          </button>
        }
      />

      {showReportModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowReportModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[420px]" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-800">Send Agent Report</h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Recipient Emails (comma-separated)</label>
                <input value={reportEmails} onChange={e => setReportEmails(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="alice@example.com, bob@example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Period (days)</label>
                <select value={reportPeriod} onChange={e => setReportPeriod(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value={1}>Last 1 day</option>
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </div>
              {reportMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${reportMsg.includes('sent') ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  {reportMsg}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={handleSendReport} disabled={reportSending || !reportEmails.trim()} className="btn-brand text-sm px-4 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                  <Send size={14} /> {reportSending ? 'Sending...' : 'Send Report'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Primary KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <MetricCard icon={Activity} label="Traces" value={metrics.traces ?? 0} subtitle={`${metrics.sessions ?? 0} sessions`} color="text-brand-600" bg="bg-brand-50" />
        <MetricCard icon={DollarSign} label="Total Cost" value={totalCost.display} subtitle={totalCost.full} color="text-emerald-600" bg="bg-emerald-50" />
        <MetricCard icon={Zap} label="LLM Calls" value={summary.total_llm_calls ?? metrics.sub_agents?.reduce((s, a) => s + (a.llm_calls || 0), 0) ?? 0} subtitle={`${formatNumber(inputTokens).display} in / ${formatNumber(outputTokens).display} out`} color="text-violet-600" bg="bg-violet-50" />
        <MetricCard icon={Database} label="Embeddings" value={summary.total_embedding_calls ?? 0} subtitle={`${formatNumber(agentBreakdown.reduce((s, a) => s + (a.embedding_tokens || 0), 0)).display} tokens`} color="text-cyan-600" bg="bg-cyan-50" />
        <MetricCard icon={Wrench} label="Tool Calls" value={summary.total_tool_calls ?? 0} subtitle={`${toolsList.length} tools`} color="text-amber-600" bg="bg-amber-50" />
        <MetricCard icon={Search} label="RAG Queries" value={summary.total_rag_queries ?? 0} color="text-teal-600" bg="bg-teal-50" />
      </div>

      {/* ── Success / Error Rate Bar ── */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700">Success Rate</span>
          <div className="flex items-center gap-3">
            <RateBadge rate={successRate} good={true} />
            {errorRate > 0 && (
              <span className="text-xs text-red-500 font-medium">{metrics.errors} error{metrics.errors !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
          <div className="bg-green-500 h-full rounded-l-full transition-all" style={{ width: `${successRate}%` }} />
          {errorRate > 0 && <div className="bg-red-500 h-full rounded-r-full transition-all" style={{ width: `${errorRate}%` }} />}
        </div>
        <div className="flex items-center justify-between mt-1.5 text-2xs text-slate-400">
          <span className="flex items-center gap-1"><CheckCircle size={10} className="text-green-500" /> {metrics.traces - (metrics.errors || 0)} success</span>
          <span className="flex items-center gap-1"><XCircle size={10} className="text-red-400" /> {metrics.errors || 0} errors</span>
        </div>
      </div>

      {/* ── Per-Agent Breakdown ── */}
      {agentBreakdown.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Sub-Agent Breakdown</h2>
              <p className="text-2xs text-slate-400 mt-0.5">{agentBreakdown.length} agents, {summary.total_invocations ?? 0} total invocations</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Agent</th>
                  <th className="text-right">Invocations</th>
                  <th className="text-right">LLM Calls</th>
                  <th className="text-right">LLM Tokens</th>
                  <th className="text-right">Embeddings</th>
                  <th className="text-right">Embed Tokens</th>
                  <th className="text-right">Tool Calls</th>
                  <th className="text-right">RAG</th>
                  <th className="text-right">Cost</th>
                  <th className="text-right">Avg Latency</th>
                  <th className="text-right">Success</th>
                  <th className="text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {agentBreakdown.map((a) => {
                  const llmTok = formatNumber(a.total_tokens || 0)
                  const embTok = formatNumber(a.embedding_tokens || 0)
                  const cost = formatCost(a.cost_usd)
                  const lat = formatLatency(a.avg_latency_ms, a.invocations)
                  const sRate = a.invocations > 0 ? ((a.invocations - (a.errors || 0)) / a.invocations * 100) : 100
                  return (
                    <tr key={a.name}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Bot size={14} className="text-brand-500 shrink-0" />
                          <div>
                            <span className="font-medium text-slate-800 text-xs">{a.name}</span>
                            {(a.tools_used || []).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {(a.tools_used || []).slice(0, 3).map(t => (
                                  <span key={t} className="badge-neutral text-2xs">{t}</span>
                                ))}
                                {(a.tools_used || []).length > 3 && <span className="text-2xs text-slate-400">+{(a.tools_used || []).length - 3}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="text-right font-mono text-xs">{a.invocations}</td>
                      <td className="text-right font-mono text-xs text-violet-600 font-medium">{a.llm_calls}</td>
                      <td className="text-right font-mono text-xs" title={`In: ${(a.input_tokens || 0).toLocaleString()} | Out: ${(a.output_tokens || 0).toLocaleString()}`}>
                        <Tip value={llmTok.display} full={llmTok.full} />
                      </td>
                      <td className="text-right font-mono text-xs text-cyan-600 font-medium">{a.embedding_calls}</td>
                      <td className="text-right font-mono text-xs"><Tip value={embTok.display} full={embTok.full} /></td>
                      <td className="text-right font-mono text-xs text-amber-600 font-medium">{a.tool_calls}</td>
                      <td className="text-right font-mono text-xs">{a.rag_queries}</td>
                      <td className="text-right text-emerald-600 font-mono text-xs font-medium"><Tip value={cost.display} full={cost.full} /></td>
                      <td className="text-right font-mono text-xs"><Tip value={lat.display} full={lat.full} /></td>
                      <td className="text-right">
                        <span className={`text-xs font-medium ${sRate >= 90 ? 'text-green-600' : 'text-amber-600'}`}>{sRate.toFixed(0)}%</span>
                      </td>
                      <td className="text-right">
                        {(a.errors || 0) > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium"><XCircle size={12} /> {a.errors}</span>
                        ) : (
                          <span className="text-slate-400 text-xs">0</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
        {/* Token distribution pie */}
        {tokenPieData.length > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Token Distribution</h2>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={tokenPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} dataKey="value"
                    label={({ name, value }) => `${name}: ${formatNumber(value).display}`}>
                    {tokenPieData.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [v.toLocaleString(), 'Tokens']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Activity over time */}
        {tracesByDate.length > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Activity Over Time</h2>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tracesByDate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend />
                  <Line type="monotone" dataKey="traces" stroke="#4c6ef5" strokeWidth={2} dot={{ r: 3, fill: '#4c6ef5' }} name="Traces" />
                  <Line type="monotone" dataKey="sessions" stroke="#12b886" strokeWidth={2} dot={{ r: 3, fill: '#12b886' }} name="Sessions" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ── Tools Section ── */}
      {toolsList.length > 0 && (
        <div className="card overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Wrench size={14} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-800">Tools Used</h2>
            <span className="text-2xs text-slate-400 ml-1">{toolsList.length} tools</span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {toolsList.map(tool => (
              <div key={tool.name} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100 hover:border-slate-200 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <Wrench size={14} className="text-amber-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800 truncate">{tool.name}</div>
                  <div className="text-2xs text-slate-400">
                    Used by {tool.agents.length === 1 ? tool.agents[0] : `${tool.agents.length} agents`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Latency by Span ── */}
      {spanData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Latency by Span (P95)</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spanData} layout="vertical" margin={{ left: 100 }}>
                  <defs>
                    <linearGradient id="latGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis type="category" dataKey="span_name" width={90} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [`${v?.toFixed(0)} ms`, 'P95 Latency']} contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="p95_latency_ms" stroke="#7c3aed" fill="url(#latGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <Clock size={14} className="text-violet-500" />
              <h2 className="text-sm font-semibold text-slate-800">Span Breakdown</h2>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Span</th>
                  <th className="text-right">Count</th>
                  <th className="text-right">P95 Latency</th>
                </tr>
              </thead>
              <tbody>
                {spanData.map((s) => {
                  const lat = formatLatency(s.p95_latency_ms, 1)
                  return (
                    <tr key={s.span_name}>
                      <td className="font-mono text-xs text-slate-700 max-w-xs truncate">{s.span_name}</td>
                      <td className="text-right font-mono text-xs">{s.count ?? 1}</td>
                      <td className="text-right font-mono text-xs"><Tip value={lat.display} full={lat.full} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
