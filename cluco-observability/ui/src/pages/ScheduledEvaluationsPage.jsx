import { useState, useEffect, useCallback } from 'react'
import {
  getScheduledEvaluations,
  createScheduledEvaluation,
  updateScheduledEvaluation,
  deleteScheduledEvaluation,
  getEvaluationSuites,
  getDatasets,
  getProducts,
} from '../api'
import { Clock, Plus, Trash2, Edit2, PlayCircle, PauseCircle, X } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

export default function ScheduledEvaluationsPage() {
  const [schedules, setSchedules] = useState([])
  const [suites, setSuites] = useState([])
  const [datasets, setDatasets] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [togglingId, setTogglingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = productFilter ? { product_id: productFilter } : {}
      const [schedRes, suitesRes, datasetsRes, productsRes] = await Promise.all([
        getScheduledEvaluations(params),
        getEvaluationSuites({}),
        getDatasets({}),
        getProducts(),
      ])
      setSchedules(schedRes.data?.schedules || [])
      setSuites(suitesRes.data?.suites || suitesRes.data?.evaluation_suites || [])
      setDatasets(datasetsRes.data?.datasets || [])
      setProducts(productsRes.data?.products || [])
    } catch (e) {
      console.error(e)
      setSchedules([])
    }
    setLoading(false)
  }, [productFilter])

  useEffect(() => {
    load()
  }, [load])

  const suiteMap = Object.fromEntries((suites || []).map((s) => [s.suite_id || s.id, s.name || s.suite_id]))
  const datasetMap = Object.fromEntries((datasets || []).map((d) => [d.dataset_id || d.id, d.name || d.dataset_id]))

  const handleToggle = async (schedule) => {
    setTogglingId(schedule.schedule_id)
    try {
      await updateScheduledEvaluation(schedule.schedule_id, {
        enabled: !schedule.enabled,
      })
      load()
    } catch (e) {
      console.error(e)
    }
    setTogglingId(null)
  }

  const handleDelete = async (schedule) => {
    if (!confirm(`Delete schedule "${schedule.name || schedule.schedule_id}"?`)) return
    try {
      await deleteScheduledEvaluation(schedule.schedule_id)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async (payload) => {
    try {
      if (editingSchedule) {
        await updateScheduledEvaluation(editingSchedule.schedule_id, payload)
      } else {
        await createScheduledEvaluation(payload)
      }
      setModalOpen(false)
      setEditingSchedule(null)
      load()
    } catch (e) {
      console.error(e)
      throw e
    }
  }

  const openNewModal = () => {
    setEditingSchedule(null)
    setModalOpen(true)
  }

  const openEditModal = (schedule) => {
    setEditingSchedule(schedule)
    setModalOpen(true)
  }

  const formatDate = (d) => {
    if (!d) return '—'
    const dt = typeof d === 'string' ? new Date(d) : d
    return isNaN(dt.getTime()) ? '—' : dt.toLocaleString()
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Scheduled Evaluations"
        subtitle="Automate evaluation runs on a schedule with alerting"
        icon={Clock}
        actions={
          <button onClick={openNewModal} className="btn-primary text-xs flex items-center gap-1.5">
            <Plus size={14} /> New Schedule
          </button>
        }
      />

      <div className="flex justify-between items-center mb-6">
        <FilterBar onRefresh={load}>
          <FilterSelect
            value={productFilter}
            onChange={setProductFilter}
            options={[
              { value: '', label: 'All Products' },
              ...products.map((p) => ({ value: p, label: p })),
            ]}
            placeholder="All Products"
          />
        </FilterBar>
      </div>

      {modalOpen && (
        <ScheduleModal
          schedule={editingSchedule}
          suites={suites}
          datasets={datasets}
          products={products}
          onSave={handleSave}
          onClose={() => {
            setModalOpen(false)
            setEditingSchedule(null)
          }}
        />
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={8} />
      ) : schedules.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No scheduled evaluations yet"
          description="Create a schedule to automatically run evaluation suites against datasets on a cron schedule."
          action={
            <button onClick={openNewModal} className="btn-primary text-sm flex items-center gap-2">
              <Plus size={16} /> New Schedule
            </button>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-slate-200">
                {['Name', 'Cron', 'Suite', 'Dataset', 'Product', 'Enabled', 'Last Run', 'Next Run', 'Actions'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.schedule_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{s.name || s.schedule_id || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.cron || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {suiteMap[s.suite_id] || s.suite_id || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {datasetMap[s.dataset_id] || s.dataset_id || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.product_id || 'default'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(s)}
                      disabled={togglingId === s.schedule_id}
                      className="flex items-center gap-1.5"
                      title={s.enabled ? 'Disable' : 'Enable'}
                    >
                      {togglingId === s.schedule_id ? (
                        <span className="text-xs text-slate-400">...</span>
                      ) : s.enabled ? (
                        <PlayCircle size={16} className="text-emerald-600" />
                      ) : (
                        <PauseCircle size={16} className="text-slate-400" />
                      )}
                      <span
                        className={`text-xs font-medium ${
                          s.enabled ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                      >
                        {s.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(s.last_run)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(s.next_run)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditModal(s)}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ScheduleModal({ schedule, suites, datasets, products, onSave, onClose }) {
  const isEdit = !!schedule
  const [name, setName] = useState(schedule?.name || '')
  const [cron, setCron] = useState(schedule?.cron || '')
  const [suiteId, setSuiteId] = useState(schedule?.suite_id || '')
  const [datasetId, setDatasetId] = useState(schedule?.dataset_id || '')
  const [productId, setProductId] = useState(schedule?.product_id || 'default')
  const [threshold, setThreshold] = useState(schedule?.threshold ?? 60)
  const [alertOnFailure, setAlertOnFailure] = useState(schedule?.alert_on_failure ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const suiteOptions = (suites || []).map((s) => ({
    value: s.suite_id || s.id,
    label: s.name || s.suite_id || 'Unnamed',
  }))
  const datasetOptions = (datasets || []).map((d) => ({
    value: d.dataset_id || d.id,
    label: d.name || d.dataset_id || 'Unnamed',
  }))
  const productOptions = (products || []).map((p) => ({ value: p, label: p }))
  if (!productOptions.find((o) => o.value === 'default')) {
    productOptions.unshift({ value: 'default', label: 'default' })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!cron.trim()) {
      setError('Cron expression is required')
      return
    }
    if (!suiteId) {
      setError('Evaluation suite is required')
      return
    }
    if (!datasetId) {
      setError('Dataset is required')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        cron: cron.trim(),
        suite_id: suiteId,
        dataset_id: datasetId,
        product_id: productId || 'default',
        threshold: Number(threshold) || 60,
        alert_on_failure: alertOnFailure,
      })
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Save failed')
    }
    setSaving(false)
  }

  const inputClass =
    'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent'
  const labelClass = 'block text-xs font-semibold text-slate-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">
            {isEdit ? 'Edit Schedule' : 'New Schedule'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Daily quality check"
            />
          </div>

          <div>
            <label className={labelClass}>Cron expression</label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className={inputClass}
              placeholder="0 0 * * *"
            />
            <p className="mt-1 text-xs text-slate-500">
              e.g. &quot;0 0 * * *&quot; = daily at midnight (minute hour day month weekday)
            </p>
          </div>

          <div>
            <label className={labelClass}>Evaluation suite</label>
            <select
              value={suiteId}
              onChange={(e) => setSuiteId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select suite...</option>
              {suiteOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Dataset</label>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select dataset...</option>
              {datasetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className={inputClass}
            >
              {productOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Score threshold (for alerting)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 60)}
              className={inputClass}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="alert_on_failure"
              checked={alertOnFailure}
              onChange={(e) => setAlertOnFailure(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="alert_on_failure" className="text-sm font-medium text-slate-700">
              Alert on failure
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
