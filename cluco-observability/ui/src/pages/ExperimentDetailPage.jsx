import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getExperiment, exportExperiment } from '../api'
import {
  ArrowLeft,
  FlaskConical,
  CheckCircle,
  XCircle,
  Download,
  Loader2,
  Award,
  TrendingUp,
  FileText,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable, SkeletonCard } from '../components/ui/Skeleton'

const STATUS_CONFIG = {
  running: { color: 'bg-blue-100 text-blue-800', icon: Loader2, label: 'Running' },
  completed: { color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle, label: 'Completed' },
  failed: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Failed' },
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.failed
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>
      <Icon size={14} className={status === 'running' ? 'animate-spin' : ''} />
      {config.label}
    </span>
  )
}

function ScoreBadge({ score, large, outputType }) {
  if (score == null) return <span className="text-slate-400">-</span>
  const num = Number(score)
  if (outputType === 'boolean') {
    const passed = num >= 50
    const color = passed ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
    const sizeClass = large ? 'text-xl font-bold px-4 py-2' : 'text-xs font-semibold px-2 py-0.5'
    return (
      <span className={`inline-flex items-center gap-1 rounded-lg ${color} ${sizeClass}`}>
        {passed ? <CheckCircle size={large ? 16 : 11} /> : <XCircle size={large ? 16 : 11} />}
        {passed ? 'TRUE' : 'FALSE'}
      </span>
    )
  }
  const color = num >= 80 ? 'text-emerald-700 bg-emerald-50' : num >= 50 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50'
  const sizeClass = large ? 'text-2xl font-bold px-4 py-2' : 'text-xs font-semibold px-2 py-0.5'
  return (
    <span className={`inline-flex items-center rounded-lg ${color} ${sizeClass}`}>
      {num.toFixed(1)}
    </span>
  )
}

function PassFailBadge({ passed }) {
  if (passed == null) return null
  return passed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-semibold bg-emerald-50 text-emerald-700">
      <CheckCircle size={11} /> Pass
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-semibold bg-red-50 text-red-600">
      <XCircle size={11} /> Fail
    </span>
  )
}

function ExpandableText({ text, maxLen = 150 }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return <span className="text-slate-400 italic text-xs">-</span>
  const str = typeof text === 'string' ? text : JSON.stringify(text)
  if (str.length <= maxLen) {
    return <span className="text-xs text-slate-700 whitespace-pre-wrap break-words">{str}</span>
  }
  return (
    <div>
      <span className="text-xs text-slate-700 whitespace-pre-wrap break-words">
        {expanded ? str : str.slice(0, maxLen) + '...'}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
        className="text-2xs text-brand-600 hover:text-brand-700 ml-1 font-medium"
      >
        {expanded ? 'less' : 'more'}
      </button>
    </div>
  )
}

export default function ExperimentDetailPage() {
  const { experimentId } = useParams()
  const navigate = useNavigate()
  const [experiment, setExperiment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState(null)
  const [sortField, setSortField] = useState('index')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    if (!experimentId) return
    setLoading(true)
    getExperiment(experimentId)
      .then((r) => setExperiment(r.data?.experiment ?? r.data))
      .catch(() => setExperiment(null))
      .finally(() => setLoading(false))
  }, [experimentId])

  const summary = experiment?.summary || {}
  const results = useMemo(() => experiment?.results || [], [experiment])
  const avgScore = summary.avg_score ?? null
  const passRateRaw = summary.pass_rate ?? null
  const passRate = passRateRaw != null ? (passRateRaw > 1 ? passRateRaw : passRateRaw * 100) : null
  const totalItems = summary.total_items ?? results.length
  const passedCount = summary.passed ?? results.filter(r => r.all_passed).length
  const failedCount = summary.failed ?? results.filter(r => !r.all_passed).length

  const evaluatorIds = useMemo(() => {
    const ids = new Set()
    for (const r of results) {
      if (r.evaluator_scores) {
        Object.keys(r.evaluator_scores).forEach(k => ids.add(k))
      }
    }
    return [...ids]
  }, [results])

  const evaluatorStats = summary.evaluator_stats || {}

  const getEvalOutputType = (eid) => {
    if (evaluatorStats[eid]) return evaluatorStats[eid].output_type || 'score'
    for (const r of results) {
      const es = r.evaluator_scores?.[eid]
      if (es?.output_type) return es.output_type
    }
    return 'score'
  }

  const sortedResults = useMemo(() => {
    const sorted = [...results]
    sorted.sort((a, b) => {
      let va, vb
      if (sortField === 'score') {
        va = a.avg_score ?? 0
        vb = b.avg_score ?? 0
      } else if (sortField === 'passed') {
        va = a.all_passed ? 1 : 0
        vb = b.all_passed ? 1 : 0
      } else {
        return 0
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return sorted
  }, [results, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  const handleExport = async (format) => {
    try {
      const res = await exportExperiment(experimentId, format)
      const blob = format === 'csv'
        ? (res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' }))
        : new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `experiment-${experimentId}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Export failed:', e)
    }
  }

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="mb-6"><SkeletonCard /></div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    )
  }

  if (!experiment) {
    return (
      <div className="animate-fade-in text-center py-20">
        <FlaskConical size={48} className="text-slate-300 mx-auto mb-4" />
        <p className="text-slate-600 mb-4">Experiment not found</p>
        <button onClick={() => navigate('/evaluations/experiments')} className="btn-primary text-xs px-4 py-2">
          <ArrowLeft size={14} className="inline mr-2" />
          Back to Experiments
        </button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={experiment.name || experimentId}
        subtitle={`Prompt: ${experiment.prompt_name || experiment.prompt_id || '-'} v${experiment.prompt_version ?? '-'}`}
        icon={FlaskConical}
        breadcrumbs={[
          { to: '/evaluations', label: 'Evaluations' },
          { to: '/evaluations/experiments', label: 'Experiments' },
          { label: experiment.name || experimentId },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => handleExport('json')} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Download size={13} /> JSON
            </button>
            <button onClick={() => handleExport('csv')} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
              <Download size={13} /> CSV
            </button>
            <button onClick={() => navigate('/evaluations/experiments')} className="btn-ghost flex items-center gap-1.5 text-xs px-3 py-1.5">
              <ArrowLeft size={13} /> Back
            </button>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <FlaskConical size={18} className="text-brand-600" />
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Status</div>
            <StatusBadge status={experiment.status} />
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
            <Award size={18} className="text-violet-600" />
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Avg Score</div>
            <ScoreBadge score={avgScore} />
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <TrendingUp size={18} className="text-emerald-600" />
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Pass Rate</div>
            <div className="flex items-center gap-2 mt-1">
              {passRate != null ? (
                <>
                  <span className={`text-lg font-bold ${passRate >= 80 ? 'text-emerald-700' : passRate >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                    {passRate.toFixed(1)}%
                  </span>
                  <span className="text-2xs text-slate-400">{passedCount}P / {failedCount}F</span>
                </>
              ) : <span className="text-slate-400">-</span>}
            </div>
          </div>
        </div>

        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-blue-600" />
          </div>
          <div>
            <div className="text-2xs font-medium uppercase tracking-wider text-slate-400">Items</div>
            <div className="text-lg font-bold text-slate-800">{totalItems}</div>
          </div>
        </div>

        <div className="card p-4">
          <div className="text-2xs font-medium uppercase tracking-wider text-slate-400 mb-1.5">Details</div>
          <div className="space-y-1 text-xs text-slate-600">
            <div>Dataset: <span className="font-medium text-slate-800">{experiment.dataset_name || experiment.dataset_id || '-'}</span></div>
            <div>Evaluators: <span className="font-medium text-slate-800">{(experiment.evaluator_ids || []).length}</span></div>
            {experiment.created_at && (
              <div className="text-2xs text-slate-400">{new Date(experiment.created_at).toLocaleString()}</div>
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {experiment.error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Error:</strong> {experiment.error}
        </div>
      )}

      {/* Pass/Fail distribution bar */}
      {totalItems > 0 && (
        <div className="card p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700">Score Distribution</span>
            <span className="text-2xs text-slate-400">{passedCount} passed, {failedCount} failed of {totalItems}</span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden flex">
            {passedCount > 0 && (
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${(passedCount / totalItems) * 100}%` }}
                title={`Passed: ${passedCount}`}
              />
            )}
            {failedCount > 0 && (
              <div
                className="bg-red-400 h-full transition-all"
                style={{ width: `${(failedCount / totalItems) * 100}%` }}
                title={`Failed: ${failedCount}`}
              />
            )}
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1.5 text-2xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Passed ({passedCount})
            </span>
            <span className="flex items-center gap-1.5 text-2xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Failed ({failedCount})
            </span>
          </div>
        </div>
      )}

      {/* Per-evaluator stats */}
      {Object.keys(evaluatorStats).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          {Object.entries(evaluatorStats).map(([eid, st]) => (
            <div key={eid} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]" title={st.name || eid}>
                  {st.name || eid}
                </span>
                <span className={`text-2xs px-2 py-0.5 rounded-full font-medium ${
                  st.output_type === 'boolean' ? 'bg-indigo-50 text-indigo-600' : 'bg-violet-50 text-violet-600'
                }`}>
                  {st.output_type === 'boolean' ? 'Boolean' : 'Score'}
                </span>
              </div>
              {st.output_type === 'boolean' ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-bold text-slate-800">{st.pass_rate?.toFixed(1) ?? 0}%</span>
                    <span className="text-2xs text-slate-400">accuracy</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle size={12} /> {st.true_count} True
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="flex items-center gap-1 text-red-500">
                      <XCircle size={12} /> {st.false_count} False
                    </span>
                    <span className="text-slate-300 ml-1">of {st.total}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex mt-2">
                    {st.true_count > 0 && (
                      <div className="bg-emerald-500 h-full" style={{ width: `${(st.true_count / (st.total || 1)) * 100}%` }} />
                    )}
                    {st.false_count > 0 && (
                      <div className="bg-red-400 h-full" style={{ width: `${(st.false_count / (st.total || 1)) * 100}%` }} />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg font-bold text-slate-800">{st.avg_score?.toFixed(1) ?? 0}</span>
                    <span className="text-2xs text-slate-400">avg score</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>Min: <span className="font-medium text-slate-700">{st.min_score?.toFixed(1) ?? 0}</span></span>
                    <span>Max: <span className="font-medium text-slate-700">{st.max_score?.toFixed(1) ?? 0}</span></span>
                    <span>Pass Rate: <span className="font-medium text-slate-700">{st.pass_rate?.toFixed(1) ?? 0}%</span></span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                    <div
                      className={`h-full ${st.avg_score >= 80 ? 'bg-emerald-500' : st.avg_score >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(100, st.avg_score || 0)}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Results table */}
      {results.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Results ({results.length} items)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left w-12">#</th>
                  <th className="text-left min-w-[200px]">Input</th>
                  <th className="text-left min-w-[150px]">Expected</th>
                  <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('score')}>
                    <span className="inline-flex items-center gap-1">Score <SortIcon field="score" /></span>
                  </th>
                  <th className="text-center cursor-pointer select-none" onClick={() => toggleSort('passed')}>
                    <span className="inline-flex items-center gap-1">Result <SortIcon field="passed" /></span>
                  </th>
                  {evaluatorIds.map(eid => (
                    <th key={eid} className="text-center text-xs min-w-[100px]">
                      <span className="truncate max-w-[90px] inline-block" title={eid}>
                        {eid.length > 12 ? eid.slice(0, 12) + '...' : eid}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, idx) => {
                  const isExpanded = expandedRow === idx
                  return (
                    <tr
                      key={r.item_id || idx}
                      onClick={() => setExpandedRow(isExpanded ? null : idx)}
                      className="cursor-pointer"
                    >
                      <td className="text-xs text-slate-400 font-mono">{idx + 1}</td>
                      <td>
                        <ExpandableText text={r.input} maxLen={isExpanded ? 1000 : 100} />
                      </td>
                      <td>
                        <ExpandableText text={r.expected_output} maxLen={isExpanded ? 1000 : 80} />
                      </td>
                      <td className="text-right">
                        <ScoreBadge score={r.avg_score} />
                      </td>
                      <td className="text-center">
                        <PassFailBadge passed={r.all_passed} />
                      </td>
                      {evaluatorIds.map(eid => {
                        const es = r.evaluator_scores?.[eid]
                        if (!es) return <td key={eid} className="text-center text-slate-300 text-2xs">-</td>
                        const otype = es.output_type || getEvalOutputType(eid)
                        return (
                          <td key={eid} className="text-center">
                            <ScoreBadge score={es.score} outputType={otype} />
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : experiment.status === 'completed' ? (
        <div className="card p-8 text-center">
          <FileText size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No result items in this experiment.</p>
        </div>
      ) : null}
    </div>
  )
}
