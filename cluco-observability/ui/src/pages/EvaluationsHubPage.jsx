import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getEvaluators, createEvaluator, updateEvaluator, deleteEvaluator,
  getEvaluationRuns, getEvaluationRunStats, getProducts, getTraces,
  testEvaluator, runEvaluatorOnTraces, runEvaluatorOnAllTraces, getEvaluatorMonitor, setEvaluatorMonitor,
  getEvaluatorTemplates,
} from '../api'
import MarkdownRenderer from '../components/MarkdownRenderer'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Award, Play, Database, Plus, Edit2, Trash2, Shield, Brain,
  Zap, CheckCircle, XCircle, ChevronRight, ChevronDown, Settings, BarChart3,
  Activity, Target, Cpu, FileText, RefreshCw, Eye, EyeOff,
  MessageSquare, Sparkles, Info, RotateCcw, BookOpen,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import Pagination from '../components/ui/Pagination'
import { useClientPagination } from '../hooks/useClientPagination'

const tooltipStyle = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '12px',
}

const CATEGORY_COLORS = {
  safety: { bg: '#fef2f2', text: '#dc2626', label: 'Safety' },
  quality: { bg: '#eff6ff', text: '#2563eb', label: 'Quality' },
  rag: { bg: '#f0fdf4', text: '#16a34a', label: 'RAG' },
  agent: { bg: '#fefce8', text: '#ca8a04', label: 'Agent' },
  conversation: { bg: '#faf5ff', text: '#9333ea', label: 'Conversation' },
  programmatic: { bg: '#f1f5f9', text: '#475569', label: 'Programmatic' },
  custom: { bg: '#fff7ed', text: '#ea580c', label: 'Custom' },
}

const typeColors = { builtin: '#3b82f6', llm_judge: '#8b5cf6', custom: '#f59e0b', conversation_judge: '#9333ea' }

function CategoryBadge({ category }) {
  const cfg = CATEGORY_COLORS[category] || CATEGORY_COLORS.custom
  return (
    <span style={{
      background: cfg.bg, color: cfg.text, borderRadius: 6,
      padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    }}>{cfg.label}</span>
  )
}

function TypeBadge({ type }) {
  const labels = { builtin: 'Programmatic', llm_judge: 'LLM Judge', custom: 'Rule-based', conversation_judge: 'Conv Judge' }
  const color = typeColors[type] || '#6b7280'
  return (
    <span style={{
      background: color + '15', color, borderRadius: 6,
      padding: '2px 8px', fontSize: 11, fontWeight: 600,
    }}>{labels[type] || type}</span>
  )
}

export default function EvaluationsHubPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [runs, setRuns] = useState([])
  const [evaluators, setEvaluators] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editEval, setEditEval] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = productFilter || undefined
      const [st, rn, ev, pr] = await Promise.all([
        getEvaluationRunStats({ product_id: p }).then(r => r.data),
        getEvaluationRuns({ product_id: p, limit: 20 }).then(r => r.data),
        getEvaluators({ category: categoryFilter || undefined }).then(r => r.data),
        getProducts().then(r => r.data),
      ])
      setStats(st)
      setRuns(rn.runs || [])
      setEvaluators(ev.evaluators || [])
      setProducts(pr.products || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [productFilter, categoryFilter])

  useEffect(() => { load() }, [load])

  const handleDeleteEvaluator = async (id) => {
    if (!confirm('Delete this evaluator?')) return
    await deleteEvaluator(id)
    load()
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <PageHeader title="Evaluations" subtitle="Comprehensive evaluation framework with 30+ built-in judges" icon={Award} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 0, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
          {['overview', 'evaluators'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 13,
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#1e293b' : '#64748b',
              boxShadow: tab === t ? '0 1px 3px rgb(0 0 0/0.1)' : 'none',
            }}>
              {t === 'overview' ? 'Overview & Runs' : 'Evaluators'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FilterBar>
            <FilterSelect label="Product" value={productFilter} onChange={e => setProductFilter(e.target.value)}
              options={[{ value: '', label: 'All Products' }, ...products.map(p => ({ value: p, label: p }))]} />
            {tab === 'evaluators' && (
              <FilterSelect label="Category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                options={[
                  { value: '', label: 'All Categories' },
                  { value: 'safety', label: 'Safety' },
                  { value: 'quality', label: 'Quality' },
                  { value: 'rag', label: 'RAG' },
                  { value: 'agent', label: 'Agent' },
                  { value: 'conversation', label: 'Conversation' },
                  { value: 'programmatic', label: 'Programmatic' },
                ]} />
            )}
          </FilterBar>
          <button onClick={() => navigate('/evaluations/run')} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
            fontWeight: 600, cursor: 'pointer', fontSize: 13,
          }}><Play size={14} /> Run Evaluation</button>
          <button onClick={() => navigate('/evaluations/datasets')} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 8,
            fontWeight: 600, cursor: 'pointer', fontSize: 13,
          }}><Database size={14} /> Datasets</button>
        </div>
      </div>

      {loading ? <SkeletonTable rows={6} /> : tab === 'overview' ? (
        <OverviewTab stats={stats} runs={runs} navigate={navigate} />
      ) : (
        <EvaluatorsTab
          evaluators={evaluators} onDelete={handleDeleteEvaluator}
          showCreate={showCreate} setShowCreate={setShowCreate}
          editEval={editEval} setEditEval={setEditEval}
          onSave={load}
        />
      )}
    </div>
  )
}

function OverviewTab({ stats, runs, navigate }) {
  const runsPg = useClientPagination(runs)
  if (!stats) return <EmptyState message="No evaluation data yet" icon={Award} />

  const totalRuns = stats.total_runs || 0
  const completedRuns = stats.completed_runs || 0
  const failedRuns = stats.failed_runs || 0

  const kpis = [
    { label: 'Total Runs', value: totalRuns, sub: completedRuns > 0 || failedRuns > 0 ? `${completedRuns} completed, ${failedRuns} failed` : null, icon: Play, color: '#3b82f6' },
    { label: 'Avg Score', value: completedRuns > 0 ? `${stats.avg_score || 0}%` : '—', sub: completedRuns === 0 && totalRuns > 0 ? 'No completed runs yet' : null, icon: Award, color: completedRuns > 0 ? '#10b981' : '#94a3b8' },
    { label: 'Pass Rate', value: completedRuns > 0 ? `${stats.pass_rate || 0}%` : '—', sub: completedRuns === 0 && totalRuns > 0 ? 'No completed runs yet' : null, icon: CheckCircle, color: completedRuns > 0 ? '#8b5cf6' : '#94a3b8' },
  ]

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {kpis.map(k => (
          <div key={k.label} style={{
            background: '#fff', borderRadius: 12, padding: '20px 24px',
            border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: k.color + '12', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><k.icon size={20} color={k.color} /></div>
            <div>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>{k.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Warning when all runs failed */}
      {totalRuns > 0 && completedRuns === 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          background: '#fef3c7', border: '1px solid #fde68a',
          borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        }}>
          <Activity size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>All evaluation runs have failed</div>
            <div style={{ fontSize: 12, color: '#a16207', marginTop: 2, lineHeight: 1.5 }}>
              None of your {totalRuns} run{totalRuns > 1 ? 's' : ''} completed successfully. Check that your OPENAI_API_KEY is set correctly and your evaluator configurations are valid. Click on a run below for details.
            </div>
          </div>
        </div>
      )}

      {stats.timeline?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Score Trends</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="avg_score" name="Avg Score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pass_rate" name="Pass Rate" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>Recent Runs</h3>
        {runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No runs yet.</div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {['Run ID', 'Target', 'Evaluators', 'Score', 'Status', 'Date', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748b', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runsPg.paginatedData.map(r => (
                  <tr key={r.run_id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                    onClick={() => navigate(`/evaluations/runs/${r.run_id}`)}>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{r.run_id?.slice(0, 14)}...</td>
                    <td style={{ padding: '10px 12px' }}>
                      {r.session_id ? <span style={{ fontSize: 11, background: '#faf5ff', color: '#9333ea', padding: '2px 6px', borderRadius: 4 }}>Conv: {r.session_id.slice(0, 10)}...</span>
                        : r.trace_id ? <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.trace_id.slice(0, 12)}...</span>
                        : r.dataset_id || '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                        {(r.evaluator_ids || []).length} evaluators
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      {r.status === 'failed' ? (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      ) : (
                        <span style={{ color: (r.aggregate_score || 0) >= 60 ? '#10b981' : '#ef4444' }}>
                          {(r.aggregate_score || 0).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: r.status === 'completed' ? '#dcfce7' : r.status === 'failed' ? '#fef2f2' : '#fef3c7',
                        color: r.status === 'completed' ? '#166534' : r.status === 'failed' ? '#991b1b' : '#92400e',
                      }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#64748b', fontSize: 12 }}>
                      {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}><ChevronRight size={14} color="#94a3b8" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination currentPage={runsPg.page} totalItems={runsPg.totalItems} pageSize={runsPg.pageSize} onPageChange={runsPg.setPage} onPageSizeChange={runsPg.setPageSize} />
          </>
        )}
      </div>
    </>
  )
}

function EvaluatorsTab({ evaluators, onDelete, showCreate, setShowCreate, editEval, setEditEval, onSave }) {
  const llmJudges = evaluators.filter(e => e.type === 'llm_judge' || e.type === 'conversation_judge')
  const programmatic = evaluators.filter(e => e.type === 'builtin')
  const custom = evaluators.filter(e => !e.is_builtin)

  return (
    <>
      {(showCreate || editEval) && (
        <EvaluatorForm
          initial={editEval}
          onClose={() => { setShowCreate(false); setEditEval(null) }}
          onSaved={() => { setShowCreate(false); setEditEval(null); onSave() }}
        />
      )}

      {/* LLM Judge Evaluators (built-in + custom, editable prompts) */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>LLM Judge Evaluators ({llmJudges.length})</h3>
            <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>
              Prompts are editable
            </span>
          </div>
          <button onClick={() => setShowCreate(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
            fontWeight: 600, cursor: 'pointer', fontSize: 12,
          }}><Plus size={14} /> Create Judge</button>
        </div>
        {llmJudges.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No LLM judge evaluators.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                {['Name', 'Category', 'Type', 'Model', 'Auto-evaluate', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#64748b', fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {llmJudges.map(ev => (
                <tr key={ev.evaluator_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ev.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.description}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <CategoryBadge category={ev.category || 'custom'} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <TypeBadge type={ev.type} />
                    {ev.is_builtin && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>built-in</span>}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 11 }}>
                    {ev.config?.model || 'gpt-4o-mini'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <AutoEvalToggle evaluatorId={ev.evaluator_id} evaluator={ev} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => setEditEval(ev)} title="Edit prompt" style={{
                        padding: '4px 8px', background: '#eff6ff', border: 'none', borderRadius: 4, cursor: 'pointer',
                      }}><Edit2 size={12} color="#3b82f6" /></button>
                      <button onClick={async () => {
                        if (!confirm(`Run "${ev.name}" on all traces? This may take a few minutes.`)) return
                        try {
                          const res = await runEvaluatorOnAllTraces(ev.evaluator_id, { limit: 200 })
                          alert(`Done! ${res.data?.passed || 0}/${res.data?.total || 0} passed (${res.data?.pass_rate || 0}%)`)
                        } catch (e) { alert('Error: ' + (e.response?.data?.detail || e.message)) }
                      }} title="Run on all traces" style={{
                        padding: '4px 8px', background: '#f0fdf4', border: 'none', borderRadius: 4, cursor: 'pointer',
                      }}><Play size={12} color="#16a34a" /></button>
                      {!ev.is_builtin && (
                        <button onClick={() => onDelete(ev.evaluator_id)} title="Delete" style={{
                          padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, cursor: 'pointer',
                        }}><Trash2 size={12} color="#ef4444" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Programmatic Evaluators */}
      {programmatic.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600 }}>
            Programmatic Evaluators ({programmatic.length})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {programmatic.map(ev => (
              <div key={ev.evaluator_id} style={{
                padding: 14, borderRadius: 10, border: '1px solid #e2e8f0',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8, background: '#f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}><Cpu size={14} color="#475569" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{ev.name}</span>
                    <CategoryBadge category={ev.category || 'programmatic'} />
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{ev.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function AutoEvalToggle({ evaluatorId, evaluator }) {
  const [enabled, setEnabled] = useState(false)
  const [sampleRate, setSampleRate] = useState(100)
  const [loading, setLoading] = useState(true)
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    getEvaluatorMonitor(evaluatorId).then(res => {
      setEnabled(res.data?.enabled || false)
      setSampleRate(res.data?.sample_rate || 100)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [evaluatorId])

  const handleToggle = async () => {
    const newVal = !enabled
    setEnabled(newVal)
    const payload = { enabled: newVal, sample_rate: sampleRate }
    if (newVal && evaluator?.config) {
      payload.evaluator_config = evaluator.config
    }
    try { await setEvaluatorMonitor(evaluatorId, payload) }
    catch { setEnabled(!newVal) }
  }

  const handleSampleRate = async (rate) => {
    setSampleRate(rate)
    try { await setEvaluatorMonitor(evaluatorId, { enabled, sample_rate: rate }) }
    catch { /* ignore */ }
  }

  if (loading) return <span style={{ fontSize: 11, color: '#94a3b8' }}>...</span>

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={handleToggle} style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: enabled ? '#3b82f6' : '#d1d5db', position: 'relative', transition: 'background 0.2s',
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
            left: enabled ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }} />
        </button>
        {enabled && (
          <button onClick={() => setShowConfig(!showConfig)} style={{
            fontSize: 10, color: '#6b7280', cursor: 'pointer', background: 'none', border: 'none',
          }}>{sampleRate}%</button>
        )}
      </div>
      {showConfig && enabled && (
        <div style={{
          position: 'absolute', top: 24, left: 0, background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 6, padding: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,.05)', zIndex: 10, width: 140,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Sample rate</div>
          <input type="range" min={1} max={100} value={sampleRate} onChange={e => handleSampleRate(Number(e.target.value))} style={{ width: '100%' }} />
          <div style={{ fontSize: 11, textAlign: 'center', color: '#374151' }}>{sampleRate}%</div>
        </div>
      )}
    </div>
  )
}

function EvaluatorForm({ initial, onClose, onSaved }) {
  const isEdit = !!initial
  const isBuiltinEdit = initial?.is_builtin
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [type, setType] = useState(initial?.type || 'llm_judge')
  const [category, setCategory] = useState(initial?.category || 'custom')
  const [model, setModel] = useState(initial?.config?.model || 'gpt-4o-mini')
  const [rubric, setRubric] = useState(initial?.config?.rubric || '')
  const [systemPrompt, setSystemPrompt] = useState(initial?.config?.system_prompt || '')
  const [ruleField, setRuleField] = useState(initial?.config?.rules?.[0]?.field || 'latency_ms')
  const [ruleOp, setRuleOp] = useState(initial?.config?.rules?.[0]?.operator || '<=')
  const [ruleThreshold, setRuleThreshold] = useState(initial?.config?.rules?.[0]?.threshold || '')
  const [saving, setSaving] = useState(false)
  const [scope, setScope] = useState(initial?.config?.scope || 'traces')
  const [outputType, setOutputType] = useState(initial?.config?.output_type || 'score')
  const [selectedSampleTrace, setSelectedSampleTrace] = useState('')
  const [showTracePicker, setShowTracePicker] = useState(false)
  const [availableTraces, setAvailableTraces] = useState([])
  const [previewResult, setPreviewResult] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [templates, setTemplates] = useState([])
  const [variables, setVariables] = useState([])
  const [showVarRef, setShowVarRef] = useState(false)

  useEffect(() => {
    getEvaluatorTemplates().then(r => {
      setTemplates(r.data?.templates || [])
      setVariables(r.data?.variables || [])
    }).catch(() => {})
  }, [])

  const loadTraces = async () => {
    try {
      const r = await getTraces({ limit: 50 })
      setAvailableTraces(r.data?.traces || [])
    } catch { /* ignore */ }
  }

  const applyTemplate = (tmpl) => {
    setRubric(tmpl.rubric || '')
    setSystemPrompt(tmpl.system_prompt || '')
    if (tmpl.category) setCategory(tmpl.category)
    if (tmpl.output_type) setOutputType(tmpl.output_type)
    if (!name) setName(tmpl.name || '')
    if (!description) setDescription(tmpl.description || '')
  }

  const insertVariable = (varName) => {
    setRubric(prev => prev + varName)
  }

  const handleTestJudge = async () => {
    if (!selectedSampleTrace) return
    setPreviewLoading(true)
    setPreviewResult(null)
    try {
      const currentConfig = {
        model, rubric, system_prompt: systemPrompt, scope,
        output_type: outputType, score_range: [0, 100],
      }
      let evalId = initial?.evaluator_id
      if (!evalId) {
        const data = {
          name: name || 'Preview Judge', description, type: 'llm_judge',
          metric_type: outputType === 'boolean' ? 'binary' : 'score',
          config: currentConfig, enabled: true,
        }
        const res = await createEvaluator(data)
        evalId = res.data?.evaluator_id
      }
      if (evalId) {
        const res = await testEvaluator(evalId, {
          trace_id: selectedSampleTrace,
          config_override: currentConfig,
        })
        setPreviewResult(res.data)
      }
    } catch (e) {
      setPreviewResult({ ok: false, error: e.message || 'Test failed' })
    }
    setPreviewLoading(false)
  }

  const [saveStatus, setSaveStatus] = useState(null)

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      const llmConfig = { model, rubric, system_prompt: systemPrompt, scope, output_type: outputType, score_range: [0, 100] }
      console.debug('[Evaluator] handleSave: id=', initial?.evaluator_id, 'rubric_len=', rubric?.length, 'outputType=', outputType, 'isBuiltin=', isBuiltinEdit)
      let res
      if (isBuiltinEdit) {
        res = await updateEvaluator(initial.evaluator_id, {
          config: { ...initial.config, ...llmConfig },
          description,
          category,
        })
      } else if (isEdit) {
        const config = type === 'llm_judge' || type === 'conversation_judge'
          ? llmConfig
          : { rules: [{ field: ruleField, operator: ruleOp, threshold: parseFloat(ruleThreshold) || 0 }] }
        res = await updateEvaluator(initial.evaluator_id, { name, description, type, category, config, enabled: true })
      } else {
        const config = type === 'llm_judge' || type === 'conversation_judge'
          ? llmConfig
          : { rules: [{ field: ruleField, operator: ruleOp, threshold: parseFloat(ruleThreshold) || 0 }] }
        res = await createEvaluator({ name, description, type, category, metric_type: outputType === 'boolean' ? 'binary' : 'score', config, enabled: true })
      }
      if (res?.data?.ok === false) {
        setSaveStatus({ type: 'error', msg: res.data.error || 'Save failed — check server logs' })
        setSaving(false)
        return
      }
      setSaveStatus({ type: 'success', msg: 'Evaluator saved successfully' })
      setTimeout(() => onSaved(), 600)
    } catch (e) {
      console.error(e)
      setSaveStatus({ type: 'error', msg: e?.response?.data?.error || e?.message || 'Save failed' })
    }
    setSaving(false)
  }

  const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 0, border: '2px solid #3b82f6', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {isBuiltinEdit ? `Edit Built-in: ${initial.name}` : isEdit ? 'Edit Judge' : 'Create Judge'}
          </h3>
          {isBuiltinEdit && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>Built-in prompts are customizable</span>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>x</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: previewResult ? '1fr 1fr 1fr' : '1fr 1fr', minHeight: 500 }}>
        {/* Left Panel - Instructions */}
        <div style={{ padding: 24, borderRight: '1px solid #e2e8f0', overflowY: 'auto', maxHeight: 600 }}>
          {/* Template selector */}
          {!isBuiltinEdit && templates.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}><BookOpen size={12} style={{ marginRight: 4 }} />Start from Template</label>
              <select onChange={e => { const t = templates.find(x => x.template_id === e.target.value); if (t) applyTemplate(t) }} style={inputStyle} defaultValue="">
                <option value="">-- Select a template --</option>
                {templates.map(t => <option key={t.template_id} value={t.template_id}>{t.name} ({t.category})</option>)}
              </select>
            </div>
          )}

          {!isBuiltinEdit && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. routing_accuracy" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                    <option value="llm_judge">LLM Judge</option>
                    <option value="conversation_judge">Conversation Judge</option>
                    <option value="custom">Rule-based</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                    {Object.keys(CATEGORY_COLORS).map(c => <option key={c} value={c}>{CATEGORY_COLORS[c].label}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {(type === 'llm_judge' || type === 'conversation_judge' || isBuiltinEdit) && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Model</label>
                  <select value={model} onChange={e => setModel(e.target.value)} style={inputStyle}>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4-turbo">gpt-4-turbo</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Output Type</label>
                  <select value={outputType} onChange={e => setOutputType(e.target.value)} style={inputStyle}>
                    <option value="score">Score (0-100)</option>
                    <option value="boolean">Boolean (TRUE/FALSE)</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Evaluation Rubric / Instructions</label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {['{{input}}', '{{output}}', '{{tool_calls}}', '{{retrieved_context}}', '{{ground_truth}}', '{{system_prompt}}', '{{trace}}'].map(v => (
                      <button key={v} onClick={() => insertVariable(v)} style={{
                        padding: '1px 6px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 3,
                        fontSize: 10, cursor: 'pointer', color: '#6b7280', fontFamily: 'monospace',
                      }}>{v}</button>
                    ))}
                    {type === 'conversation_judge' && (
                      <button onClick={() => insertVariable('{{conversation_transcript}}')} style={{
                        padding: '1px 6px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 3,
                        fontSize: 10, cursor: 'pointer', color: '#9333ea', fontFamily: 'monospace',
                      }}>{'{{conversation_transcript}}'}</button>
                    )}
                  </div>
                </div>
                <textarea value={rubric} onChange={e => setRubric(e.target.value)}
                  style={{ ...inputStyle, minHeight: 180, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
                  placeholder="Enter your evaluation rubric..." />
              </div>

              {/* Variable reference */}
              <div style={{ marginBottom: 16 }}>
                <button onClick={() => setShowVarRef(!showVarRef)} style={{
                  display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 12, color: '#6b7280', padding: 0,
                }}>
                  <Info size={12} />
                  <span>Available variables reference</span>
                  <ChevronDown size={12} style={{ transform: showVarRef ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>
                {showVarRef && (
                  <div style={{ marginTop: 8, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    {variables.map(v => (
                      <div key={v.name} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 12 }}>
                        <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: 3, fontSize: 11, whiteSpace: 'nowrap', color: '#1e293b' }}>{v.name}</code>
                        <span style={{ color: '#64748b' }}>{v.description}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>System Prompt (optional override)</label>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                  style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                  placeholder="Override the default system prompt..." />
              </div>
            </>
          )}

          {type === 'custom' && !isBuiltinEdit && (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Field Path</label>
                <input value={ruleField} onChange={e => setRuleField(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Operator</label>
                  <select value={ruleOp} onChange={e => setRuleOp(e.target.value)} style={inputStyle}>
                    {['<=', '>=', '<', '>', '==', 'contains', 'regex'].map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Threshold</label>
                  <input value={ruleThreshold} onChange={e => setRuleThreshold(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} placeholder="What does this evaluator check?" />
          </div>
        </div>

        {/* Center Panel - Trace Selector & Content */}
        <div style={{ padding: 24, background: '#fafbfc', borderRight: previewResult ? '1px solid #e2e8f0' : 'none' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Eye size={14} /> Select Trace to Test
          </h4>
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => { setShowTracePicker(!showTracePicker); if (!showTracePicker) loadTraces() }} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
              background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
              fontSize: 13, cursor: 'pointer', color: '#374151', width: '100%', justifyContent: 'center',
            }}>{selectedSampleTrace ? `Selected: ${selectedSampleTrace.slice(0, 16)}...` : 'Select a trace to test'}</button>
            {showTracePicker && (
              <div style={{ marginTop: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 6px -1px rgb(0 0 0/0.05)' }}>
                {availableTraces.map(t => (
                  <div key={t.trace_id} onClick={() => { setSelectedSampleTrace(t.trace_id); setShowTracePicker(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: selectedSampleTrace === t.trace_id ? '#eff6ff' : '#fff', fontSize: 12 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#3b82f6' }}>{t.trace_id?.slice(0, 20)}...</div>
                    <div style={{ display: 'flex', gap: 8, color: '#64748b', fontSize: 11 }}>
                      <span>{t.service_name}</span>
                      <span style={{ color: t.status === 'ok' ? '#16a34a' : '#dc2626' }}>{t.status}</span>
                      {t.request && <span style={{ color: '#94a3b8' }}>"{typeof t.request === 'string' ? t.request.slice(0, 40) : '...'}..."</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={handleTestJudge} disabled={previewLoading || !selectedSampleTrace} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', flex: 1,
              background: previewLoading ? '#94a3b8' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
              fontWeight: 600, cursor: previewLoading ? 'wait' : 'pointer', fontSize: 13, justifyContent: 'center',
              opacity: !selectedSampleTrace ? 0.5 : 1,
            }}><Play size={13} /> {previewLoading ? 'Running...' : previewResult ? 'Re-Run Judge' : 'Run Judge'}</button>
            {previewResult && (
              <button onClick={() => { setPreviewResult(null); handleTestJudge() }} disabled={previewLoading} style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px',
                background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
                cursor: 'pointer', fontSize: 12, color: '#374151',
              }}><RotateCcw size={12} /> Re-Run</button>
            )}
          </div>

          {selectedSampleTrace && (
            <TraceInfoPanel
              traceInfo={availableTraces.find(t => t.trace_id === selectedSampleTrace)}
              traceContext={previewResult?.trace_context}
            />
          )}

          {!selectedSampleTrace && !previewResult && (
            <div style={{ marginTop: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>
              Select a trace above and click "Run Judge" to preview the result
            </div>
          )}
        </div>

        {/* Right Panel - Judge Output (only shown after running) */}
        {previewResult && (
          <div style={{ padding: 24, background: '#f8fafc', overflowY: 'auto', maxHeight: 600 }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Target size={14} /> Judge Output
            </h4>
            <div style={{ padding: 16, borderRadius: 8, background: '#fff', border: '1px solid #e2e8f0' }}>
              {previewResult.ok ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    {previewResult.result?.passed ?
                      <CheckCircle size={18} style={{ color: '#16a34a' }} /> :
                      <XCircle size={18} style={{ color: '#dc2626' }} />
                    }
                    <span style={{
                      padding: '3px 10px', borderRadius: 4, fontWeight: 600, fontSize: 12,
                      ...(previewResult.result?.passed
                        ? { background: '#dcfce7', color: '#166534' } : { background: '#fef2f2', color: '#991b1b' }),
                    }}>{previewResult.result?.passed ? 'PASSED' : 'FAILED'}</span>
                    {previewResult.result?.output_type === 'boolean' ? (
                      <span style={{ fontWeight: 700, fontSize: 18, color: previewResult.result?.passed ? '#16a34a' : '#dc2626' }}>
                        {previewResult.result?.passed ? 'TRUE' : 'FALSE'}
                      </span>
                    ) : (
                      <span style={{ fontWeight: 700, fontSize: 18, color: '#1e293b' }}>{previewResult.result?.score}/100</span>
                    )}
                  </div>
                  {previewResult.result?.reasoning && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Reasoning</div>
                      <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6 }}>
                        <MarkdownRenderer content={previewResult.result.reasoning} size="xs" />
                      </div>
                    </>
                  )}
                </>
              ) : <div style={{ color: '#991b1b', fontSize: 12 }}>Error: {previewResult.error}</div>}
            </div>
          </div>
        )}
      </div>

      {saveStatus && (
        <div style={{
          margin: '0 24px', padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          background: saveStatus.type === 'success' ? '#ecfdf5' : '#fef2f2',
          color: saveStatus.type === 'success' ? '#065f46' : '#991b1b',
          border: `1px solid ${saveStatus.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
        }}>
          {saveStatus.type === 'success' ? '\u2713' : '\u2717'} {saveStatus.msg}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '16px 24px', borderTop: '1px solid #e2e8f0' }}>
        <button onClick={onClose} style={{ padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Cancel</button>
        <button onClick={handleSave} disabled={saving || (!isBuiltinEdit && !name)} style={{
          padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
          cursor: saving ? 'wait' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving || (!isBuiltinEdit && !name) ? 0.5 : 1,
        }}>{saving ? 'Saving...' : isBuiltinEdit ? 'Save Custom Prompt' : isEdit ? 'Update Judge' : 'Create Judge'}</button>
      </div>
    </div>
  )
}

function TraceInfoPanel({ traceInfo, traceContext }) {
  const tc = traceContext || {}
  const info = traceInfo || {}
  const svc = tc.service_name || info.service_name || '—'
  const status = tc.status || info.status || '—'
  const latency = tc.latency_ms || info.latency_ms
  const request = tc.final_input || (typeof info.request === 'string' ? info.request : JSON.stringify(info.request || ''))
  const response = tc.final_output || (typeof info.response === 'string' ? info.response : JSON.stringify(info.response || ''))

  const spanBadge = (label, count, color) => count > 0 ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: color + '15', color }}>
      {label}: {count}
    </span>
  ) : null

  return (
    <div style={{ padding: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11, maxHeight: 400, overflowY: 'auto' }}>
      <div style={{ fontWeight: 600, color: '#374151', marginBottom: 8, fontSize: 12 }}>Trace Info</div>
      <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
        <div><span style={{ color: '#94a3b8' }}>Service:</span> {svc}</div>
        <div><span style={{ color: '#94a3b8' }}>Status:</span> <span style={{ color: status === 'ok' ? '#16a34a' : '#dc2626' }}>{status}</span></div>
        {latency != null && <div><span style={{ color: '#94a3b8' }}>Latency:</span> {Number(latency).toFixed(1)}ms</div>}
      </div>

      {(tc.total_span_count > 0 || tc.llm_span_count > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {spanBadge('Total Spans', tc.total_span_count, '#6366f1')}
          {spanBadge('LLM Calls', tc.llm_span_count, '#3b82f6')}
          {spanBadge('Tool Calls', tc.tool_span_count, '#f59e0b')}
          {spanBadge('Retriever', tc.retriever_span_count, '#10b981')}
        </div>
      )}

      {tc.llm_models?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#94a3b8' }}>Models:</span>{' '}
          {tc.llm_models.map((m, i) => (
            <span key={i} style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, background: '#eff6ff', color: '#1e40af', marginRight: 4 }}>{m}</span>
          ))}
        </div>
      )}

      {request && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>REQUEST</div>
          <div style={{ padding: 6, background: '#f8fafc', borderRadius: 4, fontSize: 11, color: '#1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'auto' }}>
            {request}
          </div>
        </div>
      )}

      {response && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>RESPONSE</div>
          <div style={{ padding: 6, background: '#f0fdf4', borderRadius: 4, fontSize: 11, color: '#1e293b', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'auto' }}>
            {response}
          </div>
        </div>
      )}

      {tc.tool_calls?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>TOOL CALLS</div>
          <div style={{ display: 'grid', gap: 3 }}>
            {tc.tool_calls.map((t, i) => (
              <div key={i} style={{ padding: 4, background: '#fffbeb', borderRadius: 4, fontSize: 10 }}>
                <span style={{ fontWeight: 600, color: '#92400e' }}>{t.name}</span>
                <span style={{ color: t.status === 'ok' ? '#16a34a' : '#dc2626', marginLeft: 4 }}>[{t.status}]</span>
                {t.input && <div style={{ color: '#64748b', marginTop: 2 }}>{t.input}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tc.retriever_queries?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>RETRIEVAL</div>
          <div style={{ display: 'grid', gap: 3 }}>
            {tc.retriever_queries.map((r, i) => (
              <div key={i} style={{ padding: 4, background: '#ecfdf5', borderRadius: 4, fontSize: 10 }}>
                <span style={{ color: '#064e3b' }}>Query: {r.query}</span>
                <span style={{ color: '#94a3b8', marginLeft: 4 }}>({r.doc_count} docs)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
