import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getEvaluationRun, getEvaluationRuns, compareEvaluationRuns, getEvaluationRunTraces, getEvaluators, getTrace } from '../api'
import MarkdownRenderer from '../components/MarkdownRenderer'
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import {
  Award, CheckCircle, XCircle, ArrowLeft, Clock,
  FileText, Database, Cpu, ChevronDown, ChevronUp, GitCompare,
  TrendingUp, TrendingDown, Minus, BookOpen, AlertTriangle, Info,
  Zap, DollarSign, Hash, MessageSquare, ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable } from '../components/ui/Skeleton'

const tooltipStyle = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '12px',
}

export default function EvaluationResultsPage() {
  const { runId } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedItems, setExpandedItems] = useState({})
  const [expandedTraces, setExpandedTraces] = useState({})
  const [allRuns, setAllRuns] = useState([])
  const [compareRunId, setCompareRunId] = useState('')
  const [comparison, setComparison] = useState(null)
  const [runTraces, setRunTraces] = useState([])
  const [evaluatorMap, setEvaluatorMap] = useState({})
  const [showJudgePrompt, setShowJudgePrompt] = useState({})
  const [traceDetail, setTraceDetail] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getEvaluationRun(runId),
      getEvaluationRuns({ limit: 50 }),
      getEvaluationRunTraces(runId),
      getEvaluators({ limit: 200 }),
    ])
      .then(([runRes, runsRes, tracesRes, evalRes]) => {
        const runData = runRes.data
        setRun(runData)
        setAllRuns(runsRes.data?.runs?.filter(r => r.run_id !== runId) || [])
        setRunTraces(tracesRes.data?.traces || [])
        const eMap = {}
        for (const ev of (evalRes.data?.evaluators || [])) {
          eMap[ev.evaluator_id] = ev
        }
        const snapshots = runRes.data?.evaluator_snapshots || {}
        for (const [eid, snap] of Object.entries(snapshots)) {
          eMap[eid] = { ...eMap[eid], ...snap }
        }
        setEvaluatorMap(eMap)
        if (runData?.trace_id) {
          getTrace(runData.trace_id)
            .then(res => setTraceDetail(res.data))
            .catch(() => {})
        }
      })
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [runId])

  useEffect(() => {
    if (!compareRunId) { setComparison(null); return }
    compareEvaluationRuns(runId, compareRunId)
      .then(res => setComparison(res.data))
      .catch(() => {})
  }, [compareRunId, runId])

  if (loading) return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <SkeletonTable rows={6} />
    </div>
  )

  if (!run || run.error) return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', textAlign: 'center', paddingTop: 80 }}>
      <XCircle size={40} color="#ef4444" />
      <h3>Run not found</h3>
      <button onClick={() => navigate('/evaluations')} style={{
        padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
        cursor: 'pointer', fontWeight: 600,
      }}>Back to Evaluations</button>
    </div>
  )

  const results = run.results || []
  const radarData = results.map(r => ({
    subject: r.evaluator_name || r.evaluator_id,
    score: r.score || 0,
    fullMark: 100,
  }))

  const statusColor = run.status === 'completed' ? '#10b981' : run.status === 'failed' ? '#ef4444' : '#f59e0b'

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Back button */}
      <button onClick={() => navigate('/evaluations')} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
        background: 'none', border: 'none', cursor: 'pointer', color: '#64748b',
        fontSize: 13, fontWeight: 500, marginBottom: 8,
      }}>
        <ArrowLeft size={16} /> Back to Evaluations
      </button>

      <PageHeader
        title={`Evaluation Run`}
        subtitle={`Run ID: ${run.run_id}`}
        icon={Award}
      />

      {/* Error banner for failed runs */}
      {run.status === 'failed' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        }}>
          <AlertTriangle size={20} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>
              Evaluation Run Failed
            </div>
            <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>
              {run.metadata?.error || 'An unknown error occurred during evaluation. Check that your OPENAI_API_KEY is configured and evaluators are valid.'}
            </div>
            {run.metadata?.error && run.metadata.error.includes('OPENAI_API_KEY') && (
              <div style={{
                marginTop: 8, fontSize: 12, color: '#991b1b', background: '#fee2e2',
                padding: '8px 12px', borderRadius: 6, fontFamily: 'ui-monospace, monospace',
              }}>
                Tip: Set OPENAI_API_KEY in your backend .env file and restart the server.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info: prompts used at run time */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: 12, padding: '12px 16px', marginBottom: 20,
      }}>
        <Info size={18} color="#2563eb" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>
          <strong>Prompts shown are from when this run was executed.</strong>
          {' '}If you updated prompts in Evaluations Hub, save your changes there, then run a <strong>new evaluation</strong> to use the updated config.
        </div>
      </div>

      {/* Compare to another run */}
      {allRuns.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          background: '#f8fafc', borderRadius: 10, padding: '10px 16px',
          border: '1px solid #e2e8f0',
        }}>
          <GitCompare size={16} color="#64748b" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Compare to:</span>
          <select
            value={compareRunId}
            onChange={e => setCompareRunId(e.target.value)}
            style={{
              padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1',
              fontSize: 13, color: '#1e293b', background: '#fff', minWidth: 260,
            }}
          >
            <option value="">— Select a run to compare —</option>
            {allRuns.map(r => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id.slice(0, 12)}… — {r.status} — Score: {(r.aggregate_score || 0).toFixed(1)}%
              </option>
            ))}
          </select>
          {compareRunId && (
            <button onClick={() => setCompareRunId('')} style={{
              padding: '4px 10px', borderRadius: 6, border: '1px solid #cbd5e1',
              background: '#fff', cursor: 'pointer', fontSize: 12, color: '#64748b',
            }}>Clear</button>
          )}
        </div>
      )}

      {/* Comparison results */}
      {comparison && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 20,
          border: '1px solid #e2e8f0', marginBottom: 24,
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitCompare size={16} /> Run Comparison
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={{ background: '#f0f9ff', borderRadius: 8, padding: 12, border: '1px solid #bae6fd' }}>
              <div style={{ fontSize: 11, color: '#0369a1', fontWeight: 600, marginBottom: 4 }}>Run A (Current)</div>
              <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{comparison.run_a?.run_id?.slice(0, 16)}…</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0c4a6e' }}>{(comparison.run_a?.aggregate_score || 0).toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{comparison.run_a?.trace_count || 0} traces</div>
            </div>
            <div style={{ background: '#fefce8', borderRadius: 8, padding: 12, border: '1px solid #fde68a' }}>
              <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>Run B (Compared)</div>
              <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{comparison.run_b?.run_id?.slice(0, 16)}…</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#78350f' }}>{(comparison.run_b?.aggregate_score || 0).toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{comparison.run_b?.trace_count || 0} traces</div>
            </div>
          </div>

          {comparison.comparison && Object.keys(comparison.comparison).length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={thStyle}>Scorer</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Run A</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Run B</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Change</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>% Change</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(comparison.comparison).map(([scorer, data]) => {
                  const isPositive = (data.change || 0) > 0
                  const isNeutral = (data.change || 0) === 0
                  const changeColor = isNeutral ? '#64748b' : isPositive ? '#10b981' : '#ef4444'
                  const ChangeIcon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown
                  return (
                    <tr key={scorer} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{scorer}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>{data.run_a?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>{data.run_b?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: changeColor, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <ChangeIcon size={13} />
                        {data.change != null ? (data.change > 0 ? '+' : '') + data.change.toFixed(1) : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: changeColor, fontWeight: 600 }}>
                        {data.change_pct != null ? (data.change_pct > 0 ? '+' : '') + data.change_pct.toFixed(1) + '%' : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Per-trace response comparison */}
          {comparison.trace_comparisons && comparison.trace_comparisons.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                Response Comparison ({comparison.trace_comparisons.length} traces)
              </h4>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {comparison.trace_comparisons.map((tc, idx) => {
                  const scoreA = Object.values(tc.run_a_scores || {})?.[0]
                  const scoreB = Object.values(tc.run_b_scores || {})?.[0]
                  const improved = typeof scoreA === 'number' && typeof scoreB === 'number' && scoreB > scoreA
                  const regressed = typeof scoreA === 'number' && typeof scoreB === 'number' && scoreB < scoreA
                  return (
                    <div key={tc.trace_id || idx} style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr',
                      gap: 12, padding: 12, marginBottom: 8,
                      background: improved ? '#f0fdf4' : regressed ? '#fef2f2' : '#f8fafc',
                      border: `1px solid ${improved ? '#bbf7d0' : regressed ? '#fecaca' : '#e2e8f0'}`,
                      borderRadius: 8,
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#0369a1', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>Run A (Old)</span>
                          {scoreA != null && <span style={{ fontFamily: 'monospace' }}>{typeof scoreA === 'number' ? scoreA.toFixed(1) : String(scoreA)}</span>}
                        </div>
                        {tc.run_a_request && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}><strong>Q:</strong> {String(tc.run_a_request).slice(0, 120)}</div>}
                        <div style={{ fontSize: 11, color: '#1e293b', whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>
                          {String(tc.run_a_response || '—').slice(0, 200)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#92400e', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>Run B (New)</span>
                          {scoreB != null && <span style={{ fontFamily: 'monospace' }}>{typeof scoreB === 'number' ? scoreB.toFixed(1) : String(scoreB)}</span>}
                        </div>
                        {tc.run_b_request && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}><strong>Q:</strong> {String(tc.run_b_request).slice(0, 120)}</div>}
                        <div style={{ fontSize: 11, color: '#1e293b', whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden' }}>
                          {String(tc.run_b_response || '—').slice(0, 200)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Run metadata */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        <MetaCard label="Status" value={run.status} icon={Clock}
          valueStyle={{ color: statusColor, textTransform: 'capitalize' }} />
        <MetaCard label="Aggregate Score" value={`${(run.aggregate_score || 0).toFixed(1)}%`}
          icon={Award} valueStyle={{ color: (run.aggregate_score || 0) >= 60 ? '#10b981' : '#ef4444' }} />
        <MetaCard label="Passed" value={run.aggregate_passed ? 'Yes' : 'No'}
          icon={run.aggregate_passed ? CheckCircle : XCircle}
          valueStyle={{ color: run.aggregate_passed ? '#10b981' : '#ef4444' }} />
        {run.trace_id && (
          <MetaCard label="Trace ID" value={run.trace_id.slice(0, 16) + '...'} icon={FileText}
            onClick={() => navigate(`/trace/${run.trace_id}`)} />
        )}
        {run.dataset_id && (
          <MetaCard label="Dataset" value={run.dataset_id} icon={Database} />
        )}
        <MetaCard label="Evaluators" value={`${(run.evaluator_ids || []).length}`} icon={Cpu} />
      </div>

      {/* Evaluated Trace Summary */}
      {traceDetail && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 20,
          border: '1px solid #e2e8f0', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} color="#3b82f6" /> Evaluated Trace
            </h3>
            <button
              onClick={() => navigate(`/trace/${traceDetail.trace_id}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff',
                cursor: 'pointer', fontSize: 11, color: '#3b82f6', fontWeight: 600,
              }}
            >
              <ExternalLink size={11} /> View Full Trace
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>Status</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: traceDetail.status === 'ok' ? '#10b981' : traceDetail.status === 'error' ? '#ef4444' : '#f59e0b' }}>
                {traceDetail.status || 'unknown'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3 }}><Zap size={9} /> Latency</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                {traceDetail.latency_ms ? `${Number(traceDetail.latency_ms).toFixed(0)}ms` : '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3 }}><Hash size={9} /> Tokens</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                {traceDetail.total_tokens ?? '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 3 }}><DollarSign size={9} /> Cost</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                {traceDetail.total_cost_usd != null ? `$${Number(traceDetail.total_cost_usd).toFixed(4)}` : '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>Service</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                {traceDetail.service_name || '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>LLM Calls</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                {traceDetail.llm_calls ?? '—'}
              </div>
            </div>
          </div>

          {/* Input/Output preview */}
          {(() => {
            const spans = traceDetail.flat_spans || traceDetail.spans || []
            let input = '', output = ''
            for (const s of spans) {
              const k = s.kind || ''
              if (!input && (k === 'agent' || k === 'chain') && s.inputs) {
                input = typeof s.inputs === 'string' ? s.inputs : JSON.stringify(s.inputs, null, 2)
              }
            }
            for (let i = spans.length - 1; i >= 0; i--) {
              const s = spans[i], k = s.kind || ''
              if (!output && (k === 'agent' || k === 'chain') && s.outputs) {
                output = typeof s.outputs === 'string' ? s.outputs : JSON.stringify(s.outputs, null, 2)
                break
              }
            }
            if (!input && !output) return null
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {input && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MessageSquare size={11} /> Agent Input
                    </div>
                    <pre style={{
                      fontSize: 11, color: '#374151', background: '#f0f9ff',
                      border: '1px solid #bae6fd', borderRadius: 6,
                      padding: 10, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto',
                      fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, margin: 0,
                    }}>
                      {input.slice(0, 2000)}
                    </pre>
                  </div>
                )}
                {output && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MessageSquare size={11} /> Agent Output
                    </div>
                    <pre style={{
                      fontSize: 11, color: '#374151', background: '#f0fdf4',
                      border: '1px solid #bbf7d0', borderRadius: 6,
                      padding: 10, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto',
                      fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, margin: 0,
                    }}>
                      {output.slice(0, 2000)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Radar chart (when we have 3+ results) */}
      {results.length > 2 && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 20,
          border: '1px solid #e2e8f0', marginBottom: 24,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
            Score Radar
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Radar name="Score" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Per-Evaluator Detailed Breakdown */}
      {(() => {
        const evalIds = run.evaluator_ids || []
        const resultMap = {}
        for (const r of results) resultMap[r.evaluator_id] = r
        const evalEntries = evalIds.map(eid => ({
          id: eid,
          ev: evaluatorMap[eid] || {},
          result: resultMap[eid] || null,
        }))
        if (results.length > 0 && evalEntries.length === 0) {
          for (const r of results) {
            evalEntries.push({ id: r.evaluator_id, ev: evaluatorMap[r.evaluator_id] || {}, result: r })
          }
        }
        if (evalEntries.length === 0) return null
        return (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cpu size={18} color="#6d28d9" /> Evaluator Results ({evalEntries.length})
            </h3>
            <div style={{ display: 'grid', gap: 16 }}>
              {evalEntries.map(({ id: eid, ev, result: r }, idx) => {
                const rubric = ev.config?.rubric || ev.rubric || ''
                const sysPrompt = ev.config?.system_prompt || ev.system_prompt || ''
                const evType = ev.type || (ev.config?.is_builtin ? 'builtin' : 'custom')
                const evCategory = ev.category || ev.config?.category || ''
                const evDesc = ev.description || ''
                const evModel = ev.config?.model || ''
                const score = r?.score || 0
                const hasError = r?.details?.error || (r?.reasoning && r.reasoning.toLowerCase().includes('failed:'))
                const borderColor = !r ? '#e2e8f0' : hasError ? '#fca5a5' : r.passed ? '#86efac' : '#fca5a5'
                const isExpanded = showJudgePrompt[eid]

                return (
                  <div key={eid} style={{
                    background: '#fff', borderRadius: 12,
                    border: `1.5px solid ${borderColor}`,
                    overflow: 'hidden',
                  }}>
                    {/* Header bar */}
                    <div style={{
                      padding: '16px 20px',
                      background: !r ? '#f8fafc' : hasError ? '#fef2f2' : r.passed ? '#f0fdf4' : '#fef2f2',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      borderBottom: `1px solid ${borderColor}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10,
                          background: !r ? '#f1f5f9' : hasError ? '#fee2e2' : r.passed ? '#dcfce7' : '#fee2e2',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          {!r ? <Cpu size={18} color="#94a3b8" />
                            : hasError ? <AlertTriangle size={18} color="#dc2626" />
                            : r.passed ? <CheckCircle size={18} color="#16a34a" />
                            : <XCircle size={18} color="#dc2626" />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
                              {ev.name || r?.evaluator_name || eid}
                            </span>
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.5px',
                              background: evType === 'llm_judge' ? '#ede9fe' : evType === 'builtin' ? '#e0f2fe' : '#f1f5f9',
                              color: evType === 'llm_judge' ? '#6d28d9' : evType === 'builtin' ? '#0369a1' : '#475569',
                            }}>
                              {evType === 'llm_judge' ? 'LLM Judge' : evType === 'conversation_judge' ? 'Conv. Judge' : evType}
                            </span>
                            {evCategory && (
                              <span style={{ fontSize: 9, color: '#94a3b8', background: '#f8fafc', padding: '2px 6px', borderRadius: 4 }}>
                                {evCategory}
                              </span>
                            )}
                          </div>
                          {evDesc && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{evDesc}</div>}
                        </div>
                      </div>

                      {/* Score + badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        {r && (
                          <div style={{ textAlign: 'right' }}>
                            {(r.output_type === 'boolean') ? (
                              <div style={{
                                fontSize: 22, fontWeight: 800, lineHeight: 1,
                                color: hasError ? '#94a3b8' : r.passed ? '#16a34a' : '#dc2626',
                              }}>
                                {r.passed ? 'TRUE' : 'FALSE'}
                              </div>
                            ) : (
                              <>
                                <div style={{
                                  fontSize: 28, fontWeight: 800, lineHeight: 1,
                                  color: hasError ? '#94a3b8' : score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626',
                                }}>
                                  {score.toFixed(1)}
                                </div>
                                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>/ 100</div>
                              </>
                            )}
                          </div>
                        )}
                        <div style={{
                          padding: '4px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                          background: !r ? '#f1f5f9' : hasError ? '#fee2e2' : r.passed ? '#dcfce7' : '#fee2e2',
                          color: !r ? '#64748b' : hasError ? '#991b1b' : r.passed ? '#166534' : '#991b1b',
                        }}>
                          {!r ? 'NOT RUN' : hasError ? 'ERROR' : r.passed ? 'PASS' : 'FAIL'}
                        </div>
                      </div>
                    </div>

                    {/* Body */}
                    <div style={{ padding: '16px 20px' }}>
                      {/* Score bar or boolean stats */}
                      {r && r.output_type === 'boolean' && (r.true_count != null || r.false_count != null) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                          <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>{r.true_count ?? 0} True</span>
                          <span style={{ fontSize: 12, color: '#64748b' }}>/</span>
                          <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{r.false_count ?? 0} False</span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>({r.pass_rate?.toFixed(1) ?? 0}% pass rate)</span>
                          <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                            {(r.true_count || 0) > 0 && (
                              <div style={{ width: `${(r.true_count / ((r.true_count || 0) + (r.false_count || 0) || 1)) * 100}%`, height: '100%', background: '#10b981' }} />
                            )}
                            {(r.false_count || 0) > 0 && (
                              <div style={{ width: `${(r.false_count / ((r.true_count || 0) + (r.false_count || 0) || 1)) * 100}%`, height: '100%', background: '#ef4444' }} />
                            )}
                          </div>
                        </div>
                      )}
                      {r && r.output_type !== 'boolean' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                          <div style={{ flex: 1, height: 10, background: '#f1f5f9', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(100, score)}%`, height: '100%',
                              background: hasError ? '#94a3b8' : score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444',
                              borderRadius: 5, transition: 'width 0.5s',
                            }} />
                          </div>
                          {r.min_score != null && (
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>
                              Min: {r.min_score?.toFixed(1)} | Max: {r.max_score?.toFixed(1)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Error details */}
                      {r && hasError && (
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#991b1b',
                          background: '#fef2f2', borderRadius: 8, padding: '10px 14px', marginBottom: 14,
                          border: '1px solid #fecaca', lineHeight: 1.6,
                        }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                          <div>
                            <strong>Error:</strong> {r.details?.error || r.reasoning || 'Evaluator encountered an error'}
                          </div>
                        </div>
                      )}

                      {/* Reasoning */}
                      {r && r.reasoning && !hasError && (
                        <div style={{
                          display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14,
                          padding: '10px 14px', borderRadius: 8,
                          background: r.passed ? '#f0fdf4' : '#fef2f2',
                          border: `1px solid ${r.passed ? '#bbf7d0' : '#fecaca'}`,
                        }}>
                          {r.passed
                            ? <CheckCircle size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                            : <AlertTriangle size={14} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                          }
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: r.passed ? '#166534' : '#991b1b', marginBottom: 3 }}>
                              {r.passed ? 'Assessment: PASS' : 'Assessment: FAIL'}
                            </div>
                            <MarkdownRenderer content={r.reasoning} size="xs" className="text-slate-700" />
                          </div>
                        </div>
                      )}

                      {/* Metric details tags */}
                      {r && r.details && !r.details.error && Object.keys(r.details).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                          {Object.entries(r.details).filter(([k]) => k !== 'model' && k !== 'raw_response').map(([k, v]) => (
                            <span key={k} style={{
                              fontSize: 11, color: '#475569', background: '#f1f5f9',
                              padding: '3px 8px', borderRadius: 6, fontFamily: 'ui-monospace, monospace',
                            }}>
                              {k}: {typeof v === 'number' ? v.toFixed(2) : String(v).slice(0, 50)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* No result message */}
                      {!r && (
                        <div style={{
                          fontSize: 12, color: '#94a3b8', fontStyle: 'italic',
                          padding: '8px 0', marginBottom: 8,
                        }}>
                          This evaluator did not produce a result. The run may have failed before it could execute.
                        </div>
                      )}

                      {/* Expandable: Rubric / Prompt / Config */}
                      <button
                        onClick={() => setShowJudgePrompt(p => ({ ...p, [eid]: !p[eid] }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 12, fontWeight: 600, color: '#7c3aed',
                        }}
                      >
                        <BookOpen size={13} />
                        {isExpanded ? 'Hide' : 'Show'} Evaluator Prompt & Config
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>

                      {isExpanded && (
                        <div style={{ marginTop: 10, display: 'grid', gap: 12 }}>
                          {evModel && (
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              <strong>Model:</strong> <span style={{ fontFamily: 'ui-monospace, monospace', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{evModel}</span>
                            </div>
                          )}
                          {rubric && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Info size={11} /> Evaluation Rubric
                                {run.evaluator_snapshots?.[eid] && (
                                  <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500, marginLeft: 6 }}>
                                    (used when this run was executed)
                                  </span>
                                )}
                              </div>
                              <pre style={{
                                fontSize: 11, color: '#374151', background: '#faf5ff',
                                border: '1px solid #e9d5ff', borderRadius: 8,
                                padding: 12, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto',
                                fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, margin: 0,
                              }}>
                                {rubric}
                              </pre>
                            </div>
                          )}
                          {sysPrompt && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Info size={11} /> System Prompt
                              </div>
                              <pre style={{
                                fontSize: 11, color: '#374151', background: '#f8fafc',
                                border: '1px solid #e2e8f0', borderRadius: 8,
                                padding: 12, whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto',
                                fontFamily: 'ui-monospace, monospace', lineHeight: 1.5, margin: 0,
                              }}>
                                {sysPrompt}
                              </pre>
                            </div>
                          )}
                          {!rubric && !sysPrompt && (
                            <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
                              No rubric or prompt available (built-in programmatic evaluator).
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Item-level results (for dataset mode) */}
      {run.item_results && run.item_results.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24,
          border: '1px solid #e2e8f0',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
            Item-Level Results ({run.item_results.length} items)
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={thStyle}>Item ID</th>
                {results.map(r => (
                  <th key={r.evaluator_id} style={{ ...thStyle, textAlign: 'center' }}>
                    <div>{r.evaluator_name}</div>
                    {r.output_type === 'boolean' ? (
                      <div style={{ fontSize: 9, fontWeight: 700, marginTop: 2, color: (r.pass_rate || 0) >= 80 ? '#10b981' : (r.pass_rate || 0) >= 50 ? '#f59e0b' : '#ef4444' }}>
                        {(r.pass_rate || 0).toFixed(0)}% ({r.true_count || 0}/{(r.true_count || 0) + (r.false_count || 0)})
                      </div>
                    ) : (
                      r.score != null && <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: '#64748b' }}>Avg: {r.score?.toFixed(1)}</div>
                    )}
                  </th>
                ))}
                <th style={thStyle}>Avg</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {run.item_results.map((item, idx) => {
                const expanded = expandedItems[idx]
                const itemScores = (item.results || []).map(r => r.score || 0)
                const avg = itemScores.length ? (itemScores.reduce((a, b) => a + b, 0) / itemScores.length) : 0
                return (
                  <>
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                      onClick={() => setExpandedItems(p => ({ ...p, [idx]: !p[idx] }))}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>
                        {item.item_id}
                      </td>
                      {(item.results || []).map((r, j) => (
                        <td key={j} style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {r.output_type === 'boolean' ? (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 8,
                              background: r.passed ? '#dcfce7' : '#fee2e2',
                              color: r.passed ? '#166534' : '#991b1b',
                            }}>
                              {r.passed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                              {r.passed ? 'TRUE' : 'FALSE'}
                            </span>
                          ) : (
                            <span style={{
                              fontWeight: 600, fontSize: 12,
                              color: r.score >= 60 ? '#10b981' : '#ef4444',
                            }}>{r.score?.toFixed(1)}</span>
                          )}
                        </td>
                      ))}
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>
                        <span style={{ color: avg >= 60 ? '#10b981' : '#ef4444' }}>
                          {avg.toFixed(1)}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {expanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${idx}-detail`}>
                        <td colSpan={results.length + 3} style={{ padding: '0 12px 12px' }}>
                          <div style={{
                            background: '#f8fafc', borderRadius: 8, padding: 12,
                            display: 'grid', gap: 8,
                          }}>
                            {(item.results || []).map((r, j) => (
                              <div key={j} style={{ fontSize: 12 }}>
                                <strong>{r.evaluator_name}:</strong>{' '}
                                <MarkdownRenderer content={r.reasoning || 'No reasoning'} size="xs" className="text-slate-500 inline" />
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Conversation Transcript with per-turn scores (for conversation runs) */}
      {run.mode === 'conversation' && run.per_turn_results && run.per_turn_results.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24,
          border: '1px solid #e2e8f0', marginBottom: 24, marginTop: 24,
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={18} color="#6d28d9" /> Conversation Transcript
          </h3>
          {run.session_id && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>
              Session: <span style={{ fontFamily: 'monospace' }}>{run.session_id}</span>
            </div>
          )}

          {/* Conversation-level evaluator summary cards */}
          {run.conversation_results && run.conversation_results.length > 0 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              {run.conversation_results.map((cr, i) => (
                <div key={i} style={{
                  padding: '12px 16px', borderRadius: 10,
                  background: cr.passed ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${cr.passed ? '#bbf7d0' : '#fecaca'}`,
                  minWidth: 160,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    {cr.evaluator_name || cr.evaluator_id}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 22, fontWeight: 800,
                      color: cr.passed ? '#16a34a' : '#dc2626',
                    }}>
                      {(cr.score || 0).toFixed(1)}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: cr.passed ? '#dcfce7' : '#fee2e2',
                      color: cr.passed ? '#166534' : '#991b1b',
                    }}>
                      {cr.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  {cr.reasoning && (
                    <div style={{ marginTop: 6 }}>
                      <MarkdownRenderer content={cr.reasoning.length > 150 ? cr.reasoning.slice(0, 150) + '...' : cr.reasoning} size="xs" className="text-slate-500" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Per-turn transcript */}
          <div style={{ display: 'grid', gap: 16 }}>
            {run.per_turn_results.map((turn, idx) => {
              const turnScores = turn.results || []
              const hasFailures = turnScores.some(r => !r.passed)
              return (
                <div key={idx} style={{
                  borderRadius: 10,
                  border: hasFailures ? '1.5px solid #fca5a5' : '1px solid #e2e8f0',
                  background: hasFailures ? '#fefefe' : '#fff',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '10px 16px',
                    background: hasFailures ? '#fef2f2' : '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: hasFailures ? '#fee2e2' : '#e0e7ff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: hasFailures ? '#dc2626' : '#4f46e5',
                      }}>
                        {turn.turn}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>Turn {turn.turn}</span>
                    </div>
                    {turn.trace_id && (
                      <span
                        style={{ fontSize: 11, fontFamily: 'monospace', color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/trace/${turn.trace_id}`)}
                      >
                        {turn.trace_id.slice(0, 16)}...
                      </span>
                    )}
                  </div>

                  {/* Per-turn scores */}
                  {turnScores.length > 0 && (
                    <div style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {turnScores.map((r, j) => (
                          <div key={j} style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
                            borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: r.passed ? '#f0fdf4' : '#fef2f2',
                            border: `1px solid ${r.passed ? '#bbf7d0' : '#fecaca'}`,
                            color: r.passed ? '#166534' : '#991b1b',
                          }}>
                            {r.passed ? <CheckCircle size={11} /> : <XCircle size={11} />}
                            {r.evaluator_name || r.evaluator_id}: {(r.score || 0).toFixed(1)}
                          </div>
                        ))}
                      </div>
                      {/* Reasoning for failing judges */}
                      {turnScores.filter(r => !r.passed && r.reasoning).map((r, j) => (
                        <div key={`reason-${j}`} style={{
                          marginTop: 8, fontSize: 11, color: '#991b1b', lineHeight: 1.5,
                          background: '#fef2f2', padding: '6px 10px', borderRadius: 6,
                          borderLeft: '3px solid #fca5a5',
                        }}>
                          <strong>{r.evaluator_name || r.evaluator_id}:</strong> <MarkdownRenderer content={r.reasoning} size="xs" className="inline" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-trace assessment table -- hidden for single-trace runs (Evaluator Results already covers it) */}
      {runTraces.length > 0 && !(run.trace_id && runTraces.length <= 1) && (() => {
        const evalIds = run.evaluator_ids || []
        const evalColumns = evalIds.length > 0
          ? evalIds.map(eid => ({ id: eid, name: evaluatorMap[eid]?.name || eid }))
          : results.map(r => ({ id: r.evaluator_id, name: r.evaluator_name || r.evaluator_id }))
        const colCount = 4 + evalColumns.length + 2

        const passRates = {}
        for (const col of evalColumns) {
          let passed = 0, total = 0
          const aggResult = results.find(r => r.evaluator_id === col.id)
          for (const t of runTraces) {
            const v = (t.scores || {})[col.id]
            if (v != null) { total++; if (typeof v === 'object' ? v.passed : (v >= 50)) passed++ }
          }
          passRates[col.id] = total > 0 ? Math.round(passed / total * 100) : null
        }

        return (
        <div style={{
          background: '#fff', borderRadius: 12, padding: 24,
          border: '1px solid #e2e8f0', marginTop: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
              Trace Assessments ({runTraces.length} traces)
            </h3>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Click a row to see reasoning</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={thStyle}>Trace ID</th>
                  <th style={thStyle}>Request</th>
                  <th style={thStyle}>Response</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  {evalColumns.map(col => (
                    <th key={col.id} style={{ ...thStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span>{col.name}</span>
                        {passRates[col.id] != null && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: passRates[col.id] >= 80 ? '#10b981' : passRates[col.id] >= 50 ? '#f59e0b' : '#ef4444' }}>
                            {passRates[col.id]}% pass
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                  <th style={{ ...thStyle, textAlign: 'center' }}>Avg</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {runTraces.map((t, i) => {
                  const statusColors = { ok: '#10b981', error: '#ef4444', running: '#f59e0b' }
                  const isExpanded = expandedTraces[i]
                  const scoreEntries = Object.entries(t.scores || {})
                  return (
                    <>
                      <tr
                        key={i}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9',
                          cursor: scoreEntries.length ? 'pointer' : 'default',
                          background: isExpanded ? '#fafafa' : 'transparent',
                        }}
                        onClick={() => scoreEntries.length && setExpandedTraces(p => ({ ...p, [i]: !p[i] }))}
                      >
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            style={{ fontFamily: 'monospace', fontSize: 11, color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}
                            onClick={e => { e.stopPropagation(); t.trace_id && navigate(`/trace/${t.trace_id}`) }}
                          >
                            {(t.trace_id || '').slice(0, 16)}…
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569', fontSize: 12 }}>
                          {typeof t.request === 'string' ? t.request.slice(0, 60) : JSON.stringify(t.request || '').slice(0, 60)}
                        </td>
                        <td style={{ padding: '8px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569', fontSize: 12 }}>
                          {typeof t.response === 'string' ? t.response.slice(0, 60) : JSON.stringify(t.response || '').slice(0, 60)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                            background: (statusColors[t.status] || '#64748b') + '18',
                            color: statusColors[t.status] || '#64748b',
                          }}>
                            {t.status || 'unknown'}
                          </span>
                        </td>
                        {evalColumns.map(col => {
                          const v = (t.scores || {})[col.id]
                          if (v == null) return <td key={col.id} style={{ padding: '8px 12px', textAlign: 'center' }}><Minus size={12} color="#cbd5e1" /></td>
                          const sc = typeof v === 'object' ? (v.score ?? 0) : (typeof v === 'number' ? v : 0)
                          const passed = typeof v === 'object' ? v.passed : sc >= 60
                          const otype = typeof v === 'object' ? (v.output_type || 'score') : 'score'
                          const aggResult = results.find(r => r.evaluator_id === col.id)
                          const effectiveType = otype || aggResult?.output_type || 'score'
                          return (
                            <td key={col.id} style={{ padding: '8px 12px', textAlign: 'center' }}>
                              {effectiveType === 'boolean' ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: passed ? '#dcfce7' : '#fee2e2',
                                  color: passed ? '#166534' : '#991b1b',
                                }}>
                                  {passed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                  {passed ? 'TRUE' : 'FALSE'}
                                </span>
                              ) : (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                  background: passed ? '#dcfce7' : '#fee2e2',
                                  color: passed ? '#166534' : '#991b1b',
                                }}>
                                  {passed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                                  {typeof sc === 'number' ? sc.toFixed(1) : sc}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: (t.aggregate_score || 0) >= 60 ? '#10b981' : '#ef4444' }}>
                          {(t.aggregate_score || 0).toFixed(1)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {scoreEntries.length > 0 && (
                            isExpanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${i}-expanded`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td colSpan={colCount} style={{ padding: '0 12px 12px', background: '#fafafa' }}>
                            <div style={{ display: 'grid', gap: 8, padding: '8px 0' }}>
                              {scoreEntries.filter(([, v]) => v && (typeof v === 'object' ? v.reasoning : false)).map(([eid, v]) => (
                                <div key={eid} style={{ fontSize: 12, lineHeight: 1.5 }}>
                                  <strong style={{ color: '#1e293b' }}>{evaluatorMap[eid]?.name || eid}:</strong>{' '}
                                  <MarkdownRenderer content={v.reasoning} size="xs" className="text-slate-500 inline" />
                                </div>
                              ))}
                              {t.trace_id && (
                                <button
                                  onClick={e => { e.stopPropagation(); navigate(`/trace/${t.trace_id}`) }}
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                                    borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff',
                                    cursor: 'pointer', fontSize: 11, color: '#3b82f6', fontWeight: 600, width: 'fit-content',
                                  }}
                                >
                                  <ExternalLink size={11} /> View Full Trace
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        )
      })()}
    </div>
  )
}

const thStyle = { textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748b', fontSize: 11 }

function MetaCard({ label, value, icon: Icon, valueStyle = {}, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 10, padding: '14px 16px',
      border: '1px solid #e2e8f0', cursor: onClick ? 'pointer' : 'default',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Icon size={16} color="#64748b" />
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', ...valueStyle }}>{value}</div>
      </div>
    </div>
  )
}

