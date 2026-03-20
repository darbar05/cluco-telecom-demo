import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getTraces, getProducts, addThumbsFeedback, getLabelingSessions, createLabelingSession, addTracesToLabelingSession, getDatasets, createDataset, exportTracesToDataset, getEvaluators, runEvaluatorOnAllTraces } from '../api'
import { Activity, Radio, Zap, Database, DollarSign, Cpu, ChevronDown, Filter, X, Plus, Play, Loader2, Columns } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import PageHeader from '../components/ui/PageHeader'
import StatusBadge from '../components/ui/StatusBadge'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeleton'
import Pagination from '../components/ui/Pagination'
import { formatLatency, formatNumber, formatCost } from '../utils/format'

function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diffMs = now - d
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const yearStr = d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''

    let relative = ''
    if (diffMins < 1) relative = 'just now'
    else if (diffMins < 60) relative = `${diffMins}m ago`
    else if (diffHours < 24) relative = `${diffHours}h ago`
    else if (diffDays < 7) relative = `${diffDays}d ago`

    return { dateStr: `${dateStr}${yearStr}`, timeStr, relative }
  } catch {
    return '-'
  }
}

function truncateText(text, maxLen = 80) {
  if (!text) return ''
  const str = typeof text === 'string' ? text : JSON.stringify(text)
  const clean = str.replace(/\n/g, ' ').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean
}

function SummaryCard({ icon: Icon, label, color, bg, children }) {
  return (
    <div className="card p-3 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        <Icon size={15} className={color} />
      </div>
      <div className="min-w-0">
        <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">{label}</div>
        <div className="flex items-baseline gap-0.5 mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function TracesSummaryBar({ traces }) {
  if (traces.length === 0) return null
  const ok = traces.filter(t => t.status === 'ok').length
  const err = traces.filter(t => t.status === 'error').length
  const totalCost = traces.reduce((a, t) => a + (t.total_cost_usd || 0), 0)
  const totalTokens = traces.reduce((a, t) => a + (t.total_tokens || 0), 0)
  const llmTokens = traces.reduce((a, t) => a + (t.llm_tokens || 0), 0)
  const embTokens = traces.reduce((a, t) => a + (t.embedding_tokens || 0), 0)
  const llmCost = traces.reduce((a, t) => a + (t.llm_cost_usd || 0), 0)
  const embCost = traces.reduce((a, t) => a + (t.embedding_cost_usd || 0), 0)

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-5">
      <SummaryCard icon={Activity} label="Traces" color="text-brand-600" bg="bg-brand-50">
        <span className="text-lg font-bold text-slate-800">{traces.length}</span>
        <span className="text-2xs text-slate-400 ml-1.5">{ok} ok{err > 0 && <span className="text-red-500 ml-1">{err} err</span>}</span>
      </SummaryCard>
      <SummaryCard icon={Zap} label="LLM Tokens" color="text-violet-600" bg="bg-violet-50">
        <span className="text-lg font-bold text-slate-800" title={llmTokens.toLocaleString()}>{formatNumber(llmTokens).display}</span>
        <span className="text-2xs text-violet-400 ml-1" title={`$${llmCost.toFixed(6)}`}>{formatCost(llmCost).display}</span>
      </SummaryCard>
      <SummaryCard icon={Database} label="Embedding Tokens" color="text-cyan-600" bg="bg-cyan-50">
        <span className="text-lg font-bold text-slate-800" title={embTokens.toLocaleString()}>{formatNumber(embTokens).display}</span>
        <span className="text-2xs text-cyan-400 ml-1" title={`$${embCost.toFixed(6)}`}>{formatCost(embCost).display}</span>
      </SummaryCard>
      <SummaryCard icon={Cpu} label="Total Tokens" color="text-blue-600" bg="bg-blue-50">
        <span className="text-lg font-bold text-slate-800" title={totalTokens.toLocaleString()}>{formatNumber(totalTokens).display}</span>
      </SummaryCard>
      <SummaryCard icon={DollarSign} label="Total Cost" color="text-emerald-600" bg="bg-emerald-50">
        <span className="text-lg font-bold text-emerald-700" title={`$${totalCost.toFixed(6)}`}>{formatCost(totalCost).display}</span>
      </SummaryCard>
      <div className="card p-3 flex flex-col justify-center items-center">
        <div className="text-2xs font-medium uppercase tracking-wider text-slate-400 mb-1">Token Split</div>
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
          {llmTokens > 0 && <div className="bg-violet-500 h-full transition-all" style={{ width: `${totalTokens > 0 ? (llmTokens / totalTokens * 100) : 0}%` }} title={`LLM: ${llmTokens.toLocaleString()}`} />}
          {embTokens > 0 && <div className="bg-cyan-400 h-full transition-all" style={{ width: `${totalTokens > 0 ? (embTokens / totalTokens * 100) : 0}%` }} title={`Embedding: ${embTokens.toLocaleString()}`} />}
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-2xs"><span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />LLM</span>
          <span className="flex items-center gap-1 text-2xs"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />Embed</span>
        </div>
      </div>
    </div>
  )
}

function AssessmentBadge({ value }) {
  if (value === 'True' || value === true)
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-semibold bg-emerald-50 text-emerald-700">True</span>
  if (value === 'False' || value === false)
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-semibold bg-red-50 text-red-600">False</span>
  return <span className="text-2xs text-slate-400">{String(value)}</span>
}

function AssessmentHeaderCell({ name, traces, isPinned, evaluatorId, onRemove, onRun, runningEval }) {
  let trueCount = 0, falseCount = 0
  const sparkData = []
  for (let i = 0; i < traces.length; i++) {
    const a = traces[i].assessments?.[name]
    if (!a) { sparkData.push({ i, v: 0.5 }); continue }
    trueCount += a.true_count || 0
    falseCount += a.false_count || 0
    sparkData.push({ i, v: a.true_count > 0 ? 1 : 0 })
  }
  const total = trueCount + falseCount
  const truePct = total > 0 ? Math.round(trueCount / total * 100) : 0
  const isRunning = runningEval === evaluatorId

  return (
    <th className="text-left text-xs min-w-[120px]">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-slate-600 truncate max-w-[80px]" title={name}>{name}</span>
          {evaluatorId && (
            <button
              onClick={(e) => { e.stopPropagation(); onRun?.(evaluatorId) }}
              disabled={isRunning}
              className="p-0.5 rounded hover:bg-brand-50 text-slate-400 hover:text-brand-600 transition-colors disabled:opacity-50"
              title="Run evaluator on visible traces"
            >
              {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            </button>
          )}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(name) }}
              className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
              title="Remove column"
            >
              <X size={11} />
            </button>
          )}
        </div>
        {total > 0 && (
          <>
            <div className="w-16 h-6">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`sg-${name}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="#10b981" fill={`url(#sg-${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-2xs font-bold ${truePct >= 50 ? 'text-emerald-600' : 'text-red-500'}`}>{truePct}%</span>
              <span className="text-2xs text-slate-400">{trueCount}T / {falseCount}F</span>
            </div>
          </>
        )}
      </div>
    </th>
  )
}

export default function TracesPage() {
  const [traces, setTraces] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [assessmentFilter, setAssessmentFilter] = useState('')
  const [assessmentValueFilter, setAssessmentValueFilter] = useState('')
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(null)
  const [selectedTraces, setSelectedTraces] = useState(new Set())
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showLabelingModal, setShowLabelingModal] = useState(false)
  const [showDatasetModal, setShowDatasetModal] = useState(false)
  const [labelingSessions, setLabelingSessions] = useState([])
  const [datasets, setDatasets] = useState([])
  const [newSessionName, setNewSessionName] = useState('')
  const [newDatasetName, setNewDatasetName] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [pinnedEvaluators, setPinnedEvaluators] = useState(
    () => JSON.parse(localStorage.getItem('cluco_pinned_evaluators') || '[]')
  )
  const [hiddenColumns, setHiddenColumns] = useState(
    () => new Set(JSON.parse(localStorage.getItem('cluco_hidden_columns') || '[]'))
  )
  const [allEvaluators, setAllEvaluators] = useState([])
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [runningEval, setRunningEval] = useState(null)
  const pickerRef = useRef(null)

  const assessmentNames = useMemo(() => {
    const names = new Set()
    for (const t of traces) {
      if (t.assessments) Object.keys(t.assessments).forEach(k => names.add(k))
    }
    return [...names]
  }, [traces])

  const allColumnNames = useMemo(() => {
    const combined = new Set([...assessmentNames, ...pinnedEvaluators.map(p => p.name)])
    return [...combined].filter(n => !hiddenColumns.has(n))
  }, [assessmentNames, pinnedEvaluators, hiddenColumns])

  const pinnedNames = useMemo(() => new Set(pinnedEvaluators.map(p => p.name)), [pinnedEvaluators])

  const evaluatorByName = useMemo(() => {
    const m = {}
    for (const ev of allEvaluators) m[ev.name] = ev
    for (const p of pinnedEvaluators) m[p.name] = p
    return m
  }, [allEvaluators, pinnedEvaluators])

  const availableToAdd = useMemo(() => {
    return allEvaluators.filter(ev => !allColumnNames.includes(ev.name))
  }, [allEvaluators, allColumnNames])

  const load = async () => {
    setLoading(true)
    setApiError(null)
    try {
      const params = {
        product_id: productFilter || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }
      if (assessmentFilter) params.assessment_name = assessmentFilter
      if (assessmentValueFilter) params.assessment_value = assessmentValueFilter
      const [tr, pr] = await Promise.all([
        getTraces(params),
        getProducts()
      ])
      setTraces(tr.data?.traces ?? [])
      setTotalCount(tr.data?.total ?? tr.data?.traces?.length ?? 0)
      setProducts(pr.data?.products ?? [])
    } catch (e) {
      setTraces([])
      setTotalCount(0)
      setProducts([])
      const isNetwork = e.code === 'ECONNREFUSED' || e.message?.includes('Network')
      setApiError(isNetwork
        ? 'Cannot reach Cluco backend. Is it running on port 9410?'
        : (e.response?.data?.detail ?? e.message) || 'Failed to load traces.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    getEvaluators().then(r => setAllEvaluators(r.data?.evaluators || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowColumnPicker(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const addPinnedColumn = (evaluator) => {
    const entry = { evaluator_id: evaluator.evaluator_id, name: evaluator.name }
    const next = [...pinnedEvaluators, entry]
    setPinnedEvaluators(next)
    localStorage.setItem('cluco_pinned_evaluators', JSON.stringify(next))
    setShowColumnPicker(false)
  }

  const removeColumn = (name) => {
    setHiddenColumns(prev => {
      const next = new Set(prev)
      next.add(name)
      localStorage.setItem('cluco_hidden_columns', JSON.stringify([...next]))
      return next
    })
    if (pinnedNames.has(name)) {
      const next = pinnedEvaluators.filter(p => p.name !== name)
      setPinnedEvaluators(next)
      localStorage.setItem('cluco_pinned_evaluators', JSON.stringify(next))
    }
  }

  const unhideColumn = (name) => {
    setHiddenColumns(prev => {
      const next = new Set(prev)
      next.delete(name)
      localStorage.setItem('cluco_hidden_columns', JSON.stringify([...next]))
      return next
    })
    setShowColumnPicker(false)
  }

  const runEvalOnVisibleTraces = async (evaluatorId) => {
    if (!evaluatorId || runningEval) return
    setRunningEval(evaluatorId)
    try {
      // Refetch evaluators to use latest prompts from Evaluations Hub
      const evRes = await getEvaluators()
      const evs = evRes.data?.evaluators || []
      setAllEvaluators(evs)
      const evaluator = evs.find(e => e.evaluator_id === evaluatorId)
      const payload = {
        product_id: productFilter || undefined,
        limit: 200,
      }
      if (evaluator?.config) {
        payload.evaluator_config = evaluator.config
      }
      await runEvaluatorOnAllTraces(evaluatorId, payload)
      await load()
    } catch (e) {
      console.error('Run evaluator failed:', e)
    } finally {
      setRunningEval(null)
    }
  }

  const toggleTrace = (traceId) => {
    setSelectedTraces(prev => {
      const next = new Set(prev)
      if (next.has(traceId)) next.delete(traceId)
      else next.add(traceId)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedTraces.size === traces.length) setSelectedTraces(new Set())
    else setSelectedTraces(new Set(traces.map(t => t.trace_id)))
  }

  const openLabelingModal = async () => {
    setShowActionsMenu(false)
    setShowLabelingModal(true)
    try {
      const res = await getLabelingSessions()
      setLabelingSessions(res.data.sessions || [])
    } catch { /* ignore */ }
  }

  const openDatasetModal = async () => {
    setShowActionsMenu(false)
    setShowDatasetModal(true)
    try {
      const res = await getDatasets()
      setDatasets(res.data.datasets || [])
    } catch { /* ignore */ }
  }

  const handleAddToLabelingSession = async (sessionId) => {
    setActionLoading(true)
    try {
      await addTracesToLabelingSession(sessionId, [...selectedTraces])
      setActionMsg(`Added ${selectedTraces.size} traces to labeling session`)
      setShowLabelingModal(false)
      setSelectedTraces(new Set())
    } catch { setActionMsg('Failed to add traces') }
    setActionLoading(false)
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleCreateAndAddToSession = async () => {
    if (!newSessionName.trim()) return
    setActionLoading(true)
    try {
      await createLabelingSession({ name: newSessionName.trim(), trace_ids: [...selectedTraces] })
      setActionMsg(`Created session and added ${selectedTraces.size} traces`)
      setShowLabelingModal(false)
      setSelectedTraces(new Set())
      setNewSessionName('')
    } catch { setActionMsg('Failed to create session') }
    setActionLoading(false)
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleExportToDataset = async (datasetId) => {
    setActionLoading(true)
    try {
      await exportTracesToDataset({ trace_ids: [...selectedTraces], dataset_id: datasetId })
      setActionMsg(`Exported ${selectedTraces.size} traces to dataset`)
      setShowDatasetModal(false)
      setSelectedTraces(new Set())
    } catch { setActionMsg('Failed to export traces') }
    setActionLoading(false)
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleCreateAndExportDataset = async () => {
    if (!newDatasetName.trim()) return
    setActionLoading(true)
    try {
      await exportTracesToDataset({ trace_ids: [...selectedTraces], dataset_name: newDatasetName.trim() })
      setActionMsg(`Created dataset and exported ${selectedTraces.size} traces`)
      setShowDatasetModal(false)
      setSelectedTraces(new Set())
      setNewDatasetName('')
    } catch { setActionMsg('Failed to create dataset') }
    setActionLoading(false)
    setTimeout(() => setActionMsg(''), 3000)
  }

  const clearAssessmentFilter = () => {
    setAssessmentFilter('')
    setAssessmentValueFilter('')
    setShowFilterPanel(false)
    setPage(1)
  }

  useEffect(() => { load() }, [productFilter, assessmentFilter, assessmentValueFilter, page, pageSize])
  useEffect(() => { setPage(1) }, [productFilter, assessmentFilter, assessmentValueFilter])

  const hasActiveFilter = assessmentFilter || assessmentValueFilter

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Traces"
        subtitle="Monitor and inspect individual pipeline runs"
        icon={Activity}
        actions={
          <FilterBar onRefresh={load}>
            <FilterSelect value={productFilter} onChange={setProductFilter} options={products} placeholder="All products" />
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${hasActiveFilter ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Filter size={13} />
              Filters{hasActiveFilter ? ' (1)' : ''}
            </button>
            <button
              onClick={() => setShowColumnPicker(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${showColumnPicker ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              title="Add or remove evaluator columns"
            >
              <Columns size={13} />
              Columns
            </button>
          </FilterBar>
        }
      />

      {showFilterPanel && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Column</span>
              <select className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" value="assessments" disabled>
                <option value="assessments">Assessments</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Name</span>
              <select
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                value={assessmentFilter}
                onChange={e => setAssessmentFilter(e.target.value)}
              >
                <option value="">Select name</option>
                {assessmentNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">=</span>
              <select
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs"
                value={assessmentValueFilter}
                onChange={e => setAssessmentValueFilter(e.target.value)}
              >
                <option value="">Any</option>
                <option value="True">True</option>
                <option value="False">False</option>
              </select>
            </div>
            {hasActiveFilter && (
              <button onClick={clearAssessmentFilter} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
            <button onClick={load} className="btn-brand text-xs px-3 py-1.5 ml-auto">Apply filters</button>
          </div>
        </div>
      )}

      {apiError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Backend:</strong> {apiError}
        </div>
      )}

      {selectedTraces.size > 0 && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/50 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-medium text-brand-700">{selectedTraces.size} trace{selectedTraces.size > 1 ? 's' : ''} selected</span>
          <div className="relative">
            <button onClick={() => setShowActionsMenu(!showActionsMenu)} className="btn-brand text-xs px-3 py-1.5 flex items-center gap-1">
              Actions ({selectedTraces.size}) <ChevronDown size={14} />
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                <button onClick={openLabelingModal} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700">Add to labeling session</button>
                <button onClick={openDatasetModal} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 text-slate-700">Add to evaluation dataset</button>
              </div>
            )}
          </div>
        </div>
      )}

      {actionMsg && (
        <div className={`mb-4 text-sm px-4 py-2.5 rounded-lg ${actionMsg.includes('Failed') ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
          {actionMsg}
        </div>
      )}

      {showLabelingModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowLabelingModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Add to Labeling Session</h3>
              <p className="text-sm text-slate-500 mt-1">{selectedTraces.size} traces selected</p>
            </div>
            <div className="p-5">
              {labelingSessions.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-600 mb-2">Existing Sessions</div>
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {labelingSessions.map(s => (
                      <button key={s.session_id} onClick={() => handleAddToLabelingSession(s.session_id)} disabled={actionLoading}
                        className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-brand-50 hover:border-brand-200 transition-colors text-sm disabled:opacity-50">
                        <div className="font-medium text-slate-700">{s.name}</div>
                        <div className="text-xs text-slate-400">{s.trace_count} traces &middot; {s.review_progress}% reviewed</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-slate-100 pt-4">
                <div className="text-xs font-semibold text-slate-600 mb-2">Create New Session</div>
                <input value={newSessionName} onChange={e => setNewSessionName(e.target.value)} placeholder="Session name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-2" />
                <button onClick={handleCreateAndAddToSession} disabled={actionLoading || !newSessionName.trim()} className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">
                  {actionLoading ? 'Creating...' : 'Create & Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDatasetModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowDatasetModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-800">Add to Evaluation Dataset</h3>
              <p className="text-sm text-slate-500 mt-1">{selectedTraces.size} traces selected</p>
            </div>
            <div className="p-5">
              {datasets.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-600 mb-2">Existing Datasets</div>
                  <div className="space-y-1.5 max-h-48 overflow-auto">
                    {datasets.map(d => (
                      <button key={d.dataset_id} onClick={() => handleExportToDataset(d.dataset_id)} disabled={actionLoading}
                        className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 hover:bg-brand-50 hover:border-brand-200 transition-colors text-sm disabled:opacity-50">
                        <div className="font-medium text-slate-700">{d.name}</div>
                        <div className="text-xs text-slate-400">{d.item_count || 0} items</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-slate-100 pt-4">
                <div className="text-xs font-semibold text-slate-600 mb-2">Create New Dataset</div>
                <input value={newDatasetName} onChange={e => setNewDatasetName(e.target.value)} placeholder="Dataset name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-2" />
                <button onClick={handleCreateAndExportDataset} disabled={actionLoading || !newDatasetName.trim()} className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">
                  {actionLoading ? 'Creating...' : 'Create & Export'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonTable rows={8} cols={7} />
      ) : traces.length === 0 && !apiError ? (
        <EmptyState
          icon={Radio}
          title="No traces yet"
          description="Run a pipeline with observability enabled to see traces here."
        />
      ) : traces.length === 0 ? null : (
        <>
          <TracesSummaryBar traces={traces} />

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10 text-center"><input type="checkbox" checked={selectedTraces.size === traces.length && traces.length > 0} onChange={toggleAll} className="rounded" /></th>
                    <th className="text-left">Trace ID</th>
                    <th className="text-left min-w-[200px]">Request</th>
                    <th className="text-left min-w-[200px]">Response</th>
                    <th className="text-left">Status</th>
                    <th className="text-right">Latency</th>
                    <th className="text-right">Cost</th>
                    {allColumnNames.map(name => (
                      <AssessmentHeaderCell
                        key={name}
                        name={name}
                        traces={traces}
                        isPinned={pinnedNames.has(name)}
                        evaluatorId={evaluatorByName[name]?.evaluator_id}
                        onRemove={removeColumn}
                        onRun={runEvalOnVisibleTraces}
                        runningEval={runningEval}
                      />
                    ))}
                    <th className="w-10 relative" ref={pickerRef}>
                      <button
                        onClick={() => setShowColumnPicker(!showColumnPicker)}
                        className="p-1 rounded hover:bg-brand-50 text-slate-400 hover:text-brand-600 transition-colors"
                        title="Add evaluator column"
                      >
                        <Plus size={14} />
                      </button>
                      {showColumnPicker && (
                        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 max-h-72 overflow-auto">
                          <div className="px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                            Add / Restore Columns
                          </div>
                          {availableToAdd.length > 0 && (
                            <div className="py-1">
                              <div className="px-3 pt-1 pb-0.5 text-2xs font-medium text-slate-500">Add evaluator</div>
                              {availableToAdd.map(ev => (
                                <button
                                  key={ev.evaluator_id}
                                  onClick={() => addPinnedColumn(ev)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-brand-50 text-slate-700 flex items-center gap-2 transition-colors"
                                >
                                  <Plus size={12} className="text-brand-500 shrink-0" />
                                  <div className="min-w-0">
                                    <div className="font-medium truncate">{ev.name}</div>
                                    <div className="text-2xs text-slate-400">{ev.type}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          {hiddenColumns.size > 0 && (
                            <div className="py-1 border-t border-slate-100">
                              <div className="px-3 pt-1 pb-0.5 text-2xs font-medium text-slate-500">Restore hidden</div>
                              {[...hiddenColumns].map(n => (
                                <button
                                  key={n}
                                  onClick={() => unhideColumn(n)}
                                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700 flex items-center gap-2 transition-colors"
                                >
                                  <Plus size={12} className="text-slate-400 shrink-0" />
                                  <span className="font-medium truncate">{n}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {availableToAdd.length === 0 && hiddenColumns.size === 0 && (
                            <div className="px-3 py-3 text-xs text-slate-400 text-center">All evaluators visible</div>
                          )}
                        </div>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {traces.map((t) => {
                    const dt = formatDateTime(t.created_at)
                    const isObj = typeof dt === 'object'
                    const dateTooltip = isObj ? `${dt.dateStr} ${dt.timeStr}${dt.relative ? ` (${dt.relative})` : ''}` : ''
                    return (
                      <tr key={t.trace_id}>
                        <td className="text-center"><input type="checkbox" checked={selectedTraces.has(t.trace_id)} onChange={() => toggleTrace(t.trace_id)} className="rounded" /></td>
                        <td>
                          <Link to={`/trace/${t.trace_id}`} className="text-brand-600 hover:text-brand-700 font-mono text-xs font-medium transition-colors" title={dateTooltip}>
                            {t.trace_id?.slice(0, 14)}...
                          </Link>
                          {isObj && dt.relative && (
                            <div className="text-2xs text-slate-400 mt-0.5">{dt.relative}</div>
                          )}
                        </td>
                        <td>
                          <span className="text-xs text-slate-700 leading-snug line-clamp-2" title={t.request || ''}>
                            {truncateText(t.request) || <span className="text-slate-400 italic">-</span>}
                          </span>
                        </td>
                        <td>
                          <span className="text-xs text-slate-600 leading-snug line-clamp-2" title={t.response || ''}>
                            {truncateText(t.response) || <span className="text-slate-400 italic">-</span>}
                          </span>
                        </td>
                        <td><StatusBadge status={t.status} /></td>
                        <td className="text-right font-mono text-xs" title={`${(t.latency_ms ?? 0).toLocaleString()} ms`}>{formatLatency(t.latency_ms, 1).display}</td>
                        <td className="text-right font-mono text-xs">
                          {t.total_cost_usd != null ? (
                            <span className="text-emerald-600 font-medium" title={`$${t.total_cost_usd.toFixed(6)}`}>{formatCost(t.total_cost_usd).display}</span>
                          ) : '-'}
                        </td>
                        {allColumnNames.map(name => {
                          const a = t.assessments?.[name]
                          if (!a) return <td key={name} className="text-center text-slate-300 text-2xs">-</td>
                          const latest = a.true_count > 0 ? 'True' : 'False'
                          return (
                            <td key={name} className="text-center">
                              <AssessmentBadge value={latest} />
                            </td>
                          )
                        })}
                        <td></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={page}
              totalItems={totalCount}
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
