import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getSessions, getProducts } from '../api'
import { Users, ArrowUpRight } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeleton'
import Pagination from '../components/ui/Pagination'
import { formatNumber, formatCost } from '../utils/format'

/* Compact inline summary — not duplicating Dashboard */
function SessionsSummaryBar({ sessions, total }) {
  if (sessions.length === 0) return null
  const totalTraces = sessions.reduce((a, s) => a + (s.trace_count || 0), 0)
  const totalCost = sessions.reduce((a, s) => a + (s.total_cost_usd || 0), 0)
  const totalErrors = sessions.reduce((a, s) => a + (s.errors || 0), 0)
  return (
    <div className="flex items-center gap-5 px-4 py-2.5 mb-4 rounded-lg bg-slate-50/80 border border-slate-200/60 text-xs">
      <span className="text-slate-500"><span className="font-semibold text-slate-700">{total}</span> sessions</span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-500">{totalTraces} traces</span>
      <span className="text-emerald-600 font-medium">{formatCost(totalCost).display}</span>
      {totalErrors > 0 && <span className="text-red-600 font-medium">{totalErrors} errors</span>}
    </div>
  )
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState([])
  const [total, setTotal] = useState(0)
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const load = async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([
        getSessions({
          product_id: productFilter || undefined,
          service_name: agentFilter || undefined,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        getProducts()
      ])
      setSessions(s.data.sessions || [])
      setTotal(s.data.total || 0)
      setProducts(p.data.products || [])
    } catch (e) {
      setSessions([])
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productFilter, agentFilter, page, pageSize])
  useEffect(() => { setPage(1) }, [productFilter, agentFilter])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Sessions"
        subtitle="View and inspect user sessions across your agents"
        icon={Users}
        actions={
          <FilterBar onRefresh={load}>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
            <input
              placeholder="Filter by agent..."
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="input-field !w-40 text-xs !py-1.5"
            />
          </FilterBar>
        }
      />

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No sessions found"
          description="Sessions are created when traces include a session_id."
        />
      ) : (
        <>
          <SessionsSummaryBar sessions={sessions} total={total} />

          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Session ID</th>
                  <th className="text-left">Agent</th>
                  <th className="text-right">Traces</th>
                  <th className="text-right">Errors</th>
                  <th className="text-right">Latency</th>
                  <th className="text-right">Tokens</th>
                  <th className="text-right">Cost</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, idx) => (
                  <tr key={s.session_id || `session-${idx}`}>
                    <td>
                      <Link to={`/sessions/${encodeURIComponent(s.session_id || '')}`} className="text-brand-600 hover:text-brand-700 font-mono text-xs font-medium transition-colors">
                        {(s.session_id || '').length > 28 ? (s.session_id || '').slice(0, 28) + '...' : (s.session_id || '-')}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/agents/${encodeURIComponent(s.agent || s.service_name || '')}`} className="badge-neutral hover:bg-brand-100 transition-colors cursor-pointer text-xs">
                        {s.agent || s.service_name || '-'}
                      </Link>
                    </td>
                    <td className="text-right font-mono text-xs">{s.trace_count ?? 0}</td>
                    <td className="text-right">
                      {s.errors > 0 ? <span className="badge-error">{s.errors}</span> : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="text-right font-mono text-xs">{s.total_latency_ms != null ? `${s.total_latency_ms.toFixed(0)} ms` : '—'}</td>
                    <td className="text-right font-mono text-xs">{(s.total_tokens || 0).toLocaleString()}</td>
                    <td className="text-right font-mono text-xs">
                      {s.total_cost_usd != null ? (
                        <span className="text-emerald-600 font-medium">${s.total_cost_usd.toFixed(4)}</span>
                      ) : '-'}
                    </td>
                    <td>
                      <Link to={`/sessions/${encodeURIComponent(s.session_id)}`} className="text-slate-400 hover:text-brand-600 transition-colors">
                        <ArrowUpRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              currentPage={page}
              totalItems={total}
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
