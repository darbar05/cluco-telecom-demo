/**
 * Public SME Trace Review Page
 * Accessed via /trace-review/:token (no auth required)
 * Allows an SME to view a trace and submit comments / rating.
 */
import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getTraceReview, submitTraceReviewComment } from '../api'
import {
  Activity, Clock, Cpu, DollarSign, Layers, CheckCircle,
  XCircle, AlertTriangle, ThumbsUp, ThumbsDown, Wrench,
  ChevronDown, ChevronUp, Send, User, Calendar, Info,
} from 'lucide-react'
import ViewModeToggle from '../components/ui/ViewModeToggle'
import TechTooltip from '../components/ui/TechTooltip'
import TraceSummary from '../components/TraceSummary'

const RATING_OPTIONS = [
  { value: 'approve', label: 'Looks Good', icon: ThumbsUp, color: '#10b981', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'needs_work', label: 'Needs Work', icon: Wrench, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
  { value: 'flag', label: 'Flag Issue', icon: AlertTriangle, color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
]

function safeStr(val, fallback = '') {
  if (val == null) return fallback
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (val.message) return val.message
  if (val.content) return val.content
  try { return JSON.stringify(val) } catch { return fallback }
}

function SpanRow({ span, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = span.children && span.children.length > 0
  const kindColors = {
    llm: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    tool: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
    agent: { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' },
    chain: { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
  }
  const kindKey = typeof span.kind === 'string' ? span.kind : (span.kind?.type || '')
  const kc = kindColors[kindKey] || { bg: '#f8fafc', color: '#475569', border: '#e2e8f0' }
  const latency = span.latency_ms || span.duration_ms || 0
  const inp = span.inputs || span.input
  const out = span.outputs || span.output
  const spanStatus = safeStr(span.status)

  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 4 }}>
      <div
        onClick={() => setExpanded(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
          background: kc.bg, border: `1px solid ${kc.border}`, borderRadius: 8,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: kc.border, color: kc.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {safeStr(span.kind, 'span')}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', flex: 1 }}>{safeStr(span.name, '(unnamed)')}</span>
        {latency > 0 && <span style={{ fontSize: 10, color: '#94a3b8' }}>{latency.toFixed(0)}ms</span>}
        {spanStatus === 'error' && <AlertTriangle size={12} color="#ef4444" />}
        {(hasChildren || inp || out) && (
          expanded ? <ChevronUp size={13} color="#94a3b8" /> : <ChevronDown size={13} color="#94a3b8" />
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 4, paddingLeft: 8 }}>
          {(inp || out || span.error) && (
            <div style={{ display: 'grid', gap: 6, marginBottom: 6 }}>
              {span.error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#991b1b' }}>
                  <strong>Error:</strong> {safeStr(span.error)}
                </div>
              )}
              {inp && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2, textTransform: 'uppercase' }}>Input</div>
                  <pre style={{ margin: 0, fontSize: 11, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>
                    {typeof inp === 'string' ? inp : JSON.stringify(inp, null, 2)}
                  </pre>
                </div>
              )}
              {out && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginBottom: 2, textTransform: 'uppercase' }}>Output</div>
                  <pre style={{ margin: 0, fontSize: 11, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>
                    {typeof out === 'string' ? out : JSON.stringify(out, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          {hasChildren && span.children.map((child, i) => (
            <SpanRow key={i} span={child} depth={0} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TraceReviewPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Review form state
  const [reviewerName, setReviewerName] = useState('')
  const [reviewerEmail, setReviewerEmail] = useState('')
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [viewMode, setViewMode] = useState('simple')

  useEffect(() => {
    setLoading(true)
    getTraceReview(token)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || e.message || 'Failed to load review'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmit = async () => {
    if (!comment.trim()) { setSubmitError('Please add a comment before submitting'); return }
    if (!rating) { setSubmitError('Please select a rating'); return }
    setSubmitting(true); setSubmitError(null)
    try {
      await submitTraceReviewComment(token, {
        reviewer_name: reviewerName || 'Anonymous',
        reviewer_email: reviewerEmail,
        comment,
        rating,
      })
      setSubmitted(true)
      // Reload to show new comment
      const r = await getTraceReview(token)
      setData(r.data)
    } catch (e) {
      setSubmitError(e.response?.data?.detail || e.message || 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTop: '3px solid #6d28d9', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading trace review…</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 32, maxWidth: 440, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <XCircle size={40} color="#ef4444" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Unable to Load Review</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>{error}</p>
      </div>
    </div>
  )

  const trace = data?.trace || {}
  const spans = trace.spans || []
  const comments = data?.comments || []
  const ratingMap = { approve: RATING_OPTIONS[0], needs_work: RATING_OPTIONS[1], flag: RATING_OPTIONS[2] }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%)', padding: '20px 32px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <Activity size={20} color="white" />
              <span style={{ color: 'white', fontWeight: 700, fontSize: 18 }}>Trace Review</span>
              <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                Powered by Cluco Observability
              </span>
            </div>
            {viewMode === 'advanced' && (
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'monospace' }}>
                Trace: {trace.trace_id || '—'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ViewModeToggle onChange={setViewMode} defaultMode="simple" />
            {viewMode === 'advanced' && [
              { label: 'Service', value: safeStr(trace.service_name, '—') },
              { label: 'Status', value: safeStr(trace.status, '—') },
              { label: 'Tokens', value: (trace.total_tokens || 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: 15 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Onboarding banner for simple mode */}
      {viewMode === 'simple' && (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 32px 0' }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Info size={15} color="#2563eb" />
            <span style={{ fontSize: 12, color: '#1e40af' }}>
              <strong>Review Guide:</strong> Read the user's request and the agent's response below, then rate whether the response was helpful and accurate. Use the form on the right to submit your review.
            </span>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' }}>

        {/* LEFT: Trace info */}
        <div>
          {/* Sender note */}
          {data?.note && (
            <div style={{ display: 'flex', gap: 10, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
              <Info size={16} color="#0369a1" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginBottom: 2 }}>NOTE FROM SENDER</div>
                <div style={{ fontSize: 13, color: '#0c4a6e' }}>{data.note}</div>
              </div>
            </div>
          )}

          {/* SIMPLE MODE: conversation + summary + evaluation badges */}
          {viewMode === 'simple' && (
            <>
              <TraceSummary trace={trace} traceId={trace.trace_id} />
              {(trace.feedback || []).length > 0 && (
                <div style={{
                  marginTop: 16, background: '#fff', borderRadius: 12,
                  border: '1px solid #e2e8f0', padding: 16, overflow: 'hidden',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle size={13} color="#6d28d9" /> Quality Checks
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {trace.feedback.map((fb, i) => {
                      const passed = fb.value === 'True' || (fb.score != null && fb.score >= 0.5)
                      const name = fb.evaluator_name || fb.key || 'Check'
                      return (
                        <span key={i} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                          background: passed ? '#f0fdf4' : '#fef2f2',
                          color: passed ? '#166534' : '#991b1b',
                          border: `1px solid ${passed ? '#bbf7d0' : '#fecaca'}`,
                        }}>
                          {passed ? <CheckCircle size={12} /> : <XCircle size={12} />}
                          {name}: {passed ? 'Pass' : 'Fail'}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ADVANCED MODE: full technical details */}
          {viewMode === 'advanced' && (
            <>
              {/* Trace metadata */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0', marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                  {[
                    { label: 'Duration', value: trace.latency_ms ? `${trace.latency_ms.toFixed(0)}ms` : '—', icon: Clock, color: '#f59e0b', term: 'latency' },
                    { label: 'Tokens', value: (trace.total_tokens || 0).toLocaleString(), icon: Cpu, color: '#3b82f6', term: 'tokens' },
                    { label: 'Cost', value: trace.total_cost_usd != null ? `$${trace.total_cost_usd.toFixed(4)}` : '—', icon: DollarSign, color: '#10b981', term: 'cost' },
                    { label: 'Spans', value: (trace.flat_spans || spans).length, icon: Layers, color: '#6d28d9', term: 'spans' },
                    { label: 'Created', value: trace.created_at ? trace.created_at.slice(0, 10) : '—', icon: Calendar, color: '#64748b' },
                  ].map(({ label, value, icon: Icon, color, term }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={14} color={color} />
                      <div>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}>
                          {term ? <TechTooltip term={term}>{label}</TechTooltip> : label}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Span tree */}
              <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={14} color="#6d28d9" /> Execution Trace
                </h3>
                {spans.length > 0 ? (
                  <div style={{ display: 'grid', gap: 4 }}>
                    {spans.map((span, i) => <SpanRow key={i} span={span} depth={0} />)}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
                    No span details available for this trace.
                  </div>
                )}
              </div>

              {/* Existing feedback/assessments */}
              {(trace.feedback || []).length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: 18, border: '1px solid #e2e8f0', marginTop: 16 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Automated Assessments</h3>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {trace.feedback.map((fb, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
                        <span style={{ color: '#64748b', fontWeight: 500 }}>{safeStr(fb.key)}</span>
                        <span style={{ fontWeight: 700, color: fb.value === 'True' || fb.score >= 60 ? '#10b981' : '#ef4444' }}>
                          {safeStr(fb.value ?? fb.score)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT: Review form + existing comments */}
        <div style={{ position: 'sticky', top: 24 }}>

          {/* Submit form */}
          {!submitted ? (
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0', marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Send size={14} color="#6d28d9" /> Submit Your Review
              </h3>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Your Name</label>
                <input
                  value={reviewerName}
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder="John Smith"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Your Email <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
                <input
                  type="email"
                  value={reviewerEmail}
                  onChange={e => setReviewerEmail(e.target.value)}
                  placeholder="you@company.com"
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Rating</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {RATING_OPTIONS.map(opt => {
                    const selected = rating === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setRating(opt.value)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                          padding: '8px 4px', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
                          border: `2px solid ${selected ? opt.color : '#e2e8f0'}`,
                          background: selected ? opt.bg : '#fafafa',
                        }}
                      >
                        <opt.icon size={14} color={opt.color} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: selected ? opt.color : '#64748b' }}>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Comments</label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Describe what you observed, any issues found, or suggestions for improvement…"
                  rows={5}
                  style={{
                    width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e2e8f0',
                    fontSize: 12, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5,
                  }}
                />
              </div>

              {submitError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '7px 10px', marginBottom: 10, fontSize: 11, color: '#991b1b' }}>
                  {submitError}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  width: '100%', padding: '10px 0', background: submitting ? '#a78bfa' : '#6d28d9',
                  color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13,
                  cursor: submitting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Send size={14} />
                {submitting ? 'Submitting…' : 'Submit Review'}
              </button>
            </div>
          ) : (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center' }}>
              <CheckCircle size={32} color="#10b981" style={{ margin: '0 auto 10px' }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: '#166534', marginBottom: 4 }}>Review Submitted!</div>
              <div style={{ fontSize: 12, color: '#047857' }}>Thank you for your feedback. Your review has been recorded.</div>
            </div>
          )}

          {/* Existing comments */}
          {comments.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                Reviews ({comments.length})
              </h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {comments.map((c, i) => {
                  const rOpt = ratingMap[c.rating]
                  return (
                    <div key={i} style={{ background: '#fafafa', border: '1px solid #f1f5f9', borderRadius: 8, padding: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <User size={12} color="#64748b" />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{c.reviewer_name || 'Anonymous'}</span>
                        </div>
                        {rOpt && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                            background: rOpt.bg, color: rOpt.color, border: `1px solid ${rOpt.border}`,
                          }}>
                            {rOpt.label}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 4 }}>{c.comment}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{c.submitted_at ? c.submitted_at.slice(0, 10) : ''}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
