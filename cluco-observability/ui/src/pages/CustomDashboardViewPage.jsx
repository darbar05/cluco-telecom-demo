import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Pencil, LayoutDashboard } from 'lucide-react'
import { getDashboard, getMetrics } from '../api'
import { MetricCardWidget, ToolUsageChartWidget, TracesByProductWidget } from './DashboardBuilderPage'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonPage } from '../components/ui/Skeleton'

export default function CustomDashboardViewPage() {
  const { id } = useParams()
  const [dashboard, setDashboard] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    getDashboard(id)
      .then((dRes) => {
        const d = dRes.data
        if (d.error) { setDashboard(null); return }
        setDashboard(d)
        return getMetrics(d.product_id || undefined).then((mRes) => setMetrics(mRes.data))
      })
      .catch(() => setDashboard(null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <SkeletonPage />
  if (!dashboard) return (
    <div className="animate-fade-in">
      <div className="card border-red-200 bg-red-50/50 p-6 text-red-700">Dashboard not found.</div>
    </div>
  )

  const widgets = dashboard.layout?.widgets || []

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={dashboard.name}
        subtitle={dashboard.description}
        icon={LayoutDashboard}
        breadcrumbs={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: dashboard.name },
        ]}
        actions={
          <Link to={`/dashboard/${id}/edit`} className="btn-secondary text-xs">
            <Pencil size={14} /> Edit
          </Link>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {widgets.map((w) => {
          if (w.type === 'metric_card') return <MetricCardWidget key={w.id} widget={w} metrics={metrics} />
          if (w.type === 'tool_usage_chart') return <ToolUsageChartWidget key={w.id} metrics={metrics} />
          if (w.type === 'traces_by_product') return <TracesByProductWidget key={w.id} products={metrics?.products || []} />
          return null
        })}
      </div>

      {widgets.length === 0 && (
        <EmptyState
          icon={LayoutDashboard}
          title="No widgets"
          description="This dashboard has no widgets yet."
          action={<Link to={`/dashboard/${id}/edit`} className="btn-primary text-xs">Add widgets</Link>}
        />
      )}
    </div>
  )
}
