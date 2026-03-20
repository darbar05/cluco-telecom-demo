import { useState, useEffect } from 'react'
import { getEvaluationTrends, getEvaluations, getProducts } from '../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts'
import { Award, CheckCircle, XCircle } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import Pagination from '../components/ui/Pagination'
import { useClientPagination } from '../hooks/useClientPagination'

const chartTooltipStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
  fontSize: '12px',
}

export default function QualityTrendsPage() {
  const [trends, setTrends] = useState(null)
  const [evaluations, setEvaluations] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [tr, ev, pr] = await Promise.all([
        getEvaluationTrends({ product_id: productFilter || undefined }),
        getEvaluations({ product_id: productFilter || undefined, limit: 30 }),
        getProducts(),
      ])
      setTrends(tr.data)
      setEvaluations(ev.data.evaluations || [])
      setProducts(pr.data.products || [])
    } catch (e) {
      setTrends(null)
      setEvaluations([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productFilter])

  const agentSummary = trends?.agent_summary || []
  const timeline = trends?.timeline || []
  const totalEvals = trends?.total_evaluations || 0
  const evalsPg = useClientPagination(evaluations)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Quality"
        subtitle="Evaluation scores and pass rates across agents"
        icon={Award}
        actions={
          <FilterBar onRefresh={load}>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
          </FilterBar>
        }
      />

      {loading ? <SkeletonTable rows={6} cols={5} /> : !trends || totalEvals === 0 ? (
        <EmptyState icon={Award} title="No evaluations recorded" description="Quality evaluations will appear here after pipeline runs with quality review." />
      ) : (
        <div className="space-y-5">
          {/* ── Compact summary strip ── */}
          <div className="card px-5 py-3 flex items-center gap-6 text-xs">
            <span className="text-slate-500"><span className="font-semibold text-slate-700">{totalEvals}</span> evaluations</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500"><span className="font-semibold text-slate-700">{agentSummary.length}</span> agents</span>
            <span className="text-slate-300">|</span>
            <span className="text-green-600 font-medium">
              Avg pass rate: {agentSummary.length > 0
                ? Math.round(agentSummary.reduce((a, b) => a + b.pass_rate, 0) / agentSummary.length) : 0}%
            </span>
          </div>

          {/* ── Charts side by side ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {timeline.length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Score Over Time</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area type="monotone" dataKey="avg_score" stroke="#6366f1" fill="url(#scoreGrad)" strokeWidth={2} name="Avg Score" />
                      <Line type="monotone" dataKey="pass_rate" stroke="#22c55e" strokeWidth={1.5} dot={false} name="Pass Rate %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {agentSummary.length > 0 && (
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Agent Quality</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={agentSummary} layout="vertical">
                      <defs>
                        <linearGradient id="qualGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} />
                      <YAxis type="category" dataKey="agent_name" tick={{ fontSize: 10 }} width={120} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Area type="monotone" dataKey="avg_score" stroke="#6366f1" fill="url(#qualGrad)" strokeWidth={2} name="Avg Score" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* ── Recent evaluations table ── */}
          {evaluations.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700">Recent Evaluations</h3>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Agent</th>
                    <th className="text-right">Score</th>
                    <th className="text-center">Status</th>
                    <th className="text-right">Revision</th>
                    <th className="text-left">Summary</th>
                    <th className="text-left">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {evalsPg.paginatedData.map((e, i) => (
                    <tr key={e._id || i}>
                      <td className="font-mono text-xs">{e.agent_name}</td>
                      <td className="text-right">
                        <span className={`font-bold text-sm ${e.overall_score >= 70 ? 'text-green-600' : e.overall_score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {e.overall_score}
                        </span>
                      </td>
                      <td className="text-center">
                        {e.pass_fail
                          ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={12} /> Pass</span>
                          : <span className="inline-flex items-center gap-1 text-red-600 text-xs"><XCircle size={12} /> Fail</span>
                        }
                      </td>
                      <td className="text-right text-xs text-slate-500">#{e.revision_count || 0}</td>
                      <td className="text-xs text-slate-600 max-w-xs truncate">{e.summary || '-'}</td>
                      <td className="text-xs text-slate-400">{e.created_at ? new Date(e.created_at).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination currentPage={evalsPg.page} totalItems={evalsPg.totalItems} pageSize={evalsPg.pageSize} onPageChange={evalsPg.setPage} onPageSizeChange={evalsPg.setPageSize} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
