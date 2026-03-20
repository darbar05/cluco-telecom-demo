import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2, ArrowLeft, LayoutDashboard } from 'lucide-react'
import { getDashboard, createDashboard, updateDashboard, getProducts } from '../api'
import PageHeader from '../components/ui/PageHeader'

const WIDGET_TYPES = [
  { value: 'metric_card', label: 'Metric Card', metricKeys: ['trace_count', 'avg_latency_ms', 'total_tokens'] },
  { value: 'tool_usage_chart', label: 'Tool Usage Chart', metricKeys: [] },
  { value: 'traces_by_product', label: 'Traces by Product', metricKeys: [] },
]

function MetricCardWidget({ widget, metrics }) {
  const value = metrics?.[widget.metricKey]
  const formatted = widget.metricKey === 'avg_latency_ms' ? `${(value ?? 0).toFixed(0)} ms` : (value ?? 0).toLocaleString()
  return (
    <div className="stat-card">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">{widget.title}</div>
      <div className="text-2xl font-bold text-slate-800">{formatted}</div>
    </div>
  )
}

function ToolUsageChartWidget({ metrics }) {
  const toolUsage = metrics?.tool_usage || {}
  const data = Object.entries(toolUsage).map(([name, count]) => ({ name, count }))
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Tool Usage</div>
      {data.length === 0 ? (
        <div className="text-slate-400 py-4 text-sm">No tool calls recorded yet.</div>
      ) : (
        <div className="space-y-2">
          {data.map(({ name, count }) => (
            <div key={name} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
              <span className="font-mono text-sm text-slate-700">{name}</span>
              <span className="badge-brand">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TracesByProductWidget({ products }) {
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Traces by Product</div>
      {!products?.length ? (
        <div className="text-slate-400 py-4 text-sm">No products yet.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {products.map((p) => (
            <span key={p} className="badge-neutral">{p}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardBuilderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id) && id !== 'new'
  const [name, setName] = useState('')
  const [productId, setProductId] = useState('')
  const [description, setDescription] = useState('')
  const [widgets, setWidgets] = useState([])
  const [loading, setLoading] = useState(false)
  const [products, setProducts] = useState([])

  useEffect(() => {
    getProducts().then((r) => setProducts(r.data.products || []))
    if (isEdit) {
      getDashboard(id).then((r) => {
        if (r.data.error) return
        setName(r.data.name || '')
        setProductId(r.data.product_id || '')
        setWidgets((r.data.layout?.widgets || []).length ? r.data.layout.widgets : [])
      })
    }
  }, [id, isEdit])

  const addWidget = (type) => {
    const w = { id: `w${Date.now()}`, type, title: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), metricKey: '' }
    if (WIDGET_TYPES.find((t) => t.value === type)?.metricKeys?.length) {
      w.metricKey = WIDGET_TYPES.find((t) => t.value === type).metricKeys[0]
    }
    setWidgets([...widgets, w])
  }

  const removeWidget = (idx) => setWidgets(widgets.filter((_, i) => i !== idx))
  const updateWidget = (idx, updates) => setWidgets(widgets.map((w, i) => (i === idx ? { ...w, ...updates } : w)))

  const save = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const payload = { name: name.trim(), product_id: productId || undefined, description: description.trim() || undefined, layout: { widgets } }
      if (isEdit) {
        await updateDashboard(id, payload)
      } else {
        const res = await createDashboard(payload)
        navigate(`/dashboard/${res.data.id}/edit`)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={isEdit ? 'Edit Dashboard' : 'Create Dashboard'}
        icon={LayoutDashboard}
        breadcrumbs={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: isEdit ? 'Edit' : 'New' },
        ]}
      />

      <div className="card p-6 space-y-4 max-w-2xl mb-6">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="My Dashboard" />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Product filter (optional)</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="select-field w-full">
            <option value="">All products</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Description (optional)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input-field" placeholder="Describe this dashboard" />
        </div>
      </div>

      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Widgets</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {WIDGET_TYPES.map((t) => (
            <button key={t.value} onClick={() => addWidget(t.value)} className="btn-secondary !py-1.5 text-xs">
              <Plus size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {widgets.map((w, idx) => (
            <div key={w.id} className="card p-4 flex items-start gap-3">
              <div className="flex-1 space-y-2">
                <input value={w.title} onChange={(e) => updateWidget(idx, { title: e.target.value })} className="input-field text-xs" placeholder="Widget title" />
                {WIDGET_TYPES.find((t) => t.value === w.type)?.metricKeys?.length ? (
                  <select value={w.metricKey} onChange={(e) => updateWidget(idx, { metricKey: e.target.value })} className="select-field text-xs">
                    {WIDGET_TYPES.find((t) => t.value === w.type).metricKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                ) : null}
              </div>
              <button onClick={() => removeWidget(idx)} className="btn-ghost !p-2 text-red-500 hover:text-red-700 hover:bg-red-50">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={loading} className="btn-primary">
          {loading ? 'Saving...' : isEdit ? 'Save' : 'Create & continue editing'}
        </button>
        {isEdit && (
          <button onClick={() => navigate(`/dashboard/${id}`)} className="btn-secondary">View dashboard</button>
        )}
      </div>
    </div>
  )
}

export { MetricCardWidget, ToolUsageChartWidget, TracesByProductWidget, WIDGET_TYPES }
