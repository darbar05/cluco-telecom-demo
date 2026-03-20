import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getEvaluators, getDatasets, getTraces, runEvaluation,
  getSessions, runConversationEvaluation,
} from '../api'
import {
  Play, ChevronRight, ChevronLeft, CheckCircle, XCircle, Database,
  FileText, Brain, Zap, Shield, Target, Activity, Search,
  Loader, ArrowRight, MessageSquare,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

const stepNames = ['Choose Mode', 'Select Target', 'Pick Evaluators', 'Review & Run']

const typeColors = { builtin: '#3b82f6', llm_judge: '#8b5cf6', custom: '#f59e0b' }

export default function RunEvaluationPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState('trace') // trace | dataset | conversation
  const [traceId, setTraceId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState([])
  const [traceSearch, setTraceSearch] = useState('')
  const [traces, setTraces] = useState([])
  const [datasetId, setDatasetId] = useState('')
  const [datasets, setDatasets] = useState([])
  const [evaluators, setEvaluators] = useState([])
  const [selectedEvaluators, setSelectedEvaluators] = useState([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getEvaluators({}).then(r => setEvaluators(r.data?.evaluators || [])).catch(() => {})
    getDatasets({}).then(r => setDatasets(r.data?.datasets || [])).catch(() => {})
    getSessions({}).then(r => setSessions(r.data?.sessions || [])).catch(() => {})
  }, [])

  // Refetch evaluators when entering Review step so displayed config is fresh
  useEffect(() => {
    if (step === 3) {
      getEvaluators({}).then(r => setEvaluators(r.data?.evaluators || [])).catch(() => {})
    }
  }, [step])

  const searchTraces = useCallback(async () => {
    try {
      const r = await getTraces({ limit: 20 })
      setTraces(r.data?.traces || [])
    } catch { setTraces([]) }
  }, [])

  useEffect(() => { searchTraces() }, [searchTraces])

  const toggleEval = (id) => {
    setSelectedEvaluators(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const selectAll = () => {
    if (selectedEvaluators.length === evaluators.length) {
      setSelectedEvaluators([])
    } else {
      setSelectedEvaluators(evaluators.map(e => e.evaluator_id))
    }
  }

  const canNext = () => {
    if (step === 0) return true
    if (step === 1) {
      if (mode === 'trace') return !!traceId
      if (mode === 'dataset') return !!datasetId
      if (mode === 'conversation') return !!sessionId
      return false
    }
    if (step === 2) return selectedEvaluators.length > 0
    return true
  }

  const handleRun = async () => {
    setRunning(true)
    setError('')
    try {
      // Refetch evaluators right before run to ensure we use latest saved config
      const freshRes = await getEvaluators({})
      const freshEvaluators = freshRes.data?.evaluators || []
      const evaluatorConfigs = {}
      for (const eid of selectedEvaluators) {
        const ev = freshEvaluators.find(e => e.evaluator_id === eid)
        if (ev) {
          evaluatorConfigs[eid] = { name: ev.name, type: ev.type, config: ev.config || {}, description: ev.description, category: ev.category }
        }
      }
      console.debug('[RunEvaluation] Refetched evaluators:', freshEvaluators.length, 'selected:', selectedEvaluators.length, 'configs built:', Object.keys(evaluatorConfigs).length)
      if (Object.keys(evaluatorConfigs).length > 0) {
        for (const [eid, cfg] of Object.entries(evaluatorConfigs)) {
          const rubric = cfg.config?.rubric || ''
          console.debug('[RunEvaluation] evaluator_configs[%s] rubric len=%s preview=%s', eid, rubric.length, rubric.slice(0, 60) + '...')
        }
      }

      let r
      if (mode === 'conversation') {
        r = await runConversationEvaluation({
          session_id: sessionId,
          evaluator_ids: selectedEvaluators,
          product_id: 'default',
          evaluator_configs: Object.keys(evaluatorConfigs).length ? evaluatorConfigs : undefined,
        })
      } else {
        const payload = {
          evaluator_ids: selectedEvaluators,
          product_id: 'default',
          evaluator_configs: Object.keys(evaluatorConfigs).length ? evaluatorConfigs : undefined,
        }
        if (mode === 'trace') payload.trace_id = traceId
        if (mode === 'dataset') payload.dataset_id = datasetId
        if (mode === 'dataset' && traceId) payload.trace_id = traceId
        r = await runEvaluation(payload)
      }
      setResult(r.data)
      if (r.data?.run_id) {
        setTimeout(() => navigate(`/evaluations/runs/${r.data.run_id}`), 1500)
      }
    } catch (e) {
      setError(e.response?.data?.detail || 'Evaluation failed')
    }
    setRunning(false)
  }

  const filteredTraces = traceSearch
    ? traces.filter(t => (t.trace_id || '').toLowerCase().includes(traceSearch.toLowerCase()) ||
        (t.service_name || '').toLowerCase().includes(traceSearch.toLowerCase()))
    : traces

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto' }}>
      <PageHeader title="Run Evaluation" subtitle="Evaluate a trace or dataset with selected evaluators" icon={Play} />

      {/* Stepper */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32,
        background: '#f8fafc', borderRadius: 12, padding: '16px 24px',
      }}>
        {stepNames.map((name, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: i < step ? 'pointer' : 'default',
            }} onClick={() => i < step && setStep(i)}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: i < step ? '#10b981' : i === step ? '#3b82f6' : '#e2e8f0',
                color: i <= step ? '#fff' : '#94a3b8',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>
                {i < step ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span style={{
                fontSize: 12, fontWeight: i === step ? 700 : 500,
                color: i === step ? '#1e293b' : '#64748b',
              }}>{name}</span>
            </div>
            {i < stepNames.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? '#10b981' : '#e2e8f0', margin: '0 12px' }} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 32,
        border: '1px solid #e2e8f0', minHeight: 300,
      }}>
        {step === 0 && <StepMode mode={mode} setMode={setMode} />}
        {step === 1 && (
          <StepTarget
            mode={mode} traceId={traceId} setTraceId={setTraceId}
            traceSearch={traceSearch} setTraceSearch={setTraceSearch}
            traces={filteredTraces} datasetId={datasetId} setDatasetId={setDatasetId}
            datasets={datasets} sessionId={sessionId} setSessionId={setSessionId}
            sessions={sessions}
          />
        )}
        {step === 2 && (
          <StepEvaluators
            evaluators={evaluators} selected={selectedEvaluators}
            toggle={toggleEval} selectAll={selectAll}
          />
        )}
        {step === 3 && (
          <StepReview
            mode={mode} traceId={traceId} datasetId={datasetId}
            evaluators={evaluators} selected={selectedEvaluators}
            running={running} result={result} error={error}
            onRun={handleRun}
          />
        )}
      </div>

      {/* Navigation buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={() => step > 0 ? setStep(step - 1) : navigate('/evaluations')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
            background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer',
            fontWeight: 600, fontSize: 13, color: '#475569',
          }}>
          <ChevronLeft size={16} /> {step === 0 ? 'Back to Hub' : 'Previous'}
        </button>
        {step < 3 && (
          <button onClick={() => setStep(step + 1)} disabled={!canNext()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px',
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              cursor: canNext() ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 13,
              opacity: canNext() ? 1 : 0.5,
            }}>
            Next <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Step 1: Choose Mode ── */
function StepMode({ mode, setMode }) {
  const options = [
    { id: 'trace', label: 'Evaluate a Trace', desc: 'Run evaluators against a specific completed trace', icon: FileText, color: '#3b82f6' },
    { id: 'dataset', label: 'Evaluate against Dataset', desc: 'Compare trace output to ground truth dataset items', icon: Database, color: '#8b5cf6' },
    { id: 'conversation', label: 'Evaluate a Conversation', desc: 'Run conversation-level evaluators across all turns in a session', icon: MessageSquare, color: '#9333ea' },
  ]
  return (
    <div>
      <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
        What do you want to evaluate?
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {options.map(o => (
          <div key={o.id} role="button" tabIndex={0} aria-label={o.label} onClick={() => setMode(o.id)} onKeyDown={e => e.key === 'Enter' && setMode(o.id)} style={{
            padding: 24, borderRadius: 12, cursor: 'pointer',
            border: `2px solid ${mode === o.id ? o.color : '#e2e8f0'}`,
            background: mode === o.id ? o.color + '08' : '#fff',
            transition: 'all 0.15s',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: o.color + '12', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 12,
            }}>
              <o.icon size={20} color={o.color} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>{o.label}</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>{o.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Step 2: Select Target ── */
function StepTarget({ mode, traceId, setTraceId, traceSearch, setTraceSearch, traces, datasetId, setDatasetId, datasets, sessionId, setSessionId, sessions }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
        {mode === 'trace' ? 'Select a Trace' : 'Select a Dataset'}
      </h3>

      {mode === 'trace' ? (
        <>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: '#94a3b8' }} />
            <input value={traceSearch} onChange={e => setTraceSearch(e.target.value)}
              placeholder="Search traces by ID or service name..."
              style={{
                width: '100%', padding: '10px 12px 10px 36px', border: '1px solid #d1d5db',
                borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }} />
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            {traces.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No traces found</div>
            ) : traces.map(t => (
              <div key={t.trace_id} onClick={() => setTraceId(t.trace_id)} style={{
                padding: '10px 14px', cursor: 'pointer',
                background: traceId === t.trace_id ? '#eff6ff' : '#fff',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{t.trace_id}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {t.service_name} · {t.status} · {t.latency_ms?.toFixed(0)}ms
                  </div>
                </div>
                {traceId === t.trace_id && <CheckCircle size={16} color="#3b82f6" />}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {datasets.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
              No datasets found. Create one first.
            </div>
          ) : datasets.map(ds => (
            <div key={ds.dataset_id} role="button" tabIndex={0} aria-label={ds.name} onClick={() => setDatasetId(ds.dataset_id)} onKeyDown={e => e.key === 'Enter' && setDatasetId(ds.dataset_id)} style={{
              padding: 16, borderRadius: 10, cursor: 'pointer',
              border: `2px solid ${datasetId === ds.dataset_id ? '#8b5cf6' : '#e2e8f0'}`,
              background: datasetId === ds.dataset_id ? '#f5f3ff' : '#fff',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{ds.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {ds.item_count || 0} items · {ds.product_id || 'default'}
                  </div>
                </div>
                {datasetId === ds.dataset_id && <CheckCircle size={16} color="#8b5cf6" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === 'conversation' && (
        <>
          <div style={{ maxHeight: 300, overflow: 'auto', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            {sessions.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No sessions found</div>
            ) : sessions.map(s => (
              <div key={s.session_id} onClick={() => setSessionId(s.session_id)} style={{
                padding: '10px 14px', cursor: 'pointer',
                background: sessionId === s.session_id ? '#f5f3ff' : '#fff',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{s.session_id}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {s.trace_count || 0} traces · {s.product_id || 'default'}
                  </div>
                </div>
                {sessionId === s.session_id && <CheckCircle size={16} color="#9333ea" />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Step 3: Pick Evaluators ── */
function StepEvaluators({ evaluators, selected, toggle, selectAll }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
          Select Evaluators ({selected.length} selected)
        </h3>
        <button onClick={selectAll} style={{
          padding: '6px 14px', background: '#f1f5f9', border: 'none', borderRadius: 6,
          cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#475569',
        }}>
          {selected.length === evaluators.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {evaluators.map(ev => {
          const active = selected.includes(ev.evaluator_id)
          const color = typeColors[ev.type] || '#6b7280'
          return (
            <div key={ev.evaluator_id} role="button" tabIndex={0} aria-label={ev.name} onClick={() => toggle(ev.evaluator_id)} onKeyDown={e => e.key === 'Enter' && toggle(ev.evaluator_id)} style={{
              padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
              border: `2px solid ${active ? color : '#e2e8f0'}`,
              background: active ? color + '08' : '#fff',
              transition: 'all 0.15s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 4,
                  border: `2px solid ${active ? color : '#d1d5db'}`,
                  background: active ? color : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {active && <CheckCircle size={12} color="#fff" />}
                </div>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{ev.name}</span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginLeft: 26 }}>
                {ev.description?.slice(0, 80)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Step 4: Review & Run ── */
function StepReview({ mode, traceId, datasetId, evaluators, selected, running, result, error, onRun }) {
  const selEvals = evaluators.filter(e => selected.includes(e.evaluator_id))

  return (
    <div>
      <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
        Review & Run
      </h3>

      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 80 }}>Mode</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            {mode === 'trace' ? 'Evaluate Trace' : 'Evaluate Dataset'}
          </span>
        </div>
        {traceId && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 80 }}>Trace</span>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{traceId}</span>
          </div>
        )}
        {datasetId && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 80 }}>Dataset</span>
            <span style={{ fontSize: 13 }}>{datasetId}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', minWidth: 80, paddingTop: 2 }}>Evaluators</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selEvals.map(e => (
              <span key={e.evaluator_id} style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: (typeColors[e.type] || '#6b7280') + '15',
                color: typeColors[e.type] || '#6b7280',
              }}>{e.name}</span>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', background: '#fef2f2', borderRadius: 8,
          color: '#991b1b', fontSize: 13, marginBottom: 16,
        }}>{error}</div>
      )}

      {result ? (
        <div style={{
          padding: '20px', background: result.status === 'completed' ? '#f0fdf4' : '#fef2f2',
          borderRadius: 10,
        }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <CheckCircle size={32} color={result.status === 'completed' ? '#10b981' : '#ef4444'} style={{ marginBottom: 8 }} />
            <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>
              Evaluation {result.status}!
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Aggregate Score: <strong>{(result.aggregate_score || 0).toFixed(1)}</strong>
            </div>
          </div>

          {(result.results || []).length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              {(result.results || []).map((r, i) => {
                const otype = r.output_type || 'score'
                return (
                  <div key={r.evaluator_id || i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 8, background: '#fff',
                    border: `1px solid ${r.passed ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {r.passed
                        ? <CheckCircle size={14} color="#16a34a" />
                        : <XCircle size={14} color="#dc2626" />}
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                        {r.evaluator_name || r.evaluator_id}
                      </span>
                      <span style={{
                        fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                        background: otype === 'boolean' ? '#ede9fe' : '#e0f2fe',
                        color: otype === 'boolean' ? '#6d28d9' : '#0369a1',
                      }}>{otype}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {otype === 'boolean' ? (
                        <span style={{
                          fontWeight: 700, fontSize: 14,
                          color: r.passed ? '#16a34a' : '#dc2626',
                        }}>
                          {r.passed ? 'TRUE' : 'FALSE'}
                        </span>
                      ) : (
                        <span style={{
                          fontWeight: 700, fontSize: 14,
                          color: (r.score || 0) >= 80 ? '#16a34a' : (r.score || 0) >= 60 ? '#d97706' : '#dc2626',
                        }}>
                          {(r.score || 0).toFixed(1)}
                        </span>
                      )}
                      {r.true_count != null && (
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>
                          ({r.true_count}T / {r.false_count}F)
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>Redirecting to results...</div>
        </div>
      ) : (
        <button onClick={onRun} disabled={running} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '14px', background: '#3b82f6', color: '#fff',
          border: 'none', borderRadius: 10, cursor: running ? 'wait' : 'pointer',
          fontWeight: 700, fontSize: 15, opacity: running ? 0.7 : 1,
        }}>
          {running ? <><Loader size={18} className="spin" /> Running Evaluation...</> :
            <><Play size={18} /> Run Evaluation</>}
        </button>
      )}
    </div>
  )
}
