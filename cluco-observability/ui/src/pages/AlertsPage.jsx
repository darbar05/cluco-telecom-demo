import { useState, useEffect } from 'react'
import { getAlerts, getAnomalies, acknowledgeAlert, getProducts, sendAlertEmail } from '../api'
import { AlertTriangle, Bell, CheckCircle, Shield, Mail, Settings, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import Pagination from '../components/ui/Pagination'
import { useClientPagination } from '../hooks/useClientPagination'

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('alerts')

  const load = async () => {
    setLoading(true)
    try {
      const [ar, anr, pr] = await Promise.all([
        getAlerts({ product_id: productFilter || undefined, limit: 100 }),
        getAnomalies({ product_id: productFilter || undefined, days: 7 }),
        getProducts(),
      ])
      setAlerts(ar.data.alerts || [])
      setAnomalies(anr.data.anomalies || [])
      setProducts(pr.data.products || [])
    } catch (e) {
      setAlerts([])
      setAnomalies([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [productFilter])

  const handleAcknowledge = async (alertId) => {
    try {
      await acknowledgeAlert(alertId)
      load()
    } catch (e) {
      console.error('Acknowledge failed:', e)
    }
  }

  const handleSendEmail = async (alertId) => {
    try {
      await sendAlertEmail(alertId)
      alert('Alert email sent!')
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to send email')
    }
  }

  const alertsPg = useClientPagination(alerts)
  const anomaliesPg = useClientPagination(anomalies)
  const unacknowledged = alerts.filter(a => !a.acknowledged).length

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Alerts"
        subtitle="Budget alerts, anomalies, and system warnings"
        icon={Bell}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/alert-config" className="btn-ghost text-xs flex items-center gap-1.5" title="Configure email alerts">
              <Mail size={14} /> Email Config
            </Link>
            <FilterBar onRefresh={load}>
              <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
            </FilterBar>
          </div>
        }
      />

      {loading ? <SkeletonTable rows={6} cols={5} /> : (
        <div className="space-y-5">
          {/* ── Compact summary + tab selector ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5 text-xs">
              <span className="text-slate-500">{unacknowledged > 0 ? <span className="text-red-600 font-semibold">{unacknowledged} active</span> : <span className="text-green-600 font-medium">All clear</span>}</span>
              <span className="text-slate-400">{anomalies.length} anomalies (7d)</span>
            </div>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
              <button onClick={() => setTab('alerts')} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${tab === 'alerts' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Alerts ({alerts.length})
              </button>
              <button onClick={() => setTab('anomalies')} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${tab === 'anomalies' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Anomalies ({anomalies.length})
              </button>
            </div>
          </div>

          {tab === 'alerts' && (
            alerts.length === 0 ? (
              <EmptyState icon={Bell} title="No alerts" description="Budget and system alerts will appear here." />
            ) : (
              <div className="card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Type</th>
                      <th className="text-left">Severity</th>
                      <th className="text-left">Message</th>
                      <th className="text-left">Trace</th>
                      <th className="text-left">Date</th>
                      <th className="text-center w-16">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertsPg.paginatedData.map((a, i) => (
                      <tr key={a._id || i} className={a.acknowledged ? 'opacity-40' : ''}>
                        <td><span className="badge-warning text-2xs">{a.alert_type}</span></td>
                        <td><span className={`text-xs font-medium ${a.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>{a.severity}</span></td>
                        <td className="text-xs text-slate-700 max-w-sm truncate">{a.message}</td>
                        <td>{a.trace_id ? <Link to={`/trace/${a.trace_id}`} className="text-xs text-brand-600 hover:underline font-mono">{a.trace_id.slice(0, 12)}...</Link> : '-'}</td>
                        <td className="text-xs text-slate-400">{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {!a.acknowledged ? (
                              <button onClick={() => handleAcknowledge(a._id)} className="p-1 text-brand-600 hover:text-brand-700" title="Acknowledge"><CheckCircle size={14} /></button>
                            ) : (
                              <CheckCircle size={14} className="text-slate-300" />
                            )}
                            <button onClick={() => handleSendEmail(a._id)} className="p-1 text-slate-400 hover:text-brand-600 transition-colors" title="Send via email">
                              <Send size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination currentPage={alertsPg.page} totalItems={alertsPg.totalItems} pageSize={alertsPg.pageSize} onPageChange={alertsPg.setPage} onPageSizeChange={alertsPg.setPageSize} />
              </div>
            )
          )}

          {tab === 'anomalies' && (
            anomalies.length === 0 ? (
              <EmptyState icon={Shield} title="No anomalies" description="Traces with unusual cost, tokens, or latency will appear here." />
            ) : (
              <div className="card overflow-hidden">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Trace</th>
                      <th className="text-right">Tokens</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Latency</th>
                      <th className="text-left">Reason</th>
                      <th className="text-left">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomaliesPg.paginatedData.map((a, i) => (
                      <tr key={a.trace_id || i}>
                        <td><Link to={`/trace/${a.trace_id}`} className="text-xs text-brand-600 hover:underline font-mono">{a.trace_id?.slice(0, 16)}...</Link></td>
                        <td className="text-right text-xs font-medium">{(a.tokens || 0).toLocaleString()}</td>
                        <td className="text-right text-xs text-emerald-600 font-medium">${(a.cost_usd || 0).toFixed(4)}</td>
                        <td className="text-right text-xs">{((a.latency_ms || 0) / 1000).toFixed(1)}s</td>
                        <td className="text-xs text-red-600 max-w-sm truncate">{(a.reasons || []).join('; ')}</td>
                        <td className="text-xs text-slate-400">{a.created_at ? new Date(a.created_at).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination currentPage={anomaliesPg.page} totalItems={anomaliesPg.totalItems} pageSize={anomaliesPg.pageSize} onPageChange={anomaliesPg.setPage} onPageSizeChange={anomaliesPg.setPageSize} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
