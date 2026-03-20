import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { getTrace, addFeedback, addThumbsFeedback, listTraceReviews } from '../api'
import {
  ChevronRight, ChevronDown, MessageSquare, Bot, Wrench, Copy, Check,
  ChevronUp, User, Search, Star, Send, Activity, Clock, Cpu, DollarSign,
  Layers, Workflow, AlertCircle, Calendar, GitBranch, Database, ExternalLink,
  ThumbsUp, ThumbsDown, AlertTriangle as FlagIcon
} from 'lucide-react'
import AgentFlowGraph from './AgentFlowGraph'
import MarkdownRenderer from './MarkdownRenderer'
import TraceAgentGraph from './TraceAgentGraph'
import PlaybackControls from './PlaybackControls'
import AgentDetailPanel from './AgentDetailPanel'
import KnowledgeGraphPanel, { extractGraphData } from './KnowledgeGraphPanel'
import TraceSummary from './TraceSummary'
import { ErrorBoundary } from './ErrorBoundary'
import StatCard from './ui/StatCard'
import StatusBadge from './ui/StatusBadge'
import { formatNumber, formatLatency, formatCost } from '../utils/format'
import { buildPlaybackTimeline } from '../utils/playbackTimeline'

function tryFormatJson(str) {
  if (typeof str !== 'string' || !str.trim()) return str
  const trimmed = str.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
  }
  return str
}

function ContentBlock({ label, content, className = '' }) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const formatted = tryFormatJson(content)
  const lines = (formatted || '').split('\n').length
  const isLong = lines > 15

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }, [content])

  if (!content && content !== '') return null

  return (
    <div className={`mb-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <div className="flex items-center gap-1">
          <button onClick={handleCopy} className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Copy">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
          {isLong && (
            <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
          )}
        </div>
      </div>
      <div className="content-block">
        <pre className={`${collapsed ? 'max-h-40' : 'max-h-[600px]'} overflow-y-auto`}>{formatted}</pre>
      </div>
    </div>
  )
}

function MessageBubble({ role, content }) {
  const [expanded, setExpanded] = useState(false)
  const roleColors = {
    system: 'bg-amber-50 border-amber-200 text-amber-800',
    human: 'bg-blue-50 border-blue-200 text-blue-800',
    user: 'bg-blue-50 border-blue-200 text-blue-800',
    ai: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    assistant: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  }
  const roleIcons = { system: Cpu, human: User, user: User, ai: Bot, assistant: Bot }
  const Icon = roleIcons[role] || MessageSquare
  const color = roleColors[role] || 'bg-slate-50 border-slate-200 text-slate-800'
  const contentStr = typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content || '')
  const isLong = contentStr.length > 500
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(contentStr)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }, [contentStr])

  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Icon size={12} />
          <span className="text-xs font-semibold uppercase tracking-wider">{role}</span>
          <span className="text-2xs text-slate-400">{contentStr.length} chars</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCopy} className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-white/50 transition-colors" title="Copy">
            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
          </button>
          {isLong && (
            <button onClick={() => setExpanded(!expanded)} className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-white/50 transition-colors text-2xs font-medium">
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      </div>
      <pre className={`font-mono text-xs whitespace-pre-wrap break-words leading-relaxed ${isLong && !expanded ? 'max-h-48 overflow-y-auto' : 'max-h-[600px] overflow-y-auto'}`}>{contentStr}</pre>
    </div>
  )
}

function SpanDetailInline({ span }) {
  const llmData = span.llm || {}
  const kind = (span.kind || '').toLowerCase()
  const name = (span.name || '').toLowerCase()
  const isLLM = kind === 'llm' || name.startsWith('llm:')
  const isRetriever = kind === 'retriever' || name.startsWith('retriever:')
  const isEmbedding = kind === 'embedding' || name.startsWith('embedding:')

  // LLM prompt/response: prefer top-level (enriched from backend), then span.llm, then outputs.completion for SDK-style spans
  const promptMessages = span.prompt_messages || llmData.prompt_messages || []
  const completion = span.completion || llmData.completion || span.response || span.output ||
    (span.outputs && typeof span.outputs === 'object' && span.outputs !== null ? span.outputs.completion : null) ||
    (typeof span.outputs === 'string' ? span.outputs : '') || ''
  const inputs = span.inputs
  const outputs = span.outputs

  const retrieverData = span.retriever || {}
  const query = span.query || retrieverData.query || ''
  const documents = span.documents || retrieverData.documents || []

  if (isLLM) {
    const hasPrompt = Array.isArray(promptMessages) ? promptMessages.length > 0 : !!promptMessages
    const hasCompletion = !!completion
    const hasInputs = !!inputs && (typeof inputs === 'object' ? Object.keys(inputs).length > 0 : true)
    const hasOutputs = !!outputs && (typeof outputs === 'object' ? (outputs.completion != null || Object.keys(outputs).length > 0) : true)
    const hasAny = hasPrompt || hasCompletion || hasInputs || hasOutputs
    return (
      <div className="ml-6 mt-2 mb-3 space-y-3 animate-fade-in">
        {(span.model || llmData.model) && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-mono text-slate-500">{span.model || llmData.model}</span>
            <span className="text-slate-400">{span.input_tokens ?? llmData.input_tokens ?? 0} in / {span.output_tokens ?? llmData.output_tokens ?? 0} out</span>
            {(span.cost_usd ?? llmData.cost_usd) != null && <span className="text-emerald-600 font-medium">${(span.cost_usd ?? llmData.cost_usd ?? 0).toFixed(4)}</span>}
          </div>
        )}
        {hasPrompt && (
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">Prompt Messages</span>
            <div className="space-y-2">
              {Array.isArray(promptMessages) ? promptMessages.map((msg, i) => (
                <MessageBubble key={i} role={msg.role || 'unknown'} content={msg.content || JSON.stringify(msg)} />
              )) : (
                <ContentBlock label="Input" content={typeof promptMessages === 'string' ? promptMessages : JSON.stringify(promptMessages, null, 2)} />
              )}
            </div>
          </div>
        )}
        {!hasPrompt && inputs && (
          <ContentBlock label="Input" content={typeof inputs === 'object' ? JSON.stringify(inputs, null, 2) : String(inputs)} />
        )}
        {hasCompletion && (
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">Completion</span>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Bot size={12} className="text-emerald-700" />
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">assistant</span>
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-emerald-800 max-h-[500px] overflow-y-auto">{typeof completion === 'object' ? JSON.stringify(completion, null, 2) : String(completion)}</pre>
            </div>
          </div>
        )}
        {!hasCompletion && outputs && (
          <ContentBlock label="Output" content={typeof outputs === 'object' ? JSON.stringify(outputs, null, 2) : String(outputs)} />
        )}
        {!hasAny && (
          <p className="text-slate-400 text-sm italic">No prompt or completion data for this LLM span.</p>
        )}
      </div>
    )
  }

  if (isRetriever) {
    if (!query && documents.length === 0) return null
    return (
      <div className="ml-6 mt-2 mb-3 space-y-2 animate-fade-in">
        {query && <ContentBlock label="Query" content={String(query)} />}
        {documents.length > 0 && (
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1 block">{documents.length} Retrieved Documents</span>
            <div className="space-y-1">
              {documents.slice(0, 5).map((doc, i) => (
                <div key={i} className="text-xs bg-surface-2 p-2 rounded border border-slate-200">
                  <pre className="whitespace-pre-wrap break-words max-h-24 overflow-y-auto">{typeof doc === 'object' ? (doc.page_content || doc.content || JSON.stringify(doc, null, 2)) : String(doc)}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const isTool = kind === 'tool' || name.startsWith('tool:')
  if (isTool) {
    const toolData = span.tool || {}
    const toolInput = toolData.input || span.inputs
    const toolOutput = toolData.output || span.outputs
    const toolName = toolData.name || span.name
    if (!toolInput && !toolOutput) return null
    return (
      <div className="ml-6 mt-2 mb-3 space-y-2 animate-fade-in">
        {toolName && <div className="text-xs font-mono text-violet-600 font-medium">{toolName}</div>}
        {toolInput && <ContentBlock label="Tool Input" content={typeof toolInput === 'object' ? JSON.stringify(toolInput, null, 2) : String(toolInput)} />}
        {toolOutput && <ContentBlock label="Tool Output" content={typeof toolOutput === 'object' ? JSON.stringify(toolOutput, null, 2) : String(toolOutput)} />}
      </div>
    )
  }

  if (isEmbedding) {
    const embData = span.embedding || {}
    const embTokens = span.input_tokens ?? embData.input_tokens ?? 0
    const embCost = span.cost_usd ?? embData.cost_usd
    return (
      <div className="ml-6 mt-2 mb-3 animate-fade-in">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {(span.embedding_model || embData.model) && <span className="font-mono">{span.embedding_model || embData.model}</span>}
          {(span.embedding_count || embData.count) != null && <span>{span.embedding_count ?? embData.count} vectors</span>}
          {(span.embedding_dimensions || embData.dimensions) != null && <span>{span.embedding_dimensions ?? embData.dimensions}d</span>}
          {embTokens > 0 && <span>{embTokens} tokens</span>}
          {embCost != null && embCost > 0 && <span className="text-emerald-600 font-medium">${Number(embCost).toFixed(4)}</span>}
        </div>
      </div>
    )
  }

  if (inputs || outputs) {
    return (
      <div className="ml-6 mt-2 mb-3 space-y-2 animate-fade-in">
        {inputs && <ContentBlock label="Input" content={typeof inputs === 'object' ? JSON.stringify(inputs, null, 2) : String(inputs)} />}
        {outputs && <ContentBlock label="Output" content={typeof outputs === 'object' ? JSON.stringify(outputs, null, 2) : String(outputs)} />}
      </div>
    )
  }

  return null
}

function EventDetail({ event }) {
  if (!event || typeof event !== 'object') return null
  const attrs = event.attributes ?? event.attrs ?? {}
  const isLLM = event.name === 'llm_call' || event.name === 'llm'
  const isTool = event.name === 'tool_call' || event.name === 'tool'
  const inputPreview = attrs.input_preview ?? attrs.input ?? ''
  const outputPreview = attrs.output_preview ?? attrs.output ?? ''

  const iconClass = isLLM ? 'text-brand-600' : isTool ? 'text-violet-600' : 'text-emerald-600'
  const Icon = isLLM ? Bot : isTool ? Wrench : MessageSquare

  return (
    <div className="ml-4 mb-3 card p-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Icon size={14} className={iconClass} />
        <span className="font-semibold text-sm text-slate-800">{event.name}</span>
        {attrs.agent_name && <span className="badge-brand">{attrs.agent_name}</span>}
        {attrs.model && <span className="text-slate-400 text-xs font-mono">{attrs.model}</span>}
        {(attrs.input_tokens != null || attrs.output_tokens != null) && (
          <span className="text-slate-500 text-xs">{attrs.input_tokens ?? 0} in / {attrs.output_tokens ?? 0} out</span>
        )}
        {attrs.latency_ms != null && (
          <span className="badge-neutral text-2xs">{Number(attrs.latency_ms).toFixed(0)} ms</span>
        )}
        {isTool && attrs.success === false && <span className="badge-error">Failed</span>}
      </div>
      {attrs.prompt_preview && <ContentBlock label="Prompt / Messages" content={attrs.prompt_preview} />}
      {attrs.response_preview && <ContentBlock label="LLM Response" content={attrs.response_preview} />}
      {attrs.query && <ContentBlock label="User Query" content={attrs.query} />}
      {isTool && (
        <div className="space-y-3 mt-3 pt-3 border-t border-slate-100">
          {attrs.tool_name && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">Tool</span>
              <div className="mt-1 font-mono text-xs bg-surface-2 px-2.5 py-1.5 rounded-lg inline-block border border-slate-200">{attrs.tool_name}</div>
            </div>
          )}
          {inputPreview && <ContentBlock label="Tool Input" content={inputPreview} />}
          {outputPreview && <ContentBlock label="Tool Output" content={outputPreview} />}
        </div>
      )}
    </div>
  )
}

function SpanTree({ span, depth = 0, traceStart, traceDuration }) {
  const kind = (span.kind || '').toLowerCase()
  const name = (span.name || '').toLowerCase()
  const isLLM = kind === 'llm' || name.startsWith('llm:')
  const llmData = span.llm || {}
  const hasLLMContent = isLLM && (span.prompt_messages?.length || llmData.prompt_messages?.length || span.completion || llmData.completion || (span.outputs && (span.outputs.completion || (typeof span.outputs === 'string' && span.outputs))))
  const [open, setOpen] = useState(depth < 2)
  const [showDetail, setShowDetail] = useState(!!hasLLMContent)
  const [showEvents, setShowEvents] = useState(depth === 0)
  const hasChildren = span.children?.length > 0
  const hasEvents = span.events?.length > 0
  const latency = span.end_time_ns && span.start_time_ns
    ? ((span.end_time_ns - span.start_time_ns) / 1e6).toFixed(0)
    : '-'

  const isRetriever = kind === 'retriever' || name.startsWith('retriever:')
  const isTool = kind === 'tool' || name.startsWith('tool:')
  const isLeafWithData = (isLLM || isRetriever || isTool || span.inputs || span.outputs)

  const spanTokens = span.events?.reduce((acc, e) => {
    const a = (e && e.attributes) || {}
    return acc + (Number(a.input_tokens) || 0) + (Number(a.output_tokens) || 0)
  }, 0) || 0

  const directTokens = (span.input_tokens ?? llmData.input_tokens ?? 0) + (span.output_tokens ?? llmData.output_tokens ?? 0)
  const displayTokens = spanTokens || directTokens

  const barLeft = traceStart && traceDuration && span.start_time_ns
    ? Math.max(0, ((span.start_time_ns - traceStart) / 1e6) / traceDuration * 100) : 0
  const barWidth = traceStart && traceDuration && span.start_time_ns && span.end_time_ns
    ? Math.max(0.5, ((span.end_time_ns - span.start_time_ns) / 1e6) / traceDuration * 100) : 0

  const depthColors = [
    'border-l-brand-400', 'border-l-emerald-400', 'border-l-amber-400',
    'border-l-violet-400', 'border-l-rose-400', 'border-l-cyan-400',
  ]

  const kindBadge = isLLM ? 'bg-blue-100 text-blue-700' : isRetriever ? 'bg-amber-100 text-amber-700' : kind === 'embedding' ? 'bg-purple-100 text-purple-700' : kind === 'agent' ? 'bg-brand-100 text-brand-700' : kind === 'tool' ? 'bg-violet-100 text-violet-700' : ''

  const handleClick = () => {
    if (hasChildren || hasEvents) {
      setOpen(!open)
    } else if (isLeafWithData) {
      setShowDetail(!showDetail)
    }
  }

  return (
    <div className={`${depth > 0 ? 'ml-4 border-l-2 pl-3 ' + depthColors[depth % depthColors.length] : ''}`}>
      <div
        className="flex items-center gap-2 py-2 px-2 rounded-lg text-sm hover:bg-surface-2 transition-colors cursor-pointer group"
        onClick={handleClick}
      >
        <span className="w-4 flex-shrink-0 text-slate-400">
          {(hasChildren || hasEvents) ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : isLeafWithData ? (showDetail ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>
        <span className="font-medium text-slate-800 min-w-0 truncate">{span.name}</span>
        {kindBadge && <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${kindBadge}`}>{kind}</span>}
        <span className="text-slate-400 text-xs font-mono flex-shrink-0">{latency} ms</span>
        {displayTokens > 0 && <span className="badge-brand text-2xs flex-shrink-0">{displayTokens} tok</span>}
        {isLeafWithData && !hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowDetail(!showDetail) }}
            className="opacity-0 group-hover:opacity-100 text-2xs text-brand-600 hover:text-brand-700 font-medium transition-all"
          >
            {showDetail ? 'Hide' : 'View'} Details
          </button>
        )}
        {barWidth > 0 && (
          <div className="flex-1 min-w-[80px] h-5 relative hidden lg:block">
            <div className="absolute inset-0 bg-surface-2 rounded-full" />
            <div
              className="waterfall-bar bg-brand-400/30"
              style={{ left: `${barLeft}%`, width: `${Math.min(barWidth, 100 - barLeft)}%` }}
            />
          </div>
        )}
      </div>
      {showDetail && <SpanDetailInline span={span} />}
      {open && hasChildren && (
        <div className="mt-0.5">
          {span.children.map((c) => (
            <SpanTree key={c.span_id} span={c} depth={depth + 1} traceStart={traceStart} traceDuration={traceDuration} />
          ))}
        </div>
      )}
      {open && hasEvents && (
        <div className="mt-1">
          <button
            onClick={(e) => { e.stopPropagation(); setShowEvents(!showEvents) }}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 mb-1 ml-6 transition-colors"
          >
            {showEvents ? 'Hide' : 'Show'} events ({span.events.length})
          </button>
          {showEvents && span.events.filter(Boolean).map((e, i) => (
            <EventDetail key={i} event={e} />
          ))}
        </div>
      )}
    </div>
  )
}

function LLMCallPanel({ span, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const llmData = span.llm || {}
  const prompt = span.prompt_messages || llmData.prompt_messages || span.prompt || span.input || ''
  const completion = span.completion || llmData.completion || span.response || span.output || ''
  const parentAgent = span.parent_agent || ''
  const inputs = span.inputs
  const outputs = span.outputs

  const hasPrompt = Array.isArray(prompt) ? prompt.length > 0 : !!prompt
  const hasCompletion = !!completion

  const renderMessages = (messages) => {
    if (Array.isArray(messages)) {
      return messages.map((msg, i) => (
        <MessageBubble key={i} role={msg.role || 'unknown'} content={msg.content || JSON.stringify(msg)} />
      ))
    }
    if (typeof messages === 'string') return <ContentBlock label="Input" content={messages} />
    return <ContentBlock label="Input" content={JSON.stringify(messages, null, 2)} />
  }

  return (
    <div className="card mb-3 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-1 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          <Bot size={16} className="text-brand-600" />
          <span className="font-medium text-sm text-slate-800">{span.model || llmData.model || span.name || '-'}</span>
          {parentAgent && <span className="text-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{parentAgent}</span>}
          <span className="text-xs text-slate-400 font-mono">{span.input_tokens ?? llmData.input_tokens ?? 0} in / {span.output_tokens ?? llmData.output_tokens ?? 0} out</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          {(span.cost_usd != null || llmData.cost_usd != null) && (
            <span className="text-emerald-600 font-medium">${(span.cost_usd ?? llmData.cost_usd ?? 0).toFixed(4)}</span>
          )}
          {(span.latency_ms != null || span.duration_ms != null) && (
            <span className="font-mono">{(span.latency_ms ?? span.duration_ms ?? 0).toFixed(0)} ms</span>
          )}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-slate-100 space-y-4 bg-surface-1">
          {hasPrompt && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">
                Prompt Messages {Array.isArray(prompt) ? `(${prompt.length})` : ''}
              </span>
              <div className="space-y-2">{renderMessages(prompt)}</div>
            </div>
          )}
          {!hasPrompt && inputs && (
            <ContentBlock label="Input" content={typeof inputs === 'object' ? JSON.stringify(inputs, null, 2) : String(inputs)} />
          )}
          {hasCompletion && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">Completion</span>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Bot size={12} className="text-emerald-700" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">assistant</span>
                </div>
                <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-emerald-800 max-h-[600px] overflow-y-auto">{typeof completion === 'object' ? JSON.stringify(completion, null, 2) : String(completion)}</pre>
              </div>
            </div>
          )}
          {!hasCompletion && outputs && (
            <ContentBlock label="Output" content={typeof outputs === 'object' ? JSON.stringify(outputs, null, 2) : String(outputs)} />
          )}
          {!hasPrompt && !hasCompletion && !inputs && !outputs && (
            <p className="text-slate-400 text-sm italic">No prompt or completion data recorded for this LLM call.</p>
          )}
        </div>
      )}
    </div>
  )
}

function RAGQueryPanel({ span, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const retrieverData = span.retriever || {}
  const query = span.query || retrieverData.query || span.input || ''
  const documents = span.documents || span.retrieved_documents || retrieverData.documents || span.results || []
  const parentAgent = span.parent_agent || ''

  const sourceLabels = {
    'case': 'Case Documents',
    'COA': 'Texas Court of Appeals',
    'coa': 'Texas Court of Appeals',
    'ROE': 'Rules of Evidence',
    'roe': 'Rules of Evidence',
  }

  return (
    <div className="card mb-3 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-1 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          <Search size={16} className="text-violet-600" />
          <span className="font-medium text-sm truncate max-w-md text-slate-800">{query || 'RAG Query'}</span>
          {parentAgent && <span className="text-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{parentAgent}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          <span className="badge-neutral">{Array.isArray(documents) ? documents.length : 0} docs</span>
          {span.latency_ms != null && <span className="font-mono">{span.latency_ms.toFixed(0)} ms</span>}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3 bg-surface-1">
          {query && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Search size={12} className="text-violet-700" />
                <span className="text-xs font-semibold uppercase tracking-wider text-violet-700">Query</span>
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-violet-800">{typeof query === 'object' ? JSON.stringify(query, null, 2) : String(query)}</pre>
            </div>
          )}
          {Array.isArray(documents) && documents.length > 0 && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-2 block">Retrieved Documents ({documents.length})</span>
              {documents.map((doc, i) => {
                const source = doc.source || (doc.metadata && doc.metadata.source) || ''
                const sourceLabel = sourceLabels[source] || source
                const score = doc.score ?? doc.relevance_score
                const content = typeof doc === 'object' ? (doc.content || doc.text || doc.page_content || JSON.stringify(doc, null, 2)) : String(doc)
                return (
                  <div key={i} className="card p-3 mb-2 border-l-4 border-l-violet-300">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-700">#{i + 1}</span>
                      {score != null && (
                        <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                          Score: {Number(score).toFixed(4)}
                        </span>
                      )}
                      {sourceLabel && (
                        <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                          {sourceLabel}
                        </span>
                      )}
                    </div>
                    <pre className="font-mono text-xs bg-white p-2 rounded-lg max-h-40 overflow-auto whitespace-pre-wrap break-words border border-slate-100 leading-relaxed">
                      {content}
                    </pre>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallPanel({ span, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const toolData = span.tool || {}
  const toolName = toolData.name || span.name || 'Tool Call'
  const toolInput = toolData.input || span.inputs
  const toolOutput = toolData.output || span.outputs
  const parentAgent = span.parent_agent || (span.metadata && span.metadata.agent) || ''
  const latency = span.latency_ms ?? span.duration_ms ?? 0
  const isError = span.status === 'error' || (span.metadata && span.metadata.error)
  const errorMsg = (span.metadata && span.metadata.error) || ''

  // Distinguish graph operations from regular tool calls
  const name = (span.name || '').toLowerCase()
  const isGraph = name.startsWith('tool:') && (name.includes('graph') || name.includes('neo4j'))

  return (
    <div className="card mb-3 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-1 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          {isGraph ? <Database size={16} className="text-amber-600" /> : <Wrench size={16} className="text-violet-600" />}
          <span className="font-medium text-sm text-slate-800 truncate max-w-sm">{toolName.replace(/^tool:/i, '')}</span>
          {parentAgent && <span className="text-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{parentAgent}</span>}
          {isGraph && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">graph</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          {isError ? (
            <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">error</span>
          ) : (
            <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">ok</span>
          )}
          {latency > 0 && <span className="font-mono">{latency.toFixed(0)} ms</span>}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3 bg-surface-1">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <strong>Error:</strong> {errorMsg}
            </div>
          )}
          {toolInput && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Tool Input</span>
              <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-violet-800 max-h-64 overflow-y-auto">
                  {typeof toolInput === 'object' ? JSON.stringify(toolInput, null, 2) : String(toolInput)}
                </pre>
              </div>
            </div>
          )}
          {toolOutput && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Tool Output</span>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap break-words leading-relaxed text-emerald-800 max-h-80 overflow-y-auto">
                  {typeof toolOutput === 'object' ? JSON.stringify(toolOutput, null, 2) : String(toolOutput)}
                </pre>
              </div>
            </div>
          )}
          {!toolInput && !toolOutput && (
            <p className="text-slate-400 text-sm italic">No input/output data recorded for this tool call.</p>
          )}
        </div>
      )}
    </div>
  )
}

function EmbeddingCallPanel({ span, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const embData = span.embedding || {}
  const model = span.embedding_model || embData.model || span.model || span.name || 'Embedding'
  const parentAgent = span.parent_agent || (span.metadata && span.metadata.agent) || ''
  const inputTokens = span.input_tokens ?? embData.input_tokens ?? 0
  const cost = span.cost_usd ?? embData.cost_usd
  const count = span.embedding_count ?? embData.count
  const dimensions = span.embedding_dimensions ?? embData.dimensions
  const latency = span.latency_ms ?? span.duration_ms ?? 0

  const inputs = span.inputs
  const outputs = span.outputs

  return (
    <div className="card mb-3 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-1 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          <Cpu size={16} className="text-cyan-600" />
          <span className="font-medium text-sm text-slate-800 font-mono">{model.replace(/^embedding:/i, '')}</span>
          {parentAgent && <span className="text-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{parentAgent}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          {count != null && <span className="badge-neutral">{count} vectors</span>}
          {dimensions != null && <span className="font-mono">{dimensions}d</span>}
          {inputTokens > 0 && <span className="font-mono">{inputTokens} tokens</span>}
          {cost != null && cost > 0 && <span className="text-emerald-600 font-medium">${Number(cost).toFixed(4)}</span>}
          {latency > 0 && <span className="font-mono">{latency.toFixed(0)} ms</span>}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3 bg-surface-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-white p-3 border border-slate-100 text-center">
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Model</div>
              <div className="text-sm font-mono font-medium text-slate-700">{model.replace(/^embedding:/i, '')}</div>
            </div>
            <div className="rounded-lg bg-white p-3 border border-slate-100 text-center">
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Tokens</div>
              <div className="text-sm font-mono font-medium text-slate-700">{inputTokens || '—'}</div>
            </div>
            <div className="rounded-lg bg-white p-3 border border-slate-100 text-center">
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Vectors</div>
              <div className="text-sm font-mono font-medium text-slate-700">{count ?? '—'}</div>
            </div>
            <div className="rounded-lg bg-white p-3 border border-slate-100 text-center">
              <div className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Cost</div>
              <div className="text-sm font-mono font-medium text-emerald-600">{cost != null && cost > 0 ? `$${Number(cost).toFixed(4)}` : '—'}</div>
            </div>
          </div>
          {inputs && (
            <ContentBlock label="Input" content={typeof inputs === 'object' ? JSON.stringify(inputs, null, 2) : String(inputs)} />
          )}
          {outputs && (
            <ContentBlock label="Output" content={typeof outputs === 'object' ? JSON.stringify(outputs, null, 2) : String(outputs)} />
          )}
          {!inputs && !outputs && inputTokens === 0 && (
            <p className="text-slate-400 text-sm italic">No detailed embedding data recorded for this call.</p>
          )}
        </div>
      )}
    </div>
  )
}

function GraphOperationPanel({ span, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const meta = span.metadata || span.attributes || {}
  const name = (span.name || '').replace(/^(graph:|tool:.*?:)/i, '').trim() || 'Graph Operation'
  const parentAgent = span.parent_agent || meta.agent || ''
  const latency = span.latency_ms ?? span.duration_ms ?? meta.latency_ms ?? 0
  const toolData = span.tool || {}
  const toolInput = toolData.input || span.inputs
  const toolOutput = toolData.output || span.outputs
  const isError = span.status === 'error'

  // Extract graph-specific metadata
  const graphMeta = {}
  for (const [k, v] of Object.entries(meta)) {
    if (['agent', 'latency_ms', 'trace_id', 'span_id'].includes(k)) continue
    graphMeta[k] = v
  }

  return (
    <div className="card mb-3 overflow-hidden">
      <div className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-surface-1 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0">
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
          <Database size={16} className="text-amber-600" />
          <span className="font-medium text-sm text-slate-800">{name}</span>
          {parentAgent && <span className="text-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded-full font-medium">{parentAgent}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-shrink-0">
          {isError ? (
            <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">error</span>
          ) : (
            <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">ok</span>
          )}
          {latency > 0 && <span className="font-mono">{latency.toFixed(0)} ms</span>}
        </div>
      </div>
      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3 bg-surface-1">
          {Object.keys(graphMeta).length > 0 && (
            <div>
              <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Operation Details</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(graphMeta).map(([k, v]) => (
                  <span key={k} className="text-xs px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-mono">
                    {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {toolInput && (
            <ContentBlock label="Input" content={typeof toolInput === 'object' ? JSON.stringify(toolInput, null, 2) : String(toolInput)} />
          )}
          {toolOutput && (
            <ContentBlock label="Output" content={typeof toolOutput === 'object' ? JSON.stringify(toolOutput, null, 2) : String(toolOutput)} />
          )}
        </div>
      )}
    </div>
  )
}

const REVIEW_RATING_META = {
  approve: { label: 'Looks Good', Icon: ThumbsUp, colorCls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  needs_work: { label: 'Needs Work', Icon: Wrench, colorCls: 'bg-amber-50 text-amber-700 border-amber-200' },
  flag: { label: 'Flag Issue', Icon: FlagIcon, colorCls: 'bg-red-50 text-red-700 border-red-200' },
}

function ScoreBar({ score, maxScore = 100 }) {
  const pct = Math.min(100, Math.max(0, (score / maxScore) * 100))
  const barColor = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2 flex-1">
      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 w-10 text-right">{score}</span>
    </div>
  )
}

function CollapsibleReasoning({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="mt-1.5 ml-2">
      <button onClick={() => setOpen(!open)} className="text-2xs text-violet-500 hover:text-violet-700 font-medium">
        {open ? '▾ Hide reasoning' : '▸ Show reasoning'}
      </button>
      {open && (
        <div className="mt-1 pl-2 border-l-2 border-slate-200">
          <MarkdownRenderer content={text} size="xs" className="text-slate-500" />
        </div>
      )}
    </div>
  )
}

function AssessmentsPanel({ feedback = [], traceId }) {
  const [feedbackList, setFeedbackList] = useState(feedback)
  const [showAddForm, setShowAddForm] = useState(false)
  const [thumbs, setThumbs] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  const [reviews, setReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(true)

  useEffect(() => {
    if (!traceId) return
    setReviewsLoading(true)
    listTraceReviews(traceId)
      .then(r => {
        const data = r.data?.reviews || []
        setReviews(data)
      })
      .catch(() => {})
      .finally(() => setReviewsLoading(false))
  }, [traceId])

  const allReviewComments = useMemo(() => {
    const comments = []
    for (const rev of reviews) {
      for (const c of (rev.comments || [])) {
        comments.push({ ...c, token: rev.token })
      }
    }
    return comments.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))
  }, [reviews])

  const handleSubmitThumbsFeedback = async () => {
    if (!thumbs) return
    setSubmitting(true)
    setSubmitMsg('')
    try {
      await addThumbsFeedback({ trace_id: traceId, thumbs, comment: comment || undefined })
      const newEntry = {
        key: 'user_feedback',
        value: thumbs === 'up' ? 'True' : 'False',
        score: thumbs === 'up' ? 1.0 : 0.0,
        comment,
        source: 'user',
      }
      setFeedbackList([newEntry, ...feedbackList])
      setThumbs('')
      setComment('')
      setShowAddForm(false)
      setSubmitMsg('Feedback submitted!')
      setTimeout(() => setSubmitMsg(''), 3000)
    } catch {
      setSubmitMsg('Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const userFeedback = feedbackList.filter(f => f.source === 'user' || f.key === 'user_feedback')
  const automatedJudges = feedbackList.filter(f => {
    const src = f.source || ''
    const key = f.key || ''
    if (src === 'user' || key === 'user_feedback') return false
    if (f.evaluator_type === 'conversation' || src === 'conversation_judge') return false
    return true
  })
  const conversationEvals = feedbackList.filter(f =>
    f.evaluator_type === 'conversation' || (f.source || '') === 'conversation_judge'
  )

  const allScores = feedbackList
    .filter(f => typeof f.score === 'number')
    .map(f => f.score)
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null
  const passCount = feedbackList.filter(f => f.value === 'True' || (f.score != null && f.score >= 0.5)).length
  const failCount = feedbackList.length - passCount

  return (
    <div>
      {/* Score Summary Card */}
      {feedbackList.length > 0 && (
        <div className="mb-5 p-4 rounded-xl bg-gradient-to-r from-slate-50 to-indigo-50/30 border border-slate-200">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-3">Score Summary</div>
          <div className="flex items-center gap-6">
            {avgScore !== null && (
              <div className="text-center">
                <div className={`text-2xl font-bold ${avgScore >= 80 ? 'text-emerald-600' : avgScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                  {avgScore}
                </div>
                <div className="text-2xs text-slate-400">Avg Score</div>
              </div>
            )}
            <div className="flex gap-3">
              <div className="text-center px-3 py-1.5 rounded-lg bg-emerald-50">
                <div className="text-sm font-bold text-emerald-700">{passCount}</div>
                <div className="text-2xs text-emerald-500">Passed</div>
              </div>
              <div className="text-center px-3 py-1.5 rounded-lg bg-red-50">
                <div className="text-sm font-bold text-red-600">{failCount}</div>
                <div className="text-2xs text-red-400">Failed</div>
              </div>
            </div>
            <div className="flex-1">
              <ScoreBar score={avgScore || 0} />
            </div>
          </div>
        </div>
      )}

      {/* SME Reviews Section */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <MessageSquare size={14} className="text-purple-600" />
            SME Reviews ({allReviewComments.length})
          </h3>
          {reviews.length > 0 && (
            <span className="text-2xs text-slate-400">
              {reviews.length} review session{reviews.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {reviewsLoading ? (
          <div className="text-xs text-slate-400 py-4 text-center">Loading reviews...</div>
        ) : allReviewComments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-5 text-center">
            <MessageSquare size={20} className="text-slate-300 mx-auto mb-2" />
            <div className="text-sm text-slate-400">No SME reviews yet</div>
            <div className="text-xs text-slate-300 mt-1">Send this trace for review to collect expert feedback</div>
          </div>
        ) : (
          <div className="space-y-3">
            {allReviewComments.map((c, i) => {
              const rMeta = REVIEW_RATING_META[c.rating]
              const RIcon = rMeta?.Icon || Star
              return (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
                        <User size={13} className="text-purple-600" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-slate-800">{c.reviewer_name || 'Anonymous'}</span>
                        {c.reviewer_email && (
                          <span className="text-2xs text-slate-400 ml-2">{c.reviewer_email}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {rMeta && (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${rMeta.colorCls}`}>
                          <RIcon size={11} />
                          {rMeta.label}
                        </span>
                      )}
                      {c.submitted_at && (
                        <span className="text-2xs text-slate-400">{c.submitted_at.slice(0, 10)}</span>
                      )}
                    </div>
                  </div>
                  {c.comment && (
                    <div className="text-sm text-slate-600 leading-relaxed pl-9">
                      {c.comment}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* User Feedback Section */}
      <div className="border-t border-slate-200 pt-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <span className="text-lg">👍</span>
            User Feedback ({userFeedback.length})
          </h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="btn-brand text-xs px-3 py-1.5"
          >
            + Add feedback
          </button>
        </div>

        {submitMsg && (
          <div className={`text-xs mb-3 px-3 py-2 rounded ${submitMsg.includes('Failed') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {submitMsg}
          </div>
        )}

        {showAddForm && (
          <div className="card p-4 mb-4 border-brand-200 bg-brand-50/30">
            <div className="text-xs font-semibold text-slate-600 mb-2">User Feedback</div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setThumbs('up')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  thumbs === 'up'
                    ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300'
                    : 'bg-white text-slate-500 hover:bg-emerald-50 border border-slate-200'
                }`}
              >
                <span>&#128077;</span> Good
              </button>
              <button
                onClick={() => setThumbs('down')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  thumbs === 'down'
                    ? 'bg-red-100 text-red-700 ring-2 ring-red-300'
                    : 'bg-white text-slate-500 hover:bg-red-50 border border-slate-200'
                }`}
              >
                <span>&#128078;</span> Bad
              </button>
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Optional comment..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3"
              rows={2}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddForm(false); setThumbs(''); setComment('') }}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitThumbsFeedback}
                disabled={!thumbs || submitting}
                className="btn-brand text-xs px-4 py-1.5 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {userFeedback.map((f, i) => (
          <div key={i} className="flex items-center gap-2 mb-2 ml-2">
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
              f.value === 'True' || (f.score != null && f.score >= 0.5)
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600'
            }`}>
              {f.value === 'True' || (f.score != null && f.score >= 0.5) ? '👍 Positive' : '👎 Negative'}
            </span>
            {f.comment && <span className="text-xs text-slate-500 italic">{f.comment}</span>}
          </div>
        ))}
        {userFeedback.length === 0 && !showAddForm && (
          <div className="text-xs text-slate-400 text-center py-3">No user feedback yet</div>
        )}
      </div>

      {/* Automated Judges Section */}
      <div className="border-t border-slate-200 pt-5 mb-5">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-4">
          <Star size={14} className="text-amber-500" />
          Automated Judges ({automatedJudges.length})
        </h3>
        {automatedJudges.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-3">No automated evaluations yet</div>
        ) : (
          <div className="space-y-3">
            {automatedJudges.map((f, i) => {
              const passed = f.value === 'True' || (f.score != null && f.score >= 0.5)
              const evalName = f.evaluator_name || f.key || 'Judge'
              const score = typeof f.score === 'number' ? f.score : (passed ? 100 : 0)
              return (
                <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${
                      passed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
                    }`}>
                      {passed ? 'PASS' : 'FAIL'}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-800">{evalName}</div>
                      <ScoreBar score={score} />
                    </div>
                    {f.source && <span className="text-2xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded">{f.source}</span>}
                  </div>
                  <CollapsibleReasoning text={f.reasoning || f.comment} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Conversation Evaluators Section */}
      {conversationEvals.length > 0 && (
        <div className="border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-4">
            <MessageSquare size={14} className="text-blue-500" />
            Conversation Evaluators ({conversationEvals.length})
          </h3>
          <div className="space-y-3">
            {conversationEvals.map((f, i) => {
              const passed = f.value === 'True' || (f.score != null && f.score >= 0.5)
              const evalName = f.evaluator_name || f.key || 'Conversation Judge'
              const score = typeof f.score === 'number' ? f.score : (passed ? 100 : 0)
              return (
                <div key={i} className="rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${
                      passed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
                    }`}>
                      {passed ? 'PASS' : 'FAIL'}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-800">{evalName}</div>
                      <ScoreBar score={score} />
                    </div>
                    {f.session_id && <span className="text-2xs text-blue-400">Session: {f.session_id.slice(0, 8)}...</span>}
                  </div>
                  <CollapsibleReasoning text={f.reasoning || f.comment} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function extractActiveAgentIds(trace) {
  const allSpans = []
  const walk = (s) => {
    for (const sp of s || []) {
      if (!sp || typeof sp !== 'object') continue
      allSpans.push(sp)
      walk(sp?.children ?? [])
    }
  }
  walk(trace?.spans ?? [])
  if (allSpans.length === 0 && trace?.flat_spans) {
    allSpans.push(...trace.flat_spans)
  }

  const active = new Set()
  for (const sp of allSpans) {
    const name = (sp.name || '').toLowerCase()
    const kind = (sp.kind || '').toLowerCase()
    if (kind !== 'agent' && !name.startsWith('agent:')) continue
    const cleanName = name.replace(/^agent:/, '').replace(/^graph:/, '').trim()
    if (cleanName) active.add(cleanName)
  }
  return active
}

function TracePlaybackView({ trace }) {
  const [playbackIndex, setPlaybackIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timerRef = useRef(null)

  const timeline = useMemo(() => buildPlaybackTimeline(trace), [trace])
  const activeAgentIds = useMemo(() => extractActiveAgentIds(trace), [trace])

  const currentEvent = playbackIndex >= 0 && playbackIndex < timeline.length ? timeline[playbackIndex] : null
  const playbackActiveId = currentEvent?.agentId || null

  const visitedAgentIds = useMemo(() => {
    if (playbackIndex < 0) return null
    const visited = new Set()
    for (let i = 0; i <= playbackIndex && i < timeline.length; i++) {
      visited.add(timeline[i].agentId)
    }
    return visited
  }, [playbackIndex, timeline])

  const showDetailPanel = currentEvent != null

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handlePlay = useCallback(() => {
    if (timeline.length === 0) return
    setIsPlaying(true)
    if (playbackIndex < 0) setPlaybackIndex(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setPlaybackIndex((prev) => {
        const next = prev < 0 ? 0 : prev + 1
        if (next >= timeline.length) {
          clearInterval(timerRef.current)
          setIsPlaying(false)
          return timeline.length - 1
        }
        return next
      })
    }, 2000 / speed)
  }, [timeline, speed, playbackIndex])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const handleStepForward = useCallback(() => {
    handlePause()
    setPlaybackIndex((prev) => {
      const next = prev + 1
      return next < timeline.length ? next : prev
    })
  }, [timeline, handlePause])

  const handleStepBack = useCallback(() => {
    handlePause()
    setPlaybackIndex((prev) => (prev > 0 ? prev - 1 : 0))
  }, [handlePause])

  const handleReset = useCallback(() => {
    handlePause()
    setPlaybackIndex(-1)
  }, [handlePause])

  const handleSeek = useCallback((idx) => {
    handlePause()
    setPlaybackIndex(idx)
  }, [handlePause])

  useEffect(() => {
    if (isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setPlaybackIndex((prev) => {
          const next = prev + 1
          if (next >= timeline.length) {
            clearInterval(timerRef.current)
            setIsPlaying(false)
            return timeline.length - 1
          }
          return next
        })
      }, 2000 / speed)
    }
    return () => { if (timerRef.current && !isPlaying) clearInterval(timerRef.current) }
  }, [speed])

  return (
    <div className="space-y-3">
      <PlaybackControls
        timeline={timeline}
        currentIndex={playbackIndex}
        isPlaying={isPlaying}
        speed={speed}
        onPlay={handlePlay}
        onPause={handlePause}
        onStepForward={handleStepForward}
        onStepBack={handleStepBack}
        onReset={handleReset}
        onSpeedChange={setSpeed}
        onSeek={handleSeek}
      />

      <div className={`flex gap-3 ${showDetailPanel ? '' : ''}`}>
        <div className={`${showDetailPanel ? 'w-3/5' : 'w-full'} transition-all`}>
          <div className="card overflow-hidden">
            <AgentFlowGraph
              productId={trace?.product_id || trace?.metadata?.product_id}
              activeAgents={playbackIndex < 0 ? activeAgentIds : null}
              playbackActiveId={playbackActiveId}
              visitedAgentIds={visitedAgentIds}
              compact
              hideStats
            />
          </div>
        </div>

        {showDetailPanel && (
          <div className="w-2/5 card overflow-hidden" style={{ maxHeight: 500 }}>
            <AgentDetailPanel event={currentEvent} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function TraceContent({ trace, traceId }) {
  const graphData = useMemo(() => trace ? extractGraphData(trace) : null, [trace])

  const spans = trace?.spans ?? []
  const flatSpansFromApi = trace?.flat_spans ?? []
  const feedbackFromApi = trace?.feedback ?? []

  const [activeTab, setActiveTab] = useState('flow')

  const agentSummary = useMemo(() => {
    if (!trace) return []
    const agents = {}
    const ensureAgent = (agentName) => {
      if (!agents[agentName]) agents[agentName] = { name: agentName, tokens: 0, llm_calls: 0, tool_calls: 0, rag_queries: 0, cost: 0, latency_ms: 0, status: 'ok' }
      return agents[agentName]
    }
    const addChildTokensCost = (a, child) => {
      const llm = child.llm
      if (llm && typeof llm === 'object') {
        const tot = llm.total_tokens ?? ((llm.input_tokens || 0) + (llm.output_tokens || 0))
        if (tot) a.tokens += tot
        if (llm.cost_usd) a.cost += Number(llm.cost_usd)
        return
      }
      const cm = child.metadata || child.attributes || {}
      if (cm.total_tokens || child.total_tokens) a.tokens += (cm.total_tokens || child.total_tokens || 0)
      if (cm.cost_usd || cm.total_cost_usd) a.cost += (cm.cost_usd || cm.total_cost_usd || 0)
    }

    const useFlatForMetrics = flatSpansFromApi.length > 0
    if (useFlatForMetrics) {
      for (const sp of flatSpansFromApi) {
        const kind = (sp.kind || '').toLowerCase()
        const name = (sp.name || '').toLowerCase()
        if (kind === 'agent' || name.startsWith('agent:')) {
          const agentName = (sp.name || '').replace(/^agent:/i, '').trim() || 'Agent'
          const a = ensureAgent(agentName)
          const dur = (sp.end_time_ns && sp.start_time_ns) ? (sp.end_time_ns - sp.start_time_ns) / 1e6 : (sp.duration_ms || sp.latency_ms || 0)
          if (dur) a.latency_ms += dur
          if (sp.status === 'error') a.status = 'error'
        }
        const parentAgent = sp.parent_agent
        if (parentAgent) {
          const a = ensureAgent(parentAgent)
          if (kind === 'llm' || name.startsWith('llm:')) a.llm_calls += 1
          if (kind === 'tool' || name.startsWith('tool:')) a.tool_calls += 1
          if (kind === 'retriever' || name.startsWith('retriever:')) a.rag_queries += 1
          const llm = sp.llm
          if (llm && typeof llm === 'object') {
            const tot = llm.total_tokens ?? ((llm.input_tokens || 0) + (llm.output_tokens || 0))
            if (tot) a.tokens += tot
            if (llm.cost_usd) a.cost += Number(llm.cost_usd)
          } else {
            if (sp.total_tokens) a.tokens += sp.total_tokens
            if (sp.cost_usd) a.cost += Number(sp.cost_usd)
          }
        }
      }
    }

    const allSpans = []
    const walk = (list) => {
      for (const sp of list || []) {
        if (!sp || typeof sp !== 'object') continue
        allSpans.push(sp)
        walk(sp.children || [])
      }
    }
    walk(spans)
    if (allSpans.length === 0 && !useFlatForMetrics) return Object.values(agents)

    const collectDescendants = (sp) => {
      const desc = []
      const walkChildren = (node) => {
        for (const child of (node.children || [])) {
          if (!child || typeof child !== 'object') continue
          desc.push(child)
          walkChildren(child)
        }
      }
      walkChildren(sp)
      return desc
    }

    for (const sp of allSpans) {
      const kind = (sp.kind || '').toLowerCase()
      const name = (sp.name || '')
      if (kind !== 'agent' && !name.toLowerCase().startsWith('agent:')) continue
      const agentName = name.replace(/^agent:/i, '').trim() || 'Agent'
      const a = ensureAgent(agentName)
      const meta = sp.metadata || sp.attributes || {}
      const dur = (sp.end_time_ns && sp.start_time_ns) ? (sp.end_time_ns - sp.start_time_ns) / 1e6 : 0
      a.latency_ms += dur
      if (meta.status === 'error' || sp.status === 'error') a.status = 'error'
      if (!useFlatForMetrics) {
        if (meta.total_tokens || sp.total_tokens) a.tokens += (meta.total_tokens || sp.total_tokens || 0)
        if (meta.cost_usd || meta.total_cost_usd) a.cost += (meta.cost_usd || meta.total_cost_usd || 0)
      }
      const descendants = collectDescendants(sp)
      for (const child of descendants) {
        const ck = (child.kind || '').toLowerCase()
        const cn = (child.name || '').toLowerCase()
        if (ck === 'llm' || cn.startsWith('llm:')) a.llm_calls += useFlatForMetrics ? 0 : 1
        if (ck === 'tool' || cn.startsWith('tool:')) a.tool_calls += useFlatForMetrics ? 0 : 1
        if (ck === 'retriever' || cn.startsWith('retriever:')) a.rag_queries += useFlatForMetrics ? 0 : 1
        if (!useFlatForMetrics) addChildTokensCost(a, child)
      }
    }

    return Object.values(agents)
  }, [trace, spans, flatSpansFromApi])

  const llmSpans = flatSpansFromApi.filter((s) => s.kind === 'llm' || s.type === 'llm' || s.span_kind === 'llm')
  const ragSpans = flatSpansFromApi.filter((s) => s.kind === 'retriever' || s.type === 'retriever' || s.span_kind === 'retriever' || s.kind === 'rag')
  const toolSpans = flatSpansFromApi.filter((s) => {
    const k = (s.kind || '').toLowerCase()
    const n = (s.name || '').toLowerCase()
    return (k === 'tool' || n.startsWith('tool:')) && !n.includes('graph')
  })
  const embeddingSpans = flatSpansFromApi.filter((s) => {
    const k = (s.kind || '').toLowerCase()
    const n = (s.name || '').toLowerCase()
    return k === 'embedding' || n.startsWith('embedding:') || s.span_kind === 'embedding'
  })
  const graphOpSpans = flatSpansFromApi.filter((s) => {
    const n = (s.name || '').toLowerCase()
    return n.startsWith('graph:') || (n.startsWith('tool:') && n.includes('graph'))
  })

  // Agent drill-down state for Pipeline Run tab
  const [expandedAgent, setExpandedAgent] = useState(null)
  const agentChildSpans = useMemo(() => {
    if (!expandedAgent) return []
    return flatSpansFromApi.filter((s) => s.parent_agent === expandedAgent)
  }, [expandedAgent, flatSpansFromApi])

  const allStarts = spans.flatMap((s) => { const collect = (sp) => [sp.start_time_ns, ...(sp.children || []).flatMap(collect)].filter(Boolean); return collect(s) })
  const allEnds = spans.flatMap((s) => { const collect = (sp) => [sp.end_time_ns, ...(sp.children || []).flatMap(collect)].filter(Boolean); return collect(s) })
  const traceStart = trace.start_time_ns ?? (allStarts.length ? Math.min(...allStarts) : 0)
  const traceEnd = trace.end_time_ns ?? (allEnds.length ? Math.max(...allEnds) : traceStart + 1)
  const traceDuration = Math.max((traceEnd - traceStart) / 1e6, 0.1)

  const tabs = [
    { id: 'summary', label: 'Summary', icon: MessageSquare },
    { id: 'flow', label: 'Agent Flow', icon: Workflow },
    { id: 'spans', label: 'Span Tree', icon: Layers, count: flatSpansFromApi.length || spans.length },
    { id: 'pipeline', label: 'Pipeline Run', icon: Workflow, count: agentSummary.length },
    { id: 'llm', label: 'LLM Calls', icon: Bot, count: llmSpans.length },
    { id: 'rag', label: 'RAG Queries', icon: Search, count: ragSpans.length },
    { id: 'tools', label: 'Tool Calls', icon: Wrench, count: toolSpans.length },
    { id: 'embeddings', label: 'Embeddings', icon: Cpu, count: embeddingSpans.length },
    { id: 'graph_ops', label: 'Graph Ops', icon: Database, count: graphOpSpans.length },
    { id: 'graph', label: 'Knowledge Graph', icon: GitBranch, count: graphData ? graphData.entityCount : 0 },
    { id: 'feedback', label: 'Feedback & Reviews', icon: Star, count: feedbackFromApi.length || null },
  ]

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-surface-1 px-1">
        <nav className="flex gap-0 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/50'
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${
                  activeTab === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-5">
        {activeTab === 'summary' && (
          <TraceSummary trace={trace} traceId={trace.trace_id} />
        )}

        {activeTab === 'spans' && (
          <div>
            {spans.length === 0 ? (
              <p className="text-slate-500 text-sm">No spans in this trace.</p>
            ) : (
              spans.map((s) => (
                <SpanTree key={s.span_id} span={s} traceStart={traceStart} traceDuration={traceDuration} />
              ))
            )}
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div>
            {agentSummary.length === 0 ? (
              <p className="text-slate-500 text-sm">No agent spans found in this trace.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left w-8"></th>
                      <th className="text-left">#</th>
                      <th className="text-left">Agent</th>
                      <th className="text-right">Tokens</th>
                      <th className="text-right">LLM Calls</th>
                      <th className="text-right">Tool Calls</th>
                      <th className="text-right">RAG Queries</th>
                      <th className="text-right">Cost</th>
                      <th className="text-right">Latency</th>
                      <th className="text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentSummary.map((a, i) => (
                      <>
                        <tr
                          key={a.name}
                          className="cursor-pointer hover:bg-brand-50/50 transition-colors"
                          onClick={() => setExpandedAgent(expandedAgent === a.name ? null : a.name)}
                        >
                          <td className="text-center">
                            {expandedAgent === a.name
                              ? <ChevronDown size={14} className="text-brand-500 inline" />
                              : <ChevronRight size={14} className="text-slate-400 inline" />
                            }
                          </td>
                          <td className="font-mono text-xs text-slate-400">{i + 1}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Bot size={14} className="text-brand-500" />
                              <span className="font-medium text-slate-800">{a.name}</span>
                            </div>
                          </td>
                          <td className="text-right font-mono text-xs" title={a.tokens.toLocaleString()}>{formatNumber(a.tokens).display}</td>
                          <td className="text-right font-mono text-xs">{a.llm_calls}</td>
                          <td className="text-right font-mono text-xs">{a.tool_calls}</td>
                          <td className="text-right font-mono text-xs">{a.rag_queries}</td>
                          <td className="text-right font-mono text-xs text-emerald-600" title={`$${a.cost.toFixed(6)}`}>{formatCost(a.cost).display}</td>
                          <td className="text-right font-mono text-xs" title={`${a.latency_ms.toLocaleString()} ms`}>{formatLatency(a.latency_ms, 1).display}</td>
                          <td className="text-right">
                            <StatusBadge status={a.status} />
                          </td>
                        </tr>
                        {expandedAgent === a.name && (
                          <tr key={`${a.name}-detail`}>
                            <td colSpan={10} className="p-0">
                              <div className="bg-slate-50 border-t border-b border-slate-200 p-4">
                                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                                  Child spans for {a.name} ({agentChildSpans.length})
                                </div>
                                {agentChildSpans.length === 0 ? (
                                  <p className="text-slate-400 text-sm italic">No child spans found for this agent.</p>
                                ) : (
                                  <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {agentChildSpans.map((cs, ci) => {
                                      const ck = (cs.kind || '').toLowerCase()
                                      const cn = (cs.name || '')
                                      const isLLM = ck === 'llm' || cn.toLowerCase().startsWith('llm:')
                                      const isTool = ck === 'tool' || cn.toLowerCase().startsWith('tool:')
                                      const isRag = ck === 'retriever' || cn.toLowerCase().startsWith('retriever:')
                                      const isEmb = ck === 'embedding' || cn.toLowerCase().startsWith('embedding:')
                                      const Icon = isLLM ? Bot : isTool ? Wrench : isRag ? Search : isEmb ? Cpu : Activity
                                      const iconColor = isLLM ? 'text-brand-600' : isTool ? 'text-violet-600' : isRag ? 'text-violet-600' : isEmb ? 'text-cyan-600' : 'text-slate-500'
                                      const kindLabel = isLLM ? 'LLM' : isTool ? 'Tool' : isRag ? 'RAG' : isEmb ? 'Embedding' : ck || 'span'
                                      const dur = cs.latency_ms ?? cs.duration_ms ?? 0
                                      return (
                                        <div key={cs.span_id || ci} className="flex items-center gap-3 px-3 py-2 bg-white rounded-lg border border-slate-100 text-xs">
                                          <Icon size={14} className={iconColor} />
                                          <span className="text-2xs px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 uppercase">{kindLabel}</span>
                                          <span className="font-medium text-slate-700 truncate flex-1">{cn}</span>
                                          {cs.model && <span className="font-mono text-slate-400">{cs.model}</span>}
                                          {dur > 0 && <span className="font-mono text-slate-400">{dur.toFixed(0)} ms</span>}
                                          {cs.cost_usd != null && cs.cost_usd > 0 && <span className="text-emerald-600 font-medium">${Number(cs.cost_usd).toFixed(4)}</span>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td></td>
                      <td></td>
                      <td className="text-slate-700 text-sm">Total ({agentSummary.length} agents)</td>
                      <td className="text-right font-mono text-xs" title={agentSummary.reduce((s, a) => s + a.tokens, 0).toLocaleString()}>{formatNumber(agentSummary.reduce((s, a) => s + a.tokens, 0)).display}</td>
                      <td className="text-right font-mono text-xs">{agentSummary.reduce((s, a) => s + a.llm_calls, 0)}</td>
                      <td className="text-right font-mono text-xs">{agentSummary.reduce((s, a) => s + a.tool_calls, 0)}</td>
                      <td className="text-right font-mono text-xs">{agentSummary.reduce((s, a) => s + a.rag_queries, 0)}</td>
                      <td className="text-right font-mono text-xs text-emerald-600" title={`$${agentSummary.reduce((s, a) => s + a.cost, 0).toFixed(6)}`}>{formatCost(agentSummary.reduce((s, a) => s + a.cost, 0)).display}</td>
                      <td className="text-right font-mono text-xs" title={`${agentSummary.reduce((s, a) => s + a.latency_ms, 0).toLocaleString()} ms`}>{formatLatency(agentSummary.reduce((s, a) => s + a.latency_ms, 0), 1).display}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'llm' && (
          <div>
            {llmSpans.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-5 text-sm text-slate-700">
                <p className="font-medium text-slate-800 mb-1">No LLM calls recorded for this trace.</p>
                <p className="text-slate-600 mb-2">
                  To see LLM input prompts, output messages, tokens, and cost per call, the demand-draft pipeline must run with the <strong>Cluco observability SDK</strong> that supports chat models (<code className="bg-white/80 px-1 rounded text-xs">on_chat_model_end</code>).
                </p>
                <p className="text-slate-600 text-xs">
                  Install the SDK from the repo: <code className="bg-white/80 px-1 rounded">pip install -e leco-pi/cluco-observability/sdk</code> (from repo root), then restart the demand-draft-service and run a new pipeline. Existing traces will not show per-call LLM data.
                </p>
                {(trace?.total_tokens > 0 || trace?.total_cost_usd > 0) && (
                  <p className="mt-2 text-xs text-slate-500">
                    This trace has aggregate tokens/cost in the summary above; per-call breakdown requires the SDK fix above.
                  </p>
                )}
              </div>
            ) : (
              llmSpans.map((s, i) => <LLMCallPanel key={s.span_id || i} span={s} />)
            )}
          </div>
        )}

        {activeTab === 'rag' && (
          <div>
            {ragSpans.length === 0 ? (
              <p className="text-slate-500 text-sm">No RAG queries in this trace.</p>
            ) : (
              ragSpans.map((s, i) => <RAGQueryPanel key={s.span_id || i} span={s} />)
            )}
          </div>
        )}

        {activeTab === 'tools' && (
          <div>
            {toolSpans.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <p className="font-medium text-slate-700 mb-1">No tool calls recorded for this trace.</p>
                <p>Tool calls are tracked automatically via the Cluco callback handler for LangChain tools, and via <code className="bg-white/80 px-1 rounded text-xs">record_tool_call()</code> for custom tools.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
                  <span className="font-medium">{toolSpans.length} tool call{toolSpans.length !== 1 ? 's' : ''}</span>
                  <span className="text-slate-300">|</span>
                  <span>Total latency: {formatLatency(toolSpans.reduce((s, sp) => s + (sp.latency_ms ?? sp.duration_ms ?? 0), 0), 1).display}</span>
                </div>
                {toolSpans.map((s, i) => <ToolCallPanel key={s.span_id || i} span={s} defaultOpen={i < 5} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'embeddings' && (
          <div>
            {embeddingSpans.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <p className="font-medium text-slate-700 mb-1">No embedding calls recorded for this trace.</p>
                <p>Embedding calls are tracked via <code className="bg-white/80 px-1 rounded text-xs">record_embedding()</code> in the demand-draft pipeline.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
                  <span className="font-medium">{embeddingSpans.length} embedding call{embeddingSpans.length !== 1 ? 's' : ''}</span>
                  <span className="text-slate-300">|</span>
                  <span>Total tokens: {embeddingSpans.reduce((s, sp) => s + (sp.input_tokens ?? (sp.embedding && sp.embedding.input_tokens) ?? 0), 0).toLocaleString()}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-emerald-600">Total cost: ${embeddingSpans.reduce((s, sp) => s + (sp.cost_usd ?? (sp.embedding && sp.embedding.cost_usd) ?? 0), 0).toFixed(4)}</span>
                </div>
                {embeddingSpans.map((s, i) => <EmbeddingCallPanel key={s.span_id || i} span={s} defaultOpen={i < 5} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'graph_ops' && (
          <div>
            {graphOpSpans.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                <p className="font-medium text-slate-700 mb-1">No graph operations recorded for this trace.</p>
                <p>Graph operations (Neo4j queries, entity merges, LKG lookups) are tracked via <code className="bg-white/80 px-1 rounded text-xs">record_graph_operation()</code>.</p>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
                  <span className="font-medium">{graphOpSpans.length} graph operation{graphOpSpans.length !== 1 ? 's' : ''}</span>
                  <span className="text-slate-300">|</span>
                  <span>Total latency: {formatLatency(graphOpSpans.reduce((s, sp) => s + (sp.latency_ms ?? sp.duration_ms ?? 0), 0), 1).display}</span>
                </div>
                {graphOpSpans.map((s, i) => <GraphOperationPanel key={s.span_id || i} span={s} defaultOpen={i < 5} />)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'flow' && (
          <ErrorBoundary>
            <TracePlaybackView trace={trace} />
          </ErrorBoundary>
        )}

        {activeTab === 'graph' && (
          <ErrorBoundary>
            <KnowledgeGraphPanel trace={trace} />
          </ErrorBoundary>
        )}

        {activeTab === 'feedback' && (
          <AssessmentsPanel feedback={feedbackFromApi} traceId={traceId} />
        )}
      </div>
    </div>
  )
}
