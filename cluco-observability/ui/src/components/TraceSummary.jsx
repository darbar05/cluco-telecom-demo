import { useState, useEffect } from 'react'
import { MessageSquare, ArrowRight, FileText, Bot, Sparkles, AlertCircle, Clock, Layers } from 'lucide-react'
import { getTraceSummary } from '../api'
import MarkdownRenderer from './MarkdownRenderer'

const PALETTE = [
  { color: '#6d28d9', bg: '#f5f3ff' },
  { color: '#059669', bg: '#ecfdf5' },
  { color: '#2563eb', bg: '#eff6ff' },
  { color: '#d97706', bg: '#fffbeb' },
  { color: '#dc2626', bg: '#fef2f2' },
  { color: '#7c3aed', bg: '#faf5ff' },
  { color: '#0891b2', bg: '#ecfeff' },
  { color: '#be185d', bg: '#fdf2f8' },
]

function hashToIndex(str) {
  let hash = 0
  for (let i = 0; i < (str || '').length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % PALETTE.length
}

function getCategoryStyle(category) {
  if (!category) return { color: '#64748b', bg: '#f8fafc', icon: '🤖', label: 'Agent' }
  const idx = hashToIndex(category)
  const pal = PALETTE[idx]
  const capitalized = category.charAt(0).toUpperCase() + category.slice(1)
  return { ...pal, icon: '🤖', label: `${capitalized} Handler` }
}

function extractConversation(trace) {
  const spans = trace?.spans || trace?.flat_spans || []
  let userQuery = ''
  let agentResponse = ''
  let category = ''
  let docsRetrieved = 0

  for (const span of spans) {
    const inp = span.inputs || span.input || {}
    const out = span.outputs || span.output || {}

    if (typeof inp === 'object' && inp.query && !userQuery) userQuery = inp.query
    if (typeof inp === 'object' && inp.prompt && !userQuery) userQuery = inp.prompt
    if (typeof inp === 'object' && inp.messages) {
      const msgs = inp.messages
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if ((m.role === 'human' || m.role === 'user') && !userQuery) userQuery = m.content
        }
      }
    }

    if (typeof out === 'object') {
      if (out.routing_decision) category = out.routing_decision
      if (out.category && !category) category = out.category
      if (out.classification && !category) category = out.classification
      if (out.final_response) agentResponse = out.final_response
      if (out.completion && !agentResponse) agentResponse = out.completion
      if (out.response && !agentResponse) agentResponse = out.response
      if (out.content && !agentResponse) agentResponse = out.content
      if (out.doc_count) docsRetrieved = out.doc_count
      if (out.retrieved_doc_count) docsRetrieved = out.retrieved_doc_count
    }

    if (span.retrieved_documents) {
      docsRetrieved = Math.max(docsRetrieved, span.retrieved_documents.length)
    }
  }

  if (!userQuery && trace?.metadata?.input) {
    userQuery = typeof trace.metadata.input === 'string' ? trace.metadata.input : JSON.stringify(trace.metadata.input)
  }
  if (!userQuery && trace?.request_preview) {
    userQuery = typeof trace.request_preview === 'string' ? trace.request_preview : JSON.stringify(trace.request_preview)
  }
  if (!agentResponse && trace?.response_preview) {
    agentResponse = typeof trace.response_preview === 'string' ? trace.response_preview : JSON.stringify(trace.response_preview)
  }

  return { userQuery, agentResponse, category, docsRetrieved }
}

function buildFlowSteps(trace, extracted) {
  const spans = trace?.spans || trace?.flat_spans || []
  const steps = []

  if (extracted.userQuery) {
    const preview = extracted.userQuery.length > 40 ? `"${extracted.userQuery.slice(0, 40)}..."` : `"${extracted.userQuery}"`
    steps.push({ label: 'Input Received', icon: '📝', detail: preview })
  }

  const topLevelSpans = spans
    .filter(s => !s.parent_span_id)
    .sort((a, b) => {
      const tA = new Date(a.start_time || a.started_at || 0).getTime()
      const tB = new Date(b.start_time || b.started_at || 0).getTime()
      return tA - tB
    })

  const spansToShow = topLevelSpans.length > 0 ? topLevelSpans : spans.slice(0, 6)

  for (const span of spansToShow) {
    const name = span.name || span.span_name || 'step'
    const kind = span.span_kind || span.kind || ''

    if (name.toLowerCase().includes('router') || name.toLowerCase().includes('classify') || name.toLowerCase().includes('route')) {
      const cat = extracted.category || 'detected'
      steps.push({ label: `Routed → ${cat}`, icon: '🔀', detail: '' })
    } else if (kind === 'RETRIEVER' || name.toLowerCase().includes('retriev') || name.toLowerCase().includes('search') || name.toLowerCase().includes('lookup')) {
      const count = extracted.docsRetrieved || '?'
      steps.push({ label: `Retrieved ${count} docs`, icon: '📚', detail: '' })
    } else if (kind === 'LLM' || name.toLowerCase().includes('llm') || name.toLowerCase().includes('openai') || name.toLowerCase().includes('chat')) {
      const model = span.metadata?.model || span.attributes?.model || ''
      steps.push({ label: model ? `LLM: ${model}` : 'LLM Call', icon: '🧠', detail: '' })
    } else if (kind === 'TOOL' || name.toLowerCase().includes('tool')) {
      steps.push({ label: `Tool: ${name}`, icon: '🔧', detail: '' })
    } else {
      steps.push({ label: name, icon: '⚙️', detail: '' })
    }
  }

  if (extracted.agentResponse) {
    steps.push({ label: 'Response Generated', icon: '✅', detail: '' })
  }

  if (steps.length === 0) {
    steps.push({ label: 'Trace executed', icon: '⚙️', detail: '' })
  }

  const seen = new Set()
  return steps.filter(s => {
    const key = s.label
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function TraceSummary({ trace, traceId, sessionTraces }) {
  const [summary, setSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)

  const extracted = extractConversation(trace)
  const { userQuery, agentResponse, category } = extracted
  const catStyle = getCategoryStyle(category)
  const flowSteps = buildFlowSteps(trace, extracted)

  const isMultiTurn = sessionTraces && sessionTraces.length > 1

  useEffect(() => {
    if (traceId && typeof getTraceSummary === 'function') {
      setLoadingSummary(true)
      getTraceSummary(traceId)
        .then(r => setSummary(r.data?.summary || r.data))
        .catch(() => {})
        .finally(() => setLoadingSummary(false))
    }
  }, [traceId])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Multi-turn conversation thread */}
      {isMultiTurn && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} color="#6d28d9" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Conversation ({sessionTraces.length} turns)</span>
          </div>
          <div style={{ padding: 16, display: 'grid', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
            {sessionTraces.map((st, idx) => {
              const turnData = extractConversation(st)
              const isCurrentTrace = (st.trace_id || st._id) === traceId
              return (
                <div key={idx} style={{
                  padding: 12, borderRadius: 8,
                  border: isCurrentTrace ? '2px solid #6d28d9' : '1px solid #e2e8f0',
                  background: isCurrentTrace ? '#faf5ff' : '#fafafa',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Turn {idx + 1}{isCurrentTrace ? ' (current)' : ''}</div>
                  {turnData.userQuery && (
                    <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: '#6d28d9' }}>User: </span>{turnData.userQuery}
                    </div>
                  )}
                  {turnData.agentResponse && (
                    <div style={{ fontSize: 12, color: '#374151' }}>
                      <span style={{ fontWeight: 600, color: '#059669' }}>Agent: </span>
                      {turnData.agentResponse.length > 200 ? turnData.agentResponse.slice(0, 200) + '...' : turnData.agentResponse}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Single-turn conversation */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6 }}>
          <MessageSquare size={14} color="#6d28d9" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>Conversation</span>
        </div>
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {userQuery && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 13 }}>👤</span>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#6d28d9', marginBottom: 3, textTransform: 'uppercase' }}>User Input</div>
                <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.6, background: '#f8fafc', padding: '10px 14px', borderRadius: '4px 12px 12px 12px' }}>
                  {userQuery}
                </div>
              </div>
            </div>
          )}
          {agentResponse && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: catStyle.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 13 }}>{catStyle.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: catStyle.color, marginBottom: 3, textTransform: 'uppercase' }}>Agent Response</div>
                <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.6, background: catStyle.bg, padding: '10px 14px', borderRadius: '4px 12px 12px 12px' }}>
                  {agentResponse}
                </div>
              </div>
            </div>
          )}
          {!userQuery && !agentResponse && (
            <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 13 }}>
              <AlertCircle size={20} style={{ margin: '0 auto 8px' }} />
              Could not extract conversation from this trace.
            </div>
          )}
        </div>
      </div>

      {/* What happened (dynamic flow from spans) */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} color="#f59e0b" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>What Happened</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {flowSteps.map((step, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: '#fafafa', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 11, fontWeight: 500, color: '#374151',
                }}>
                  <span>{step.icon}</span>
                  {step.label}
                </div>
                {i < arr.length - 1 && <ArrowRight size={14} color="#d1d5db" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {summary && (
        <div style={{ background: '#fefce8', borderRadius: 12, border: '1px solid #fde68a', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <Bot size={14} color="#ca8a04" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#854d0e' }}>AI-Generated Summary</span>
          </div>
          <MarkdownRenderer content={typeof summary === 'string' ? summary : summary.text || JSON.stringify(summary)} size="xs" className="text-yellow-900" />
        </div>
      )}
      {loadingSummary && (
        <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 12 }}>
          Generating summary…
        </div>
      )}
    </div>
  )
}
