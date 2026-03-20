import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { compareExperiments, getExperiment } from '../api'
import {
  GitCompare,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  Download,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable } from '../components/ui/Skeleton'

function PassFailIcon({ pass }) {
  return pass ? (
    <CheckCircle size={16} className="text-green-600 inline" />
  ) : (
    <XCircle size={16} className="text-red-600 inline" />
  )
}

function TraceCompareModal({ items, initialIdx, experiments, ids, onClose }) {
  const [idx, setIdx] = useState(initialIdx ?? 0)
  const item = items[idx]

  if (!item) return null

  const results = item.results ?? item.scores ?? (Array.isArray(item) ? item : [])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '90vw', maxWidth: 1200,
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <GitCompare size={18} color="#6d28d9" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              Trace Comparison
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
              Item: {item.input_id ?? item.item_id ?? idx}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6,
                border: '1px solid #e2e8f0', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer',
                color: idx === 0 ? '#cbd5e1' : '#475569', fontSize: 12, fontWeight: 600,
              }}>
              <ChevronLeft size={14} /> Previous
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 60, textAlign: 'center' }}>
              {idx + 1} of {items.length}
            </span>
            <button onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))} disabled={idx === items.length - 1}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6,
                border: '1px solid #e2e8f0', background: '#fff', cursor: idx === items.length - 1 ? 'not-allowed' : 'pointer',
                color: idx === items.length - 1 ? '#cbd5e1' : '#475569', fontSize: 12, fontWeight: 600,
              }}>
              Next <ChevronRight size={14} />
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', marginLeft: 8 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'grid', gridTemplateColumns: `repeat(${ids.length}, 1fr)`, gap: 16 }}>
          {ids.map((_, colIdx) => {
            const res = results[colIdx] ?? (typeof results === 'object' && !Array.isArray(results) ? results : {})
            const score = res?.score ?? res?.avg_score ?? (typeof res === 'number' ? res : null)
            const pass = res?.pass ?? res?.passed
            const input = res?.input ?? item.input ?? ''
            const output = res?.output ?? res?.response ?? ''
            const assessments = res?.assessments ?? res?.evaluator_results ?? []

            return (
              <div key={colIdx} style={{
                border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}>
                <div style={{
                  padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                    {experiments[colIdx]?.name || ids[colIdx]}
                  </span>
                  {score != null && (
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 6,
                      background: (pass ?? (Number(score) >= 60)) ? '#dcfce7' : '#fee2e2',
                      color: (pass ?? (Number(score) >= 60)) ? '#166534' : '#991b1b',
                    }}>
                      {Number(score).toFixed(1)}%
                    </span>
                  )}
                </div>

                <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Input</div>
                    <div style={{
                      fontSize: 12, color: '#374151', background: '#f8fafc', borderRadius: 6,
                      padding: '8px 10px', border: '1px solid #e2e8f0', maxHeight: 100, overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Output</div>
                    <div style={{
                      fontSize: 12, color: '#374151', background: '#fff', borderRadius: 6,
                      padding: '8px 10px', border: '1px solid #e2e8f0', maxHeight: 200, overflowY: 'auto',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                    </div>
                  </div>

                  {Array.isArray(assessments) && assessments.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>Assessments</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {assessments.map((a, ai) => {
                          const aPassed = a.passed ?? (a.score >= 60)
                          return (
                            <span key={ai} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                              background: aPassed ? '#dcfce7' : '#fee2e2',
                              color: aPassed ? '#166534' : '#991b1b',
                            }}>
                              {aPassed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                              {a.evaluator_name || a.name || `Eval ${ai + 1}`}: {typeof a.score === 'number' ? a.score.toFixed(1) : String(a.score ?? '')}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {pass != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                      {pass ? <CheckCircle size={14} color="#16a34a" /> : <XCircle size={14} color="#dc2626" />}
                      <span style={{ fontSize: 11, fontWeight: 600, color: pass ? '#166534' : '#991b1b' }}>
                        {pass ? 'Passed' : 'Failed'}
                      </span>
                    </div>
                  )}

                  {res?.trace_id && (
                    <Link to={`/trace/${res.trace_id}`} onClick={onClose}
                      style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                      <ExternalLink size={11} /> View full trace
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ScoreCell({ score, prevScore, showRegression }) {
  const numScore = score != null ? Number(score) : null
  const numPrev = prevScore != null ? Number(prevScore) : null

  if (numScore == null) return <span className="text-slate-400">-</span>

  let bgClass = ''
  if (showRegression && numPrev != null) {
    if (numScore < numPrev) bgClass = 'bg-red-100 text-red-800'
    else if (numScore > numPrev) bgClass = 'bg-green-100 text-green-800'
  }

  return (
    <span className={`font-medium ${bgClass}`}>
      {numScore.toFixed(1)}%
    </span>
  )
}

function RegressionIcon({ score, prevScore }) {
  if (score == null || prevScore == null) return null
  const numScore = Number(score)
  const numPrev = Number(prevScore)
  if (numScore > numPrev) return <TrendingUp size={14} className="text-green-600 inline" />
  if (numScore < numPrev) return <TrendingDown size={14} className="text-red-600 inline" />
  return null
}

export default function ExperimentComparePage() {
  const [searchParams] = useSearchParams()
  const [experiments, setExperiments] = useState([])
  const [comparison, setComparison] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [compareModalIdx, setCompareModalIdx] = useState(null)

  const experimentIdsParam = searchParams.get('experiment_ids')
  const ids = experimentIdsParam
    ? experimentIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const load = useCallback(async () => {
    if (ids.length < 2) {
      setError('Provide at least 2 experiment IDs in the URL (e.g. ?experiment_ids=id1,id2)')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [compareRes, ...expRes] = await Promise.all([
        compareExperiments(ids),
        ...ids.map((id) => getExperiment(id)),
      ])
      const expList = expRes.map((r) => r.data?.experiment ?? r.data ?? {})
      setExperiments(expList)
      setComparison(compareRes.data)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to load comparison')
      setExperiments([])
      setComparison(null)
    }
    setLoading(false)
  }, [ids.join(',')])

  useEffect(() => {
    load()
  }, [load])

  const handleExport = () => {
    if (!comparison) return
    const blob = new Blob([JSON.stringify(comparison, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `experiment-compare-${ids.join('-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const items = comparison?.items ?? []
  const summary = comparison?.summary ?? experiments

  if (ids.length < 2 && !loading) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title="Experiment Comparison"
          subtitle="Compare experiments side by side"
          icon={GitCompare}
        />
        <div className="card p-6 text-center">
          <p className="text-slate-600 mb-4">
            Add experiment IDs to the URL: <code className="bg-slate-100 px-2 py-1 rounded">?experiment_ids=id1,id2</code>
          </p>
          <p className="text-sm text-slate-500">
            Select experiments on the Experiments page and click &quot;Compare Selected&quot;.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Experiment Comparison"
        subtitle={`Comparing ${ids.length} experiments`}
        icon={GitCompare}
        breadcrumbs={[
          { to: '/evaluations', label: 'Evaluations' },
          { to: '/evaluations/experiments', label: 'Experiments' },
          { label: 'Compare' },
        ]}
        actions={
          comparison && (
            <button onClick={handleExport} className="btn-ghost flex items-center gap-2">
              <Download size={16} />
              Export
            </button>
          )
        }
      />

      {error && (
        <div className="card p-4 mb-6 bg-red-50 text-red-700">{error}</div>
      )}

      {loading && <SkeletonTable rows={6} cols={ids.length + 2} />}

      {!loading && comparison && (
        <>
          {/* Summary row */}
          <div className="card overflow-hidden mb-6">
            <div className="bg-surface-2 px-4 py-3 font-medium text-slate-700 text-sm">
              Summary
            </div>
            <div className="grid gap-4 p-4" style={{ gridTemplateColumns: `repeat(${ids.length}, minmax(180px, 1fr))` }}>
              {experiments.map((ex, i) => (
                <div key={i} className="p-4 rounded-lg border border-slate-200 bg-white">
                  <div className="font-semibold text-slate-900 mb-1">
                    {ex.name || ex.experiment_id || ids[i] || '-'}
                  </div>
                  <div className="text-xs text-slate-500 mb-2">
                    Prompt v{ex.prompt_version ?? '-'}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span>
                      <span className="text-slate-500">Avg:</span>{' '}
                      <span className="font-medium">
                        {(ex.avg_score ?? ex.summary?.avg_score) != null ? `${Number(ex.avg_score ?? ex.summary?.avg_score).toFixed(1)}%` : '-'}
                      </span>
                    </span>
                    <span>
                      <span className="text-slate-500">Pass:</span>{' '}
                      <span className="font-medium">
                        {(() => { const r = ex.pass_rate ?? ex.summary?.pass_rate; return r != null ? `${(r > 1 ? r : r * 100).toFixed(1)}%` : '-' })()}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Item comparison table */}
          <div className="card overflow-hidden">
            <div className="bg-surface-2 px-4 py-3 font-medium text-slate-700 text-sm">
              Item Comparison
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 sticky left-0 bg-surface-2 min-w-[180px]">
                      Item
                    </th>
                    {ids.map((id, i) => (
                      <th key={id} className="text-left px-4 py-3 font-medium text-slate-600 min-w-[140px]">
                        {experiments[i]?.name || id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={ids.length + 1} className="px-4 py-8 text-center text-slate-500">
                        No item-level comparison data
                      </td>
                    </tr>
                  ) : (
                    items.map((item, rowIdx) => {
                      const itemId = item.item_id ?? item.id ?? rowIdx
                      const results = item.results ?? item.scores ?? Array.isArray(item) ? item : []

                      return (
                        <tr key={itemId} className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                          onClick={() => setCompareModalIdx(rowIdx)}>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 sticky left-0 bg-white">
                            {item.input_id ?? item.item_id ?? itemId}
                          </td>
                          {ids.map((_, colIdx) => {
                            const res = results[colIdx] ?? (typeof results === 'object' && !Array.isArray(results) ? results : {})
                            const score = res?.score ?? res?.avg_score ?? (typeof res === 'number' ? res : null)
                            const pass = res?.pass ?? res?.passed
                            const prevScore = colIdx > 0
                              ? (results[colIdx - 1]?.score ?? results[colIdx - 1]?.avg_score ?? (typeof results[colIdx - 1] === 'number' ? results[colIdx - 1] : null))
                              : null

                            return (
                              <td key={colIdx} className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <ScoreCell
                                    score={score}
                                    prevScore={prevScore}
                                    showRegression={true}
                                  />
                                  <RegressionIcon score={score} prevScore={prevScore} />
                                  {pass != null && (
                                    <PassFailIcon pass={pass} />
                                  )}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Regression highlights legend */}
          <div className="mt-4 flex items-center gap-6 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-100" />
              Improved
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-red-100" />
              Regressed
            </span>
            <span className="text-slate-400 ml-2">Click any row for side-by-side comparison</span>
          </div>
        </>
      )}

      {compareModalIdx != null && items.length > 0 && (
        <TraceCompareModal
          items={items}
          initialIdx={compareModalIdx}
          experiments={experiments}
          ids={ids}
          onClose={() => setCompareModalIdx(null)}
        />
      )}
    </div>
  )
}
