import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  getAnnotationQueue,
  annotateQueueItem,
  approveQueueItems,
  getTrace,
  getScoreConfigs,
} from '../api'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  SkipForward,
  ClipboardCheck,
  CheckCircle2,
  Keyboard,
  ArrowLeft,
  AlertCircle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

function tryFormatJson(str) {
  if (!str) return ''
  const s = typeof str === 'string' ? str.trim() : JSON.stringify(str)
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {}
  }
  return s
}

function TraceViewer({ trace, traceId, loading, fallbackItem }) {
  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        Loading trace...
      </div>
    )
  }
  const effectiveTrace = trace || (fallbackItem && {
    input: fallbackItem.input,
    output: fallbackItem.actual_output,
    inputs: fallbackItem.input,
    outputs: fallbackItem.actual_output,
  })
  if (!effectiveTrace) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        Trace not found
      </div>
    )
  }

  const spans = effectiveTrace?.spans ?? []
  const flatSpans = effectiveTrace?.flat_spans ?? spans

  const renderContent = (content) => {
    if (!content) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No content</span>
    if (typeof content === 'string') {
      return (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 12,
            color: '#334155',
            lineHeight: 1.6,
            margin: 0,
            fontFamily: 'inherit',
          }}
        >
          {tryFormatJson(content)}
        </pre>
      )
    }
    if (Array.isArray(content)) {
      return content.map((msg, i) => (
        <div
          key={i}
          style={{
            marginBottom: 12,
            padding: 10,
            background: msg.role === 'user' || msg.role === 'human' ? '#eff6ff' : '#f0fdf4',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>
            {msg.role || 'system'}
          </div>
          <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
          </div>
        </div>
      ))
    }
    return (
      <pre style={{ fontSize: 11, color: '#475569', overflowX: 'auto', margin: 0 }}>
        {JSON.stringify(content, null, 2)}
      </pre>
    )
  }

  const spanWithInput = spans.find((s) => s.inputs != null)
  const spanWithOutput = [...spans].reverse().find((s) => s.outputs != null)
  const firstInput = spanWithInput?.inputs ?? effectiveTrace?.inputs ?? effectiveTrace?.input
  const lastOutput = spanWithOutput?.outputs ?? effectiveTrace?.outputs ?? effectiveTrace?.output

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', marginBottom: 6, textTransform: 'uppercase' }}>
          Input
        </div>
        <div
          style={{
            background: '#eff6ff',
            borderRadius: 10,
            padding: 14,
            border: '1px solid #bfdbfe',
          }}
        >
          {renderContent(firstInput || effectiveTrace?.input || '')}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', marginBottom: 6, textTransform: 'uppercase' }}>
          Output
        </div>
        <div
          style={{
            background: '#f0fdf4',
            borderRadius: 10,
            padding: 14,
            border: '1px solid #bbf7d0',
          }}
        >
          {renderContent(lastOutput || trace?.output || '')}
        </div>
      </div>
      {flatSpans.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase' }}>
            Spans ({flatSpans.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flatSpans.slice(0, 10).map((span, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  background: '#f8fafc',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>
                  {span.name || span.kind || 'span'}
                </div>
                {span.inputs && (
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: '#64748b', fontSize: 10 }}>Input: </span>
                    {renderContent(span.inputs)}
                  </div>
                )}
                {span.outputs && (
                  <div>
                    <span style={{ color: '#64748b', fontSize: 10 }}>Output: </span>
                    {renderContent(span.outputs)}
                  </div>
                )}
              </div>
            ))}
            {flatSpans.length > 10 && (
              <div style={{ fontSize: 11, color: '#94a3b8' }}>+ {flatSpans.length - 10} more spans</div>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
        Trace ID: <span style={{ fontFamily: 'monospace' }}>{traceId}</span>
      </div>
    </div>
  )
}

function ScoreConfigWidget({ config, value, onChange }) {
  const dataType = config.data_type || 'numeric'

  if (dataType === 'numeric') {
    const min = config.min_value ?? 0
    const max = config.max_value ?? 10
    const numVal = value != null && value !== '' ? Number(value) : min
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          {config.name}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input
            type="range"
            min={min}
            max={max}
            value={numVal}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#6d28d9' }}
          />
          <input
            type="number"
            min={min}
            max={max}
            value={numVal}
            onChange={(e) => onChange(Number(e.target.value) || min)}
            style={{
              width: 56,
              padding: '6px 8px',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              fontSize: 13,
              textAlign: 'center',
            }}
          />
        </div>
      </div>
    )
  }

  if (dataType === 'categorical') {
    const categories = config.categories || [{ label: 'default' }]
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          {config.name}
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((cat) => {
            const label = cat.label || cat
            const isSelected = value === label
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(label)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid #6d28d9' : '1px solid #e2e8f0',
                  background: isSelected ? '#f5f3ff' : '#fff',
                  color: isSelected ? '#6d28d9' : '#64748b',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (dataType === 'binary') {
    const isYes = value === 'yes' || value === true
    const isNo = value === 'no' || value === false
    return (
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          {config.name}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => onChange('yes')}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: isYes ? '#dcfce7' : '#fff',
              color: isYes ? '#166534' : '#64748b',
              border: isYes ? '2px solid #4ade80' : '1px solid #e2e8f0',
            }}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange('no')}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: isNo ? '#fef2f2' : '#fff',
              color: isNo ? '#991b1b' : '#64748b',
              border: isNo ? '2px solid #f87171' : '1px solid #e2e8f0',
            }}
          >
            No
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default function AnnotationReviewPage() {
  const { queueId } = useParams()
  const [queue, setQueue] = useState(null)
  const [items, setItems] = useState([])
  const [scoreConfigs, setScoreConfigs] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [trace, setTrace] = useState(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [scores, setScores] = useState({})
  const [comment, setComment] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState(null)

  const loadQueue = useCallback(async () => {
    if (!queueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await getAnnotationQueue(queueId)
      const data = res?.data ?? res
      setQueue(data)
      const rawItems = data?.items ?? []
      setItems(
        rawItems.map((it) => ({
          ...it,
          reviewed: it.status === 'reviewed' || it.status === 'approved',
        }))
      )
      setCurrentIdx((prev) => Math.min(prev, Math.max(0, rawItems.length - 1)))
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load queue')
      setQueue(null)
      setItems([])
    }
    setLoading(false)
  }, [queueId])

  const loadScoreConfigs = useCallback(async () => {
    try {
      const res = await getScoreConfigs({ product_id: queue?.product_id || undefined })
      const configs = res?.data?.configs ?? res?.configs ?? []
      setScoreConfigs(configs)
    } catch {
      setScoreConfigs([])
    }
  }, [queue?.product_id])

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  useEffect(() => {
    if (queue) loadScoreConfigs()
  }, [queue, loadScoreConfigs])

  const currentItem = items[currentIdx]
  const traceId = currentItem?.trace_id

  useEffect(() => {
    if (!traceId) {
      setTrace(null)
      setTraceLoading(false)
      return
    }
    setTraceLoading(true)
    getTrace(traceId)
      .then((r) => {
        const data = r?.data ?? r
        setTrace(data?.error ? null : data)
      })
      .catch(() => setTrace(null))
      .finally(() => setTraceLoading(false))
  }, [traceId])

  useEffect(() => {
    if (currentItem?.annotations?.length) {
      const last = currentItem.annotations[currentItem.annotations.length - 1]
      const next = {}
      scoreConfigs.forEach((c) => {
        if (last.scores) {
          const s = last.scores.find((x) => x.config_id === c.config_id)
          if (s) next[c.config_id] = s.score != null ? s.score : s.value
        } else if (last[c.config_id] != null) {
          next[c.config_id] = last[c.config_id]
        }
      })
      setScores(next)
      setComment(last.comment || '')
    } else {
      setScores({})
      setComment('')
    }
  }, [currentIdx, currentItem, scoreConfigs])

  const queueConfigIds = queue?.score_config_ids ?? queue?.score_configs ?? []
  const configsToShow =
    queueConfigIds.length > 0
      ? scoreConfigs.filter((c) => queueConfigIds.includes(c.config_id))
      : scoreConfigs

  const firstNumericConfig = configsToShow.find((c) => (c.data_type || 'numeric') === 'numeric')
  const firstBinaryConfig = configsToShow.find((c) => (c.data_type || '') === 'binary')

  const goPrev = useCallback(() => {
    setCurrentIdx((prev) => (prev > 0 ? prev - 1 : prev))
  }, [])
  const goNext = useCallback(() => {
    setCurrentIdx((prev) => (prev < items.length - 1 ? prev + 1 : prev))
  }, [items.length])

  const handleSubmitAndNext = useCallback(async () => {
    if (!currentItem || saving) return
    setSaving(true)
    try {
      const payload = {
        scores: configsToShow.map((c) => ({
          config_id: c.config_id,
          ...(c.data_type === 'numeric'
            ? { score: scores[c.config_id] ?? c.min_value ?? 0 }
            : { value: scores[c.config_id] ?? '' }),
        })),
        comment: comment.trim() || undefined,
      }
      await annotateQueueItem(queueId, currentItem.item_id, payload)
      const updated = [...items]
      updated[currentIdx] = { ...updated[currentIdx], reviewed: true, status: 'reviewed' }
      setItems(updated)
      setScores({})
      setComment('')
      if (currentIdx < items.length - 1) {
        setCurrentIdx(currentIdx + 1)
      } else {
        goNext()
      }
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }, [
    currentItem,
    currentIdx,
    items,
    queueId,
    comment,
    scores,
    configsToShow,
    saving,
    goNext,
  ])

  useEffect(() => {
    const handleKeyDown = (e) => {
      const inTextarea = document.activeElement?.tagName === 'TEXTAREA'
      if (inTextarea && e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        handleSubmitAndNext()
        return
      }
      if (inTextarea) return

      if (!currentItem) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          goPrev()
          break
        case 'ArrowRight':
          e.preventDefault()
          goNext()
          break
        case 'Enter':
          e.preventDefault()
          handleSubmitAndNext()
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          if (firstNumericConfig) {
            e.preventDefault()
            const n = parseInt(e.key, 10)
            const min = firstNumericConfig.min_value ?? 0
            const max = firstNumericConfig.max_value ?? 10
            const clamped = Math.min(max, Math.max(min, n))
            setScores((prev) => ({ ...prev, [firstNumericConfig.config_id]: clamped }))
          }
          break
        case 'y':
        case 'Y':
          if (firstBinaryConfig) {
            e.preventDefault()
            setScores((prev) => ({ ...prev, [firstBinaryConfig.config_id]: 'yes' }))
          }
          break
        case 'n':
        case 'N':
          if (firstBinaryConfig) {
            e.preventDefault()
            setScores((prev) => ({ ...prev, [firstBinaryConfig.config_id]: 'no' }))
          }
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentItem, firstNumericConfig, firstBinaryConfig, goPrev, goNext, handleSubmitAndNext])

  const handleSkip = () => {
    if (currentIdx < items.length - 1) {
      setCurrentIdx(currentIdx + 1)
    }
    setScores({})
    setComment('')
  }

  const toggleSelect = (itemId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const handleApproveSelected = async () => {
    if (selectedIds.size === 0) return
    setApproving(true)
    try {
      await approveQueueItems(queueId, { item_ids: [...selectedIds] })
      setSelectedIds(new Set())
      loadQueue()
    } catch (e) {
      console.error(e)
    }
    setApproving(false)
  }

  const handleApproveAllReviewed = async () => {
    const reviewedIds = items.filter((i) => i.reviewed).map((i) => i.item_id)
    if (reviewedIds.length === 0) return
    setApproving(true)
    try {
      await approveQueueItems(queueId, { item_ids: reviewedIds })
      loadQueue()
    } catch (e) {
      console.error(e)
    }
    setApproving(false)
  }

  const reviewedCount = items.filter((i) => i.reviewed).length
  const progress = items.length ? Math.round((reviewedCount / items.length) * 100) : 0

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #e2e8f0',
              borderTop: '3px solid #6d28d9',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <div style={{ color: '#64748b', fontSize: 14 }}>Loading queue...</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  if (error || !queue) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Annotation Review" icon={ClipboardCheck} />
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <AlertCircle size={20} color="#dc2626" style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, color: '#991b1b' }}>Queue not found</div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#b91c1c' }}>{error}</p>
            <Link
              to="/annotation-queues"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 12,
                fontSize: 13,
                color: '#6d28d9',
                fontWeight: 500,
              }}
            >
              <ArrowLeft size={14} /> Back to Annotation Queues
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const s = {
    card: {
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e2e8f0',
      overflow: 'hidden',
    },
    btn: {
      padding: '7px 14px',
      fontSize: 12,
      borderRadius: 7,
      border: '1px solid #e2e8f0',
      background: '#fff',
      cursor: 'pointer',
      fontWeight: 500,
      color: '#475569',
    },
    btnPrimary: {
      padding: '8px 18px',
      fontSize: 13,
      borderRadius: 8,
      border: 'none',
      background: '#059669',
      color: '#fff',
      cursor: 'pointer',
      fontWeight: 600,
    },
    btnSecondary: {
      padding: '8px 18px',
      fontSize: 13,
      borderRadius: 8,
      border: '1px solid #e2e8f0',
      background: '#fff',
      color: '#64748b',
      cursor: 'pointer',
      fontWeight: 600,
    },
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 500 }}>
      <PageHeader
        title={queue.name || 'Annotation Review'}
        subtitle={queue.description}
        icon={ClipboardCheck}
        breadcrumbs={[
          { label: 'Annotation Queues', to: '/annotation-queues' },
          { label: queue.name || queueId },
        ]}
      />

      {items.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            No items in this queue. Add traces to get started.
          </div>
        </div>
      ) : (
        <>
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 0',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={goPrev} disabled={currentIdx === 0} style={{ ...s.btn, opacity: currentIdx === 0 ? 0.4 : 1 }}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#334155', minWidth: 90 }}>
              Item {currentIdx + 1} of {items.length}
            </span>
            <button
              onClick={goNext}
              disabled={currentIdx >= items.length - 1}
              style={{ ...s.btn, opacity: currentIdx >= items.length - 1 ? 0.4 : 1 }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: '#f8fafc',
              borderRadius: 8,
              fontSize: 11,
              color: '#64748b',
            }}
          >
            <Keyboard size={12} />
            ← → nav · 1-5 score · y/n binary · Enter submit
          </div>
        </div>
      </div>

      {/* Main layout: 60% trace | 40% sidebar */}
      <div style={{ flex: 1, display: 'flex', gap: 20, minHeight: 0 }}>
        {/* Left: Trace viewer (60%) */}
        <div style={{ flex: '0 0 60%', ...s.card, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TraceViewer trace={trace} traceId={traceId} loading={traceLoading} fallbackItem={currentItem} />
        </div>

        {/* Right: Annotation sidebar (40%) */}
        <div
          style={{
            flex: '0 0 calc(40% - 20px)',
            ...s.card,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Annotation</h3>

          {configsToShow.map((cfg) => (
            <ScoreConfigWidget
              key={cfg.config_id}
              config={cfg}
              value={scores[cfg.config_id]}
              onChange={(v) => setScores((prev) => ({ ...prev, [cfg.config_id]: v }))}
            />
          ))}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Comment
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment..."
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 13,
                resize: 'vertical',
                boxSizing: 'border-box',
                lineHeight: 1.5,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button onClick={handleSkip} style={{ ...s.btnSecondary, flex: 1 }}>
              <SkipForward size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Skip
            </button>
            <button
              onClick={handleSubmitAndNext}
              disabled={saving}
              style={{
                ...s.btnPrimary,
                flex: 2,
                opacity: saving ? 0.6 : 1,
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : (
                <>
                  <Check size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Submit & Next
                </>
              )}
            </button>
          </div>

          {/* Progress */}
          <div style={{ marginTop: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
              {reviewedCount} of {items.length} reviewed
            </div>
            <div
              style={{
                width: '100%',
                height: 6,
                background: '#e2e8f0',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#6d28d9',
                  borderRadius: 3,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          </div>

          {currentItem?.reviewed && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 12,
                padding: '8px 12px',
                background: '#dcfce7',
                borderRadius: 8,
                fontSize: 12,
                color: '#166534',
                fontWeight: 600,
              }}
            >
              <CheckCircle2 size={14} /> Reviewed
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: bulk actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 0',
          borderTop: '1px solid #e2e8f0',
          marginTop: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {items.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={currentItem && selectedIds.has(currentItem.item_id)}
                onChange={() => currentItem && toggleSelect(currentItem.item_id)}
              />
              Select current
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleApproveSelected}
            disabled={selectedIds.size === 0 || approving}
            style={{
              ...s.btnSecondary,
              opacity: selectedIds.size === 0 || approving ? 0.5 : 1,
              cursor: selectedIds.size === 0 || approving ? 'not-allowed' : 'pointer',
            }}
          >
            <ClipboardCheck size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Approve Selected ({selectedIds.size})
          </button>
          <button
            onClick={handleApproveAllReviewed}
            disabled={reviewedCount === 0 || approving}
            style={{
              ...s.btnPrimary,
              background: '#6d28d9',
              opacity: reviewedCount === 0 || approving ? 0.5 : 1,
              cursor: reviewedCount === 0 || approving ? 'not-allowed' : 'pointer',
            }}
          >
            <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Approve All Reviewed ({reviewedCount})
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  )
}
