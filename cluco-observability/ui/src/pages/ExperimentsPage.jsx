import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getExperiments,
  createExperiment,
  getDatasets,
  getPromptTemplates,
  getEvaluators,
  getProducts,
} from '../api'
import {
  FlaskConical,
  Plus,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  Award,
  TrendingUp,
  Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

const STATUS_CONFIG = {
  running: { color: 'bg-blue-100 text-blue-800', icon: Loader2 },
  completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle },
  failed: { color: 'bg-red-100 text-red-800', icon: XCircle },
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.failed
  const Icon = config.icon
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}
    >
      <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {status || 'unknown'}
    </span>
  )
}

function getAvgScore(ex) {
  return ex.avg_score ?? ex.summary?.avg_score ?? null
}

function getPassRate(ex) {
  const raw = ex.pass_rate ?? ex.summary?.pass_rate ?? null
  if (raw == null) return null
  return raw > 1 ? raw / 100 : raw
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diffMs = now - d
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
  } catch {
    return '-'
  }
}

function PassRateBar({ rate }) {
  if (rate == null) return <span className="text-slate-400 text-xs">-</span>
  const pct = (rate * 100).toFixed(1)
  const color = rate >= 0.8 ? 'bg-emerald-500' : rate >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(rate * 100, 100)}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-700 w-12 text-right">{pct}%</span>
    </div>
  )
}

function SummaryStatsBar({ experiments }) {
  const completed = experiments.filter(e => e.status === 'completed')
  const running = experiments.filter(e => e.status === 'running').length
  const failed = experiments.filter(e => e.status === 'failed').length

  const scores = completed.map(e => getAvgScore(e)).filter(v => v != null)
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  const rates = completed.map(e => getPassRate(e)).filter(v => v != null)
  const avgPassRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <div className="card p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
          <FlaskConical size={15} className="text-brand-600" />
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Experiments</div>
          <div className="text-lg font-bold text-slate-800">{experiments.length}</div>
          {(running > 0 || failed > 0) && (
            <div className="text-2xs text-slate-400 mt-0.5">
              {running > 0 && <span className="text-blue-600">{running} running</span>}
              {running > 0 && failed > 0 && ' · '}
              {failed > 0 && <span className="text-red-500">{failed} failed</span>}
            </div>
          )}
        </div>
      </div>
      <div className="card p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <CheckCircle size={15} className="text-emerald-600" />
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Completed</div>
          <div className="text-lg font-bold text-emerald-700">{completed.length}</div>
        </div>
      </div>
      <div className="card p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
          <Award size={15} className="text-violet-600" />
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Avg Score</div>
          <div className="text-lg font-bold text-violet-700">{avgScore != null ? `${avgScore.toFixed(1)}%` : '-'}</div>
        </div>
      </div>
      <div className="card p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <TrendingUp size={15} className="text-amber-600" />
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Avg Pass Rate</div>
          <div className="text-lg font-bold text-amber-700">{avgPassRate != null ? `${(avgPassRate * 100).toFixed(1)}%` : '-'}</div>
        </div>
      </div>
    </div>
  )
}

export default function ExperimentsPage() {
  const navigate = useNavigate()
  const [experiments, setExperiments] = useState([])
  const [products, setProducts] = useState([])
  const [datasets, setDatasets] = useState([])
  const [prompts, setPrompts] = useState([])
  const [evaluators, setEvaluators] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [expRes, prRes, dsRes, ptRes, evRes] = await Promise.all([
        getExperiments({ product_id: productFilter || undefined }),
        getProducts(),
        getDatasets({ product_id: productFilter || undefined }),
        getPromptTemplates({ product_id: productFilter || undefined }),
        getEvaluators({ product_id: productFilter || undefined }),
      ])
      setExperiments(expRes.data?.experiments || [])
      setProducts(prRes.data?.products || [])
      setDatasets(dsRes.data?.datasets || [])
      setPrompts(ptRes.data?.prompts || ptRes.data || [])
      setEvaluators(evRes.data?.evaluators || evRes.data || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [productFilter])

  useEffect(() => {
    load()
  }, [load])

  const productOptions = useMemo(() => [
    { value: '', label: 'All Products' },
    ...(Array.isArray(products)
      ? products.map((p) =>
          typeof p === 'string'
            ? { value: p, label: p }
            : { value: p.product_id || p.id || p, label: p.name || p.product_id || p }
        )
      : []),
  ], [products])

  const toggleSelect = (id, e) => {
    e?.stopPropagation?.()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (e) => {
    e?.stopPropagation?.()
    if (selectedIds.size === experiments.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(experiments.map((ex) => ex.experiment_id || ex.id)))
    }
  }

  const handleCompareSelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length < 2) return
    const qs = new URLSearchParams({ experiment_ids: ids.join(',') }).toString()
    navigate(`/evaluations/experiments/compare?${qs}`)
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Experiments"
        subtitle="Run and compare prompt evaluation experiments"
        icon={FlaskConical}
        breadcrumbs={[
          { to: '/evaluations', label: 'Evaluations' },
          { label: 'Experiments' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {selectedIds.size >= 2 && (
              <button
                onClick={handleCompareSelected}
                className="btn-ghost flex items-center gap-2 text-xs"
              >
                <ChevronRight size={14} />
                Compare ({selectedIds.size})
              </button>
            )}
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary flex items-center gap-2 text-xs px-3 py-1.5"
            >
              <Plus size={14} />
              New Experiment
            </button>
          </div>
        }
      />

      <FilterBar onRefresh={load} className="mb-4">
        <FilterSelect
          value={productFilter}
          onChange={setProductFilter}
          options={productOptions}
          placeholder="All Products"
        />
      </FilterBar>

      {showModal && (
        <NewExperimentModal
          products={products}
          prompts={prompts}
          datasets={datasets}
          evaluators={evaluators}
          productFilter={productFilter}
          onClose={() => setShowModal(false)}
          onCreated={(id) => {
            setShowModal(false)
            load()
            if (id) navigate(`/evaluations/experiments/${id}`)
          }}
        />
      )}

      {loading ? (
        <SkeletonTable rows={6} cols={7} />
      ) : experiments.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No experiments yet"
          description="Create your first experiment to evaluate prompts against datasets."
          action={
            <button onClick={() => setShowModal(true)} className="btn-primary text-xs px-4 py-2">
              <Plus size={14} className="inline mr-2" />
              New Experiment
            </button>
          }
        />
      ) : (
        <>
          <SummaryStatsBar experiments={experiments} />

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === experiments.length && experiments.length > 0}
                        onChange={toggleSelectAll}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded"
                      />
                    </th>
                    <th className="text-left">Name</th>
                    <th className="text-left">Prompt</th>
                    <th className="text-left">Dataset</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Avg Score</th>
                    <th className="text-left min-w-[140px]">Pass Rate</th>
                    <th className="text-left">Created</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((ex) => {
                    const id = ex.experiment_id || ex.id
                    const isSelected = selectedIds.has(id)
                    const avgScore = getAvgScore(ex)
                    const passRate = getPassRate(ex)
                    return (
                      <tr
                        key={id}
                        onClick={() => navigate(`/evaluations/experiments/${id}`)}
                        className={`cursor-pointer ${isSelected ? 'bg-brand-50/50' : ''}`}
                      >
                        <td className="text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(id)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded"
                          />
                        </td>
                        <td>
                          <span className="font-medium text-slate-900">{ex.name}</span>
                        </td>
                        <td className="text-slate-600">
                          <span className="text-xs">{ex.prompt_name || ex.prompt_id || '-'}</span>
                          <span className="text-2xs text-slate-400 ml-1">v{ex.prompt_version ?? '-'}</span>
                        </td>
                        <td className="text-slate-600 text-xs">
                          {ex.dataset_name || ex.dataset_id || '-'}
                        </td>
                        <td>
                          <StatusBadge status={ex.status} />
                        </td>
                        <td className="text-right">
                          {avgScore != null ? (
                            <span className={`text-xs font-bold ${avgScore >= 60 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {Number(avgScore).toFixed(1)}%
                            </span>
                          ) : <span className="text-xs text-slate-400">-</span>}
                        </td>
                        <td>
                          <PassRateBar rate={passRate} />
                        </td>
                        <td>
                          <span className="text-xs text-slate-500" title={ex.created_at ? new Date(ex.created_at).toLocaleString() : ''}>
                            {formatRelativeTime(ex.created_at)}
                          </span>
                        </td>
                        <td>
                          <ChevronRight size={14} className="text-slate-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NewExperimentModal({
  products,
  prompts,
  datasets,
  evaluators,
  productFilter,
  onClose,
  onCreated,
}) {
  const [name, setName] = useState('')
  const [productId, setProductId] = useState(productFilter || 'default')
  const [promptId, setPromptId] = useState('')
  const [promptVersion, setPromptVersion] = useState(1)
  const [datasetId, setDatasetId] = useState('')
  const [evaluatorIds, setEvaluatorIds] = useState([])
  const [modelConfig, setModelConfig] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const productList = Array.isArray(products) ? products : []
  const promptList = Array.isArray(prompts) ? prompts : []
  const datasetList = Array.isArray(datasets) ? datasets : []
  const evaluatorList = Array.isArray(evaluators) ? evaluators : []

  const toggleEvaluator = (id) => {
    setEvaluatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleSubmit = async () => {
    setError('')
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!promptId) {
      setError('Please select a prompt')
      return
    }
    if (!datasetId) {
      setError('Please select a dataset')
      return
    }
    if (evaluatorIds.length === 0) {
      setError('Please select at least one evaluator')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        product_id: productId || 'default',
        prompt_id: promptId,
        prompt_version: Number(promptVersion) || 1,
        dataset_id: datasetId,
        evaluator_ids: evaluatorIds,
      }
      if (modelConfig.trim()) {
        try {
          payload.model_config = JSON.parse(modelConfig.trim())
        } catch {
          setError('Invalid JSON in model config')
          setSaving(false)
          return
        }
      }
      const res = await createExperiment(payload)
      onCreated(res.data?.experiment_id || res.data?.id)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to create experiment')
    }
    setSaving(false)
  }

  const inputClass =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white'
  const labelClass = 'block text-xs font-medium text-slate-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New Experiment</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            &times;
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Prompt v2 vs v1"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className={inputClass}
            >
              <option value="default">default</option>
              {productList.map((p) => {
                const val = typeof p === 'string' ? p : p.product_id || p.id
                const lab = typeof p === 'string' ? p : p.name || p.product_id
                return (
                  <option key={val} value={val}>
                    {lab}
                  </option>
                )
              })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Prompt</label>
              <select
                value={promptId}
                onChange={(e) => setPromptId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select prompt</option>
                {promptList.map((p) => {
                  const id = p.prompt_id || p.id
                  const lab = p.name || p.prompt_id || id
                  return (
                    <option key={id} value={id}>
                      {lab}
                    </option>
                  )
                })}
              </select>
            </div>
            <div>
              <label className={labelClass}>Prompt Version</label>
              <input
                type="number"
                min={1}
                value={promptVersion}
                onChange={(e) => setPromptVersion(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Dataset</label>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select dataset</option>
              {datasetList.map((d) => {
                const id = d.dataset_id || d.id
                const lab = d.name || id
                return (
                  <option key={id} value={id}>
                    {lab}
                  </option>
                )
              })}
            </select>
          </div>
          <div>
            <label className={labelClass}>Evaluators</label>
            <div className="border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto space-y-2">
              {evaluatorList.length === 0 ? (
                <p className="text-xs text-slate-500">No evaluators found</p>
              ) : (
                evaluatorList.map((ev) => {
                  const id = ev.evaluator_id || ev.id
                  const checked = evaluatorIds.includes(id)
                  return (
                    <label
                      key={id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEvaluator(id)}
                      />
                      <span className="text-sm">{ev.name || id}</span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Model Config (optional JSON)</label>
            <textarea
              value={modelConfig}
              onChange={(e) => setModelConfig(e.target.value)}
              placeholder='{"model": "gpt-4", "temperature": 0.7}'
              className={`${inputClass} font-mono text-xs min-h-[60px]`}
              rows={3}
            />
          </div>
          {error && (
            <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
          )}
        </div>
        <div className="p-6 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
