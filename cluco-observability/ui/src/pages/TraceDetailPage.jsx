import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getTrace, sendTraceForReview, listTraceReviews, getScoreConfigs, addTraceScores, getTraceScores, getDatasets, addDatasetItems, getTraceAssessments } from '../api'
import { Activity, Clock, Cpu, DollarSign, Layers, ArrowLeft, AlertCircle, Calendar, Sparkles, Share2, Mail, X, CheckCircle, XCircle, MessageSquare, Plus, Trash2, ClipboardCheck, Database, ChevronLeft, ChevronRight, Award } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'
import { formatNumber, formatLatency, formatCost } from '../utils/format'
import { SkeletonPage } from '../components/ui/Skeleton'
import TraceContent from '../components/TraceContent'
import TraceAssistant from '../components/TraceAssistant'
import MarkdownRenderer from '../components/MarkdownRenderer'

function SendReviewModal({ traceId, onClose }) {
  const [emails, setEmails] = useState([''])
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const addEmail = () => setEmails(p => [...p, ''])
  const removeEmail = (i) => setEmails(p => p.filter((_, idx) => idx !== i))
  const updateEmail = (i, v) => setEmails(p => p.map((e, idx) => idx === i ? v : e))

  const handleSend = async () => {
    const validEmails = emails.map(e => e.trim()).filter(Boolean)
    if (!validEmails.length) { setError('Enter at least one email address'); return }
    setSending(true); setError(null)
    try {
      const frontendBase = window.location.origin
      const res = await sendTraceForReview(traceId, { emails: validEmails, note, frontend_base_url: frontendBase })
      setResult(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to send review')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: 14, padding: 28, width: 480, maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#6d28d920', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Share2 size={18} color="#6d28d9" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Send Trace for Review</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Share with SMEs for expert evaluation</div>
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>
            <X size={18} />
          </button>
        </div>

        {result ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
              <CheckCircle size={18} color="#10b981" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>
                  Review link sent to {result.emails_sent} recipient{result.emails_sent !== 1 ? 's' : ''}!
                </div>
                {!result.smtp_enabled && (
                  <div style={{ fontSize: 11, color: '#047857', marginTop: 2 }}>
                    SMTP is not configured — share this link manually:
                  </div>
                )}
              </div>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>REVIEW LINK</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 11, color: '#6d28d9', flex: 1, wordBreak: 'break-all' }}>
                  {result.review_url || `${window.location.origin}/trace-review/${result.token}`}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(result.review_url || `${window.location.origin}/trace-review/${result.token}`)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}
                >
                  Copy
                </button>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>Expires in 7 days</div>
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '10px 0', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>
                <Mail size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Reviewer Emails
              </label>
              {emails.map((email, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input
                    type="email"
                    value={email}
                    onChange={e => updateEmail(i, e.target.value)}
                    placeholder={`reviewer${i + 1}@company.com`}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                      fontSize: 13, outline: 'none',
                    }}
                    onFocus={e => e.target.style.borderColor = '#6d28d9'}
                    onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                  />
                  {emails.length > 1 && (
                    <button onClick={() => removeEmail(i)} style={{ padding: '0 8px', border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addEmail}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0', border: 'none', background: 'none', cursor: 'pointer', color: '#6d28d9', fontSize: 12, fontWeight: 500 }}
              >
                <Plus size={12} /> Add another email
              </button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                <MessageSquare size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Note for reviewer <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Provide context about what you'd like the reviewer to focus on…"
                rows={3}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                  fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#6d28d9'}
                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
              />
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#991b1b' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px 0', border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#64748b' }}>
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                style={{
                  flex: 2, padding: '10px 0', background: sending ? '#a78bfa' : '#6d28d9',
                  color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13,
                  cursor: sending ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Share2 size={14} />
                {sending ? 'Sending…' : 'Send for Review'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AssessmentsSidebar({ traceId, onClose }) {
  const [assessments, setAssessments] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getTraceAssessments(traceId)
      .then(r => {
        const data = r.data?.assessments || r.data?.feedback || r.data || []
        setAssessments(Array.isArray(data) ? data : [])
      })
      .catch(() => setAssessments([]))
      .finally(() => setLoading(false))
  }, [traceId])

  const current = assessments[currentIdx] || null
  const total = assessments.length

  return (
    <div style={{ width: 340, borderLeft: '1px solid #e2e8f0', background: '#f8fafc', padding: 20, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Award size={16} color="#3b82f6" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Assessments ({total})</span>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={16} /></button>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>Loading...</div>
      ) : total === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>
          No automated assessments for this trace yet.
        </div>
      ) : (
        <>
          {total > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <button onClick={() => setCurrentIdx(i => Math.max(0, i - 1))} disabled={currentIdx === 0}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: currentIdx === 0 ? 'not-allowed' : 'pointer', color: currentIdx === 0 ? '#cbd5e1' : '#475569' }}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>{currentIdx + 1} of {total}</span>
              <button onClick={() => setCurrentIdx(i => Math.min(total - 1, i + 1))} disabled={currentIdx === total - 1}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: currentIdx === total - 1 ? 'not-allowed' : 'pointer', color: currentIdx === total - 1 ? '#cbd5e1' : '#475569' }}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {current && (() => {
            const name = current.evaluator_name || current.key || current.name || 'Assessment'
            const passed = current.passed ?? (current.value === true || current.value === 'True' || current.value === 'true')
            const failed = current.value === false || current.value === 'False' || current.value === 'false' || current.passed === false
            const score = current.score
            const reasoning = current.reasoning || current.comment || current.explanation || ''
            const evType = current.evaluator_type || current.type || current.source || ''
            const timestamp = current.created_at || current.timestamp || ''

            return (
              <div style={{ background: '#fff', borderRadius: 10, border: `1.5px solid ${failed ? '#fca5a5' : passed ? '#86efac' : '#e2e8f0'}`, overflow: 'hidden' }}>
                <div style={{
                  padding: '12px 14px',
                  background: failed ? '#fef2f2' : passed ? '#f0fdf4' : '#f8fafc',
                  borderBottom: `1px solid ${failed ? '#fca5a5' : passed ? '#86efac' : '#e2e8f0'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {failed ? <XCircle size={16} color="#dc2626" /> : passed ? <CheckCircle size={16} color="#16a34a" /> : <Award size={16} color="#64748b" />}
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{name}</div>
                      {evType && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase',
                          background: evType.includes('llm') ? '#ede9fe' : '#e0f2fe',
                          color: evType.includes('llm') ? '#6d28d9' : '#0369a1',
                        }}>{evType.includes('llm') ? 'LLM Judge' : evType}</span>
                      )}
                    </div>
                  </div>
                  <span style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: failed ? '#fee2e2' : passed ? '#dcfce7' : '#f1f5f9',
                    color: failed ? '#991b1b' : passed ? '#166534' : '#475569',
                  }}>
                    {failed ? 'False' : passed ? 'True' : String(current.value ?? '—')}
                  </span>
                </div>

                <div style={{ padding: '12px 14px' }}>
                  {score != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, typeof score === 'number' ? score : 0)}%`, height: '100%',
                          background: failed ? '#ef4444' : '#10b981', borderRadius: 3,
                        }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: failed ? '#ef4444' : '#10b981' }}>
                        {typeof score === 'number' ? score.toFixed(1) : score}
                      </span>
                    </div>
                  )}

                  {reasoning && (
                    <div style={{
                      background: '#f8fafc', borderRadius: 6, padding: '8px 10px',
                      border: '1px solid #e2e8f0', maxHeight: 200, overflowY: 'auto',
                    }}>
                      <MarkdownRenderer content={reasoning} size="xs" />
                    </div>
                  )}

                  {timestamp && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>
                      {(() => { try { return new Date(timestamp).toLocaleString() } catch { return timestamp } })()}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}

function AnnotationSidebar({ traceId, trace, onClose }) {
  const [scoreConfigs, setScoreConfigs] = useState([])
  const [scores, setScores] = useState({})
  const [existingScores, setExistingScores] = useState([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [datasets, setDatasets] = useState([])
  const [selectedDataset, setSelectedDataset] = useState('')
  const [showAddToDataset, setShowAddToDataset] = useState(false)
  const [addedToDataset, setAddedToDataset] = useState(false)

  useEffect(() => {
    Promise.all([
      getScoreConfigs({}).then(r => r.data?.configs || []),
      getTraceScores(traceId).then(r => r.data?.scores || []),
      getDatasets({}).then(r => r.data?.datasets || r.data || []),
    ]).then(([configs, existing, ds]) => {
      setScoreConfigs(configs)
      setExistingScores(existing)
      setDatasets(Array.isArray(ds) ? ds : [])
    }).catch(() => {})
  }, [traceId])

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      const numericConfig = scoreConfigs.find(c => c.data_type === 'numeric')
      const binaryConfig = scoreConfigs.find(c => c.data_type === 'binary')
      if (/^[1-5]$/.test(e.key) && numericConfig) {
        setScores(prev => ({ ...prev, [numericConfig.config_id]: parseInt(e.key) }))
      }
      if (e.key === 'y' && binaryConfig) setScores(prev => ({ ...prev, [binaryConfig.config_id]: 'yes' }))
      if (e.key === 'n' && binaryConfig) setScores(prev => ({ ...prev, [binaryConfig.config_id]: 'no' }))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [scoreConfigs])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const scoreEntries = Object.entries(scores).map(([configId, value]) => ({
        config_id: configId,
        value,
        source: 'human',
        comment,
      }))
      if (scoreEntries.length > 0) {
        await addTraceScores(traceId, { scores: scoreEntries })
      }
      setSubmitted(true)
      const updated = await getTraceScores(traceId)
      setExistingScores(updated.data?.scores || [])
    } catch (e) { console.error(e) }
    setSubmitting(false)
  }

  const handleAddToDataset = async () => {
    if (!selectedDataset) return
    try {
      const spans = trace?.spans || []
      let finalInput = '', finalOutput = ''
      for (const s of spans) {
        if (['agent', 'chain'].includes(s.kind) && s.inputs) {
          finalInput = typeof s.inputs === 'string' ? s.inputs : JSON.stringify(s.inputs)
          break
        }
      }
      for (const s of [...spans].reverse()) {
        if (['agent', 'chain'].includes(s.kind) && s.outputs) {
          finalOutput = typeof s.outputs === 'string' ? s.outputs : JSON.stringify(s.outputs)
          break
        }
      }
      await addDatasetItems(selectedDataset, [{ input: finalInput, expected_output: finalOutput, trace_id: traceId, tags: ['from-annotation'], metadata: { annotated_scores: scores } }])
      setAddedToDataset(true)
    } catch (e) { console.error(e) }
  }

  return (
    <div style={{ width: 340, borderLeft: '1px solid #e2e8f0', background: '#f8fafc', padding: 20, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ClipboardCheck size={16} color="#6d28d9" />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Annotate</span>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={16} /></button>
      </div>

      {existingScores.length > 0 && (
        <div style={{ marginBottom: 16, padding: 10, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>EXISTING SCORES</div>
          {existingScores.slice(0, 5).map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', padding: '2px 0' }}>
              <span>{s.config_id || s.key || 'score'}</span>
              <span style={{ fontWeight: 600 }}>{String(s.value)}</span>
            </div>
          ))}
        </div>
      )}

      {scoreConfigs.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>
          No score configs defined yet. Create them in Score Configs page.
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          {scoreConfigs.map(config => (
            <div key={config.config_id} style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                {config.name}
                <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 4 }}>({config.data_type})</span>
              </label>
              {config.data_type === 'numeric' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min={config.min_value || 0} max={config.max_value || 5} step={1}
                    value={scores[config.config_id] ?? config.min_value ?? 0}
                    onChange={e => setScores(prev => ({ ...prev, [config.config_id]: Number(e.target.value) }))}
                    style={{ flex: 1 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#6d28d9', minWidth: 20, textAlign: 'center' }}>
                    {scores[config.config_id] ?? '-'}
                  </span>
                </div>
              )}
              {config.data_type === 'categorical' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(config.categories || []).map(cat => (
                    <button key={cat.label || cat} onClick={() => setScores(prev => ({ ...prev, [config.config_id]: cat.label || cat }))}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid', borderColor: scores[config.config_id] === (cat.label || cat) ? '#6d28d9' : '#e2e8f0', background: scores[config.config_id] === (cat.label || cat) ? '#6d28d920' : '#fff', color: scores[config.config_id] === (cat.label || cat) ? '#6d28d9' : '#64748b' }}>
                      {cat.label || cat}
                    </button>
                  ))}
                </div>
              )}
              {config.data_type === 'binary' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  {['yes', 'no'].map(val => (
                    <button key={val} onClick={() => setScores(prev => ({ ...prev, [config.config_id]: val }))}
                      style={{ flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', borderColor: scores[config.config_id] === val ? (val === 'yes' ? '#10b981' : '#ef4444') : '#e2e8f0', background: scores[config.config_id] === val ? (val === 'yes' ? '#10b98115' : '#ef444415') : '#fff', color: scores[config.config_id] === val ? (val === 'yes' ? '#10b981' : '#ef4444') : '#64748b' }}>
                      {val === 'yes' ? 'Yes (Y)' : 'No (N)'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Comment (optional)..." rows={2}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />

      <button onClick={handleSubmit} disabled={submitting || Object.keys(scores).length === 0}
        style={{ width: '100%', padding: '10px 0', background: submitted ? '#10b981' : (Object.keys(scores).length === 0 ? '#e2e8f0' : '#6d28d9'), color: submitted ? '#fff' : (Object.keys(scores).length === 0 ? '#94a3b8' : '#fff'), border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: Object.keys(scores).length === 0 ? 'not-allowed' : 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {submitted ? <><CheckCircle size={14} /> Submitted</> : submitting ? 'Submitting...' : 'Submit Scores'}
      </button>

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
        <button onClick={() => setShowAddToDataset(!showAddToDataset)}
          style={{ width: '100%', padding: '8px 0', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Database size={13} /> Add to Dataset
        </button>
        {showAddToDataset && (
          <div style={{ marginTop: 8 }}>
            <select value={selectedDataset} onChange={e => setSelectedDataset(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 6, outline: 'none' }}>
              <option value="">Select dataset...</option>
              {datasets.map(d => <option key={d.dataset_id} value={d.dataset_id}>{d.name}</option>)}
            </select>
            <button onClick={handleAddToDataset} disabled={!selectedDataset || addedToDataset}
              style={{ width: '100%', padding: '7px 0', background: addedToDataset ? '#10b981' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: selectedDataset ? 'pointer' : 'not-allowed' }}>
              {addedToDataset ? 'Added!' : 'Add Trace to Dataset'}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, padding: 8, background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>KEYBOARD SHORTCUTS</div>
        <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.8 }}>
          <div><kbd style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>1-5</kbd> Numeric score</div>
          <div><kbd style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>Y</kbd>/<kbd style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: 9 }}>N</kbd> Binary score</div>
        </div>
      </div>
    </div>
  )
}

export default function TraceDetailPage() {
  const { traceId } = useParams()
  const [trace, setTrace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAssistant, setShowAssistant] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewCount, setReviewCount] = useState(0)
  const [showAnnotation, setShowAnnotation] = useState(false)
  const [showAssessments, setShowAssessments] = useState(false)
  const [assessmentCount, setAssessmentCount] = useState(0)

  useEffect(() => {
    setError(null)
    setLoading(true)
    getTrace(traceId)
      .then((r) => {
        const data = r?.data ?? r
        if (data?.error) { setTrace(null); setError(data.error) }
        else { setTrace(data) }
      })
      .catch((err) => {
        setTrace(null)
        setError(err?.message || err?.response?.data?.detail || 'Failed to fetch trace')
      })
      .finally(() => setLoading(false))
    listTraceReviews(traceId)
      .then(r => setReviewCount((r.data?.reviews || []).length))
      .catch(() => {})
    getTraceAssessments(traceId)
      .then(r => {
        const data = r.data?.assessments || r.data?.feedback || r.data || []
        const count = Array.isArray(data) ? data.length : 0
        setAssessmentCount(count)
        if (count > 0) setShowAssessments(true)
      })
      .catch(() => {})
  }, [traceId])

  if (loading) return <SkeletonPage />

  if (!trace || trace.error) {
    return (
      <div className="animate-fade-in">
        <Link to="/" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-medium mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to traces
        </Link>
        <div className="card border-red-200 bg-red-50/50 p-6">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-red-500 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-800">Trace not found</h3>
              {(error || trace?.error) && <p className="mt-1 text-sm text-red-600">{error || trace?.error}</p>}
              <p className="mt-2 text-xs text-red-500">Trace ID: <code className="bg-red-100 px-1.5 py-0.5 rounded font-mono">{traceId ?? 'unknown'}</code></p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const spans = trace?.spans ?? []
  const flatSpansFromApi = trace?.flat_spans ?? []
  const allStarts = spans.flatMap((s) => { const collect = (sp) => [sp.start_time_ns, ...(sp.children || []).flatMap(collect)].filter(Boolean); return collect(s) })
  const allEnds = spans.flatMap((s) => { const collect = (sp) => [sp.end_time_ns, ...(sp.children || []).flatMap(collect)].filter(Boolean); return collect(s) })
  const traceStart = trace.start_time_ns ?? (allStarts.length ? Math.min(...allStarts) : 0)
  const traceEnd = trace.end_time_ns ?? (allEnds.length ? Math.max(...allEnds) : traceStart + 1)
  const traceDuration = Math.max((traceEnd - traceStart) / 1e6, 0.1)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Trace ${traceId.slice(0, 12)}...`}
        icon={Activity}
        breadcrumbs={[
          { label: 'Traces', to: '/' },
          { label: traceId.slice(0, 16) + '...' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAssessments(!showAssessments)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showAssessments ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'}`}
            >
              <Award size={13} />
              Assessments
              {assessmentCount > 0 && (
                <span className="bg-blue-200 text-blue-800 text-2xs font-bold px-1.5 py-0.5 rounded-full">
                  {assessmentCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowAnnotation(!showAnnotation)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showAnnotation ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'}`}
            >
              <ClipboardCheck size={13} />
              Annotate
            </button>
            <button
              onClick={() => setShowReviewModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition-colors"
            >
              <Share2 size={13} />
              Send for Review
              {reviewCount > 0 && (
                <span className="bg-purple-200 text-purple-800 text-2xs font-bold px-1.5 py-0.5 rounded-full">
                  {reviewCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowAssistant(!showAssistant)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${showAssistant ? 'bg-violet-100 text-violet-700 border border-violet-300' : 'bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200'}`}
            >
              <Sparkles size={13} />
              Debug with AI
            </button>
            <StatusBadge status={trace.status} />
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Duration" value={formatLatency(traceDuration, 1).display} tooltip={`${traceDuration.toLocaleString()} ms`} icon={Clock} color="text-amber-600" />
        <StatCard label="Total Tokens" value={formatNumber(trace.total_tokens ?? 0).display} tooltip={formatNumber(trace.total_tokens ?? 0).full} icon={Cpu} color="text-blue-600" />
        <StatCard label="Cost" value={trace.total_cost_usd != null ? formatCost(trace.total_cost_usd).display : '-'} tooltip={trace.total_cost_usd != null ? formatCost(trace.total_cost_usd).full : undefined} icon={DollarSign} color="text-emerald-600" />
        <StatCard label="Spans" value={flatSpansFromApi.length || spans.length} icon={Layers} color="text-violet-600" />
      </div>

      <div className="card p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 text-sm">
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Trace ID</span>
            <div className="font-mono text-xs text-slate-700 mt-0.5 break-all">{trace.trace_id}</div>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Created At</span>
            <div className="mt-0.5">
              {trace.created_at ? (
                <div className="flex items-center gap-1">
                  <Calendar size={12} className="text-slate-400" />
                  <span className="text-xs text-slate-700 font-medium">
                    {(() => {
                      try {
                        const d = new Date(trace.created_at)
                        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
                          ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                      } catch { return trace.created_at }
                    })()}
                  </span>
                </div>
              ) : <span className="text-slate-400">-</span>}
            </div>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Service</span>
            <div className="mt-0.5"><span className="badge-neutral">{trace.service_name || '-'}</span></div>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Product</span>
            <div className="font-medium text-slate-700 mt-0.5">{trace.product_id || '-'}</div>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Environment</span>
            <div className="font-medium text-slate-700 mt-0.5">{trace.environment || '-'}</div>
          </div>
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Session</span>
            <div className="mt-0.5">
              {trace.session_id ? (
                <Link to={`/sessions/${trace.session_id}`} className="text-brand-600 hover:text-brand-700 font-mono text-xs transition-colors">{(trace.session_id || '').length > 20 ? (trace.session_id || '').slice(0, 20) + '...' : trace.session_id}</Link>
              ) : '-'}
            </div>
          </div>
        </div>
      </div>

      <div className={`flex gap-0`} style={(showAssistant || showAnnotation || showAssessments) ? { height: 'calc(100vh - 300px)', minHeight: 500 } : {}}>
        <div className="flex-1 min-w-0 overflow-auto">
          <TraceContent trace={trace} traceId={traceId} />
        </div>
        {showAssessments && (
          <AssessmentsSidebar traceId={traceId} onClose={() => setShowAssessments(false)} />
        )}
        {showAssistant && (
          <TraceAssistant traceId={traceId} isOpen={showAssistant} onClose={() => setShowAssistant(false)} />
        )}
        {showAnnotation && (
          <AnnotationSidebar traceId={traceId} trace={trace} onClose={() => setShowAnnotation(false)} />
        )}
      </div>

      {showReviewModal && (
        <SendReviewModal
          traceId={traceId}
          onClose={() => {
            setShowReviewModal(false)
            listTraceReviews(traceId).then(r => setReviewCount((r.data?.reviews || []).length)).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
