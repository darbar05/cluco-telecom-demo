import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { getLabelingSession, getLabelingSessionTraces, submitLabelingReview, shareLabelingSession, getTraces } from '../api'
import ViewModeToggle from '../components/ui/ViewModeToggle'
import TraceSummary from '../components/TraceSummary'
import MarkdownRenderer from '../components/MarkdownRenderer'

export default function LabelingReviewPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isPublic = location.pathname.startsWith('/labeling-review/')
  const [session, setSession] = useState(null)
  const [traces, setTraces] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [correctness, setCorrectness] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showShare, setShowShare] = useState(false)
  const [shareEmail, setShareEmail] = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [allDone, setAllDone] = useState(false)
  const [sessionTracesMap, setSessionTracesMap] = useState({})
  const [showConversationContext, setShowConversationContext] = useState(true)

  const currentTrace = useMemo(() => traces[currentIdx] ?? null, [traces, currentIdx])

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [sessRes, trRes] = await Promise.all([
          getLabelingSession(sessionId),
          getLabelingSessionTraces(sessionId),
        ])
        setSession(sessRes.data)
        setTraces(trRes.data.traces || [])
      } catch { /* ignore */ }
      setLoading(false)
    }
    fetchData()
  }, [sessionId])

  useEffect(() => {
    if (!currentTrace?.session_id || sessionTracesMap[currentTrace.session_id]) return
    getTraces({ session_id: currentTrace.session_id, limit: 50 })
      .then(res => {
        const st = res.data?.traces || []
        if (st.length > 1) {
          setSessionTracesMap(prev => ({ ...prev, [currentTrace.session_id]: st }))
        }
      })
      .catch(() => {})
  }, [currentTrace?.session_id])

  const conversationTraces = useMemo(() => {
    if (!currentTrace?.session_id) return []
    return sessionTracesMap[currentTrace.session_id] || []
  }, [currentTrace?.session_id, sessionTracesMap])

  useEffect(() => {
    if (currentTrace?.review) {
      setCorrectness(currentTrace.review.correctness || '')
      setComment(currentTrace.review.comment || '')
    } else {
      setCorrectness('')
      setComment('')
    }
  }, [currentIdx, currentTrace])

  const handleSave = async () => {
    if (!currentTrace) return
    setSaving(true)
    try {
      await submitLabelingReview(sessionId, currentTrace.trace_id, {
        correctness: correctness || null,
        comment: comment || null,
      })
      const updated = [...traces]
      updated[currentIdx] = { ...updated[currentIdx], reviewed: true, review: { correctness, comment } }
      setTraces(updated)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleSaveAndNext = async () => {
    if (!currentTrace) return
    setSaving(true)
    try {
      await submitLabelingReview(sessionId, currentTrace.trace_id, {
        correctness: correctness || null,
        comment: comment || null,
      })
      const updated = [...traces]
      updated[currentIdx] = { ...updated[currentIdx], reviewed: true, review: { correctness, comment } }
      setTraces(updated)

      const nextUnreviewed = updated.findIndex((t, i) => i > currentIdx && !t.reviewed)
      if (nextUnreviewed >= 0) {
        setCurrentIdx(nextUnreviewed)
      } else if (currentIdx < updated.length - 1) {
        setCurrentIdx(currentIdx + 1)
      } else {
        const allReviewed = updated.every(t => t.reviewed)
        if (allReviewed) setAllDone(true)
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleClear = () => {
    setCorrectness('')
    setComment('')
  }

  const goNext = () => { if (currentIdx < traces.length - 1) setCurrentIdx(currentIdx + 1) }
  const goPrev = () => { if (currentIdx > 0) setCurrentIdx(currentIdx - 1) }
  const goNextUnreviewed = () => {
    const idx = traces.findIndex((t, i) => i > currentIdx && !t.reviewed)
    if (idx >= 0) setCurrentIdx(idx)
  }

  const handleShare = async () => {
    if (!shareEmail.trim()) return
    try {
      await shareLabelingSession(sessionId, [shareEmail.trim()])
      setShareMsg(`Shared with ${shareEmail}`)
      setShareEmail('')
      setTimeout(() => setShareMsg(''), 3000)
    } catch { setShareMsg('Failed to share') }
  }

  const [viewMode, setViewMode] = useState('simple')
  const reviewedCount = traces.filter(t => t.reviewed).length
  const progress = traces.length ? Math.round(reviewedCount / traces.length * 100) : 0

  const renderMessage = (content) => {
    if (!content) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No content</span>
    if (typeof content === 'string') return <MarkdownRenderer content={content} size="sm" className="text-slate-700" />
    if (Array.isArray(content)) {
      return content.map((msg, i) => (
        <div key={i} style={{
          marginBottom: 12,
          ...(msg.role !== 'user' && msg.role !== 'human' ? { paddingLeft: 14, borderLeft: '2px solid #c4b5fd' } : {}),
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 3, textTransform: 'uppercase' }}>{msg.role || 'system'}</div>
          <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
          </div>
        </div>
      ))
    }
    return <pre style={{ fontSize: 11, color: '#475569', overflowX: 'auto', margin: 0 }}>{JSON.stringify(content, null, 2)}</pre>
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTop: '3px solid #6d28d9', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading review session...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )

  if (!session) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 32, maxWidth: 440, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>Session Not Found</div>
        <p style={{ color: '#64748b', fontSize: 14 }}>This labeling session could not be loaded. It may have been deleted or the link may be invalid.</p>
      </div>
    </div>
  )

  if (allDone) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 40, maxWidth: 480, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#166534', marginBottom: 8 }}>All Reviews Complete!</div>
        <p style={{ color: '#047857', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          You have reviewed all {traces.length} trace{traces.length !== 1 ? 's' : ''} in "{session.name}". Thank you for your feedback!
        </p>
        <button onClick={() => setAllDone(false)} style={{
          padding: '10px 20px', background: '#6d28d9', color: '#fff', border: 'none', borderRadius: 8,
          fontWeight: 600, fontSize: 14, cursor: 'pointer',
        }}>Review Again</button>
      </div>
    </div>
  )

  const s = {
    page: { minHeight: '100vh', background: '#f8fafc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    header: { background: 'linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%)', padding: '18px 32px' },
    headerInner: { maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { color: 'white', fontWeight: 700, fontSize: 18, margin: 0 },
    headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 },
    headerStat: { textAlign: 'center', marginLeft: 24 },
    headerStatLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' },
    headerStatVal: { color: 'white', fontWeight: 700, fontSize: 15 },
    body: { maxWidth: 1200, margin: '0 auto', padding: '20px 32px' },
    card: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 },
    btn: { padding: '7px 14px', fontSize: 12, borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 500, color: '#475569' },
    btnDisabled: { opacity: 0.3, cursor: 'default' },
    btnPrimary: { padding: '8px 18px', fontSize: 13, borderRadius: 8, border: 'none', background: '#6d28d9', color: '#fff', cursor: 'pointer', fontWeight: 600 },
    btnGreen: { padding: '8px 18px', fontSize: 13, borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 600 },
    progressBar: { width: '100%', height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' },
    progressFill: { height: '100%', background: '#6d28d9', borderRadius: 3, transition: 'width 0.3s' },
  }

  return (
    <div style={s.page}>
      {/* Header */}
      {isPublic && (
        <div style={s.header}>
          <div style={s.headerInner}>
            <div>
              <h1 style={s.headerTitle}>{session.name}</h1>
              <div style={s.headerSub}>
                {session.description || 'Labeling Review Session'} &middot; Powered by Cluco Observability
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              {[
                { label: 'Traces', value: traces.length },
                { label: 'Reviewed', value: `${reviewedCount}/${traces.length}` },
                { label: 'Progress', value: `${progress}%` },
              ].map(({ label, value }) => (
                <div key={label} style={s.headerStat}>
                  <div style={s.headerStatLabel}>{label}</div>
                  <div style={s.headerStatVal}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={isPublic ? s.body : { padding: 0 }}>
        {/* Title bar (in-app only, public has header) */}
        {!isPublic && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', margin: 0 }}>{session.name}</h1>
              {session.description && <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{session.description}</p>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Reviewed {progress}%</span>
              <button onClick={() => setShowShare(!showShare)} style={s.btnPrimary}>Share</button>
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div style={{ ...s.progressBar, marginBottom: 16 }}>
          <div style={{ ...s.progressFill, width: `${progress}%` }} />
        </div>

        {/* Share panel */}
        {(showShare || (isPublic && false)) && (
          <div style={{ ...s.card, marginBottom: 16, background: '#faf5ff', borderColor: '#e9d5ff' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>Share with reviewers</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={shareEmail}
                onChange={e => setShareEmail(e.target.value)}
                placeholder="reviewer@example.com"
                style={{ flex: 1, padding: '7px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, outline: 'none' }}
              />
              <button onClick={handleShare} style={s.btnPrimary}>Add Reviewer</button>
            </div>
            {shareMsg && <div style={{ fontSize: 12, color: '#059669', marginTop: 8 }}>{shareMsg}</div>}
            {session.reviewer_emails?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {session.reviewer_emails.map(e => (
                  <span key={e} style={{ padding: '2px 8px', background: '#e2e8f0', borderRadius: 4, fontSize: 11, color: '#475569' }}>{e}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        {traces.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', fontSize: 14 }}>
            No traces in this session.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={goPrev} disabled={currentIdx === 0} style={{ ...s.btn, ...(currentIdx === 0 ? s.btnDisabled : {}) }}>&larr; Prev</button>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
                Trace {currentIdx + 1} of {traces.length}
              </span>
              <button onClick={goNext} disabled={currentIdx >= traces.length - 1} style={{ ...s.btn, ...(currentIdx >= traces.length - 1 ? s.btnDisabled : {}) }}>Next &rarr;</button>
              <button onClick={goNextUnreviewed} style={{ ...s.btn, borderColor: '#c4b5fd', color: '#7c3aed' }}>Next unreviewed</button>
              {currentTrace?.reviewed && (
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#166534' }}>Reviewed</span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <ViewModeToggle onChange={setViewMode} defaultMode="simple" />
              </div>
            </div>

            {/* Simple mode helper text */}
            {viewMode === 'simple' && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                <span style={{ fontSize: 12, color: '#1e40af' }}>
                  <strong>Review Guide:</strong> Read the user's request and the agent's response below. Judge whether the response correctly and helpfully addresses the user's question.
                </span>
              </div>
            )}

            {/* Conversation Context Panel (multi-turn) */}
            {conversationTraces.length > 1 && currentTrace && (
              <div style={{ ...s.card, marginBottom: 16, background: '#faf5ff', borderColor: '#e9d5ff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showConversationContext ? 12 : 0 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#6d28d9', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Conversation Context ({conversationTraces.length} turns)
                  </h3>
                  <button
                    onClick={() => setShowConversationContext(!showConversationContext)}
                    style={{ ...s.btn, fontSize: 11, padding: '4px 10px', borderColor: '#d8b4fe', color: '#7c3aed' }}
                  >
                    {showConversationContext ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {showConversationContext && (
                  <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 8 }}>
                    {conversationTraces.map((st, idx) => {
                      const isCurrentTurn = (st.trace_id || st._id) === currentTrace.trace_id
                      const req = st.request_preview || st.request || ''
                      const resp = st.response_preview || st.response || ''
                      return (
                        <div key={idx} style={{
                          padding: '10px 14px', borderRadius: 8,
                          border: isCurrentTurn ? '2px solid #7c3aed' : '1px solid #e9d5ff',
                          background: isCurrentTurn ? '#f5f3ff' : '#fefcff',
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: isCurrentTurn ? '#7c3aed' : '#94a3b8', marginBottom: 4 }}>
                            Turn {idx + 1}{isCurrentTurn ? ' (current)' : ''}
                          </div>
                          <div style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
                            <span style={{ fontWeight: 600, color: '#2563eb' }}>User: </span>
                            {(typeof req === 'string' ? req : JSON.stringify(req)).slice(0, 120)}
                          </div>
                          <div style={{ fontSize: 12, color: '#374151' }}>
                            <span style={{ fontWeight: 600, color: '#059669' }}>Agent: </span>
                            {(typeof resp === 'string' ? resp : JSON.stringify(resp)).slice(0, 120)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Main content */}
            {currentTrace && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
                {/* Left: Conversation */}
                <div style={s.card}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>
                    {viewMode === 'simple' ? 'Interaction' : 'Conversation'}
                  </h3>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {viewMode === 'simple' ? 'User Input' : 'User Request'}
                    </div>
                    <div style={{ background: '#eff6ff', borderRadius: 10, padding: 14, border: '1px solid #bfdbfe' }}>
                      {renderMessage(currentTrace.request)}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Agent Response</div>
                    <div style={{ background: '#f0fdf4', borderRadius: 10, padding: 14, border: '1px solid #bbf7d0' }}>
                      {renderMessage(currentTrace.response)}
                    </div>
                  </div>

                  {/* Evaluation badges in simple mode */}
                  {viewMode === 'simple' && currentTrace.feedback && currentTrace.feedback.length > 0 && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Quality Checks
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {currentTrace.feedback.map((fb, i) => {
                          const passed = fb.value === 'True' || (fb.score != null && fb.score >= 0.5)
                          const name = fb.evaluator_name || fb.key || 'Check'
                          return (
                            <span key={i} style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '4px 10px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                              background: passed ? '#f0fdf4' : '#fef2f2',
                              color: passed ? '#166534' : '#991b1b',
                              border: `1px solid ${passed ? '#bbf7d0' : '#fecaca'}`,
                            }}>
                              {passed ? '✓' : '✗'} {name}: {passed ? 'Pass' : 'Fail'}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {viewMode === 'advanced' && (
                    <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
                      Trace ID: <span style={{ fontFamily: 'monospace' }}>{currentTrace.trace_id}</span>
                    </div>
                  )}
                </div>

                {/* Right: Feedback form */}
                <div style={{ ...s.card, position: 'sticky', top: 24 }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Feedback</h3>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                      Did the agent correctly handle the user's query?
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => setCorrectness('yes')}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          background: correctness === 'yes' ? '#dcfce7' : '#fff',
                          color: correctness === 'yes' ? '#166534' : '#64748b',
                          border: correctness === 'yes' ? '2px solid #4ade80' : '1px solid #e2e8f0',
                        }}
                      >Yes</button>
                      <button
                        onClick={() => setCorrectness('no')}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                          background: correctness === 'no' ? '#fef2f2' : '#fff',
                          color: correctness === 'no' ? '#991b1b' : '#64748b',
                          border: correctness === 'no' ? '2px solid #f87171' : '1px solid #e2e8f0',
                        }}
                      >No</button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Comment</label>
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Provide additional context about this trace..."
                      rows={4}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
                        fontSize: 13, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.5, outline: 'none',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handleClear} style={{ ...s.btn, flex: 1 }}>Clear</button>
                    <button onClick={handleSave} disabled={saving} style={{ ...s.btn, flex: 1, background: '#f1f5f9', fontWeight: 600, border: '1px solid #cbd5e1' }}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={handleSaveAndNext} disabled={saving || (!correctness && !comment)} style={{
                      ...s.btnGreen, flex: 2,
                      opacity: saving || (!correctness && !comment) ? 0.5 : 1,
                      cursor: saving || (!correctness && !comment) ? 'not-allowed' : 'pointer',
                    }}>
                      {saving ? 'Saving...' : currentIdx >= traces.length - 1 ? 'Save & Finish' : 'Save & Next'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
