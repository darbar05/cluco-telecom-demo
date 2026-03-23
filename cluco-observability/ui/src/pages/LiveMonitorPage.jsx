import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getActiveTraces, getGlobalLiveWsUrl, getSpans, getProducts, getTraces } from '../api'
import {
  Radio, Activity, Clock, DollarSign, Zap, CheckCircle, XCircle,
  Wifi, WifiOff, Trash2, ChevronDown, ChevronRight, Bot, Cpu,
  MessageSquare, Wrench, Search, Database, Layers, Filter, Copy, Check,
  ChevronUp, User, PlugZap, Unplug, GitBranch, FileText, Eye, EyeOff,
  AlertTriangle, Bell, BellOff, ArrowDownToLine, Pause, TrendingUp
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'

/* ──────────────── helpers ──────────────── */

function elapsed(startIso) {
  if (!startIso) return '—'
  const ms = Date.now() - new Date(startIso).getTime()
  if (ms < 0) return '0s'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

function fmtCost(v) {
  if (!v || v === 0) return '$0'
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`
}

function fmtTokens(v) {
  if (!v) return '0'
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

function tryFormatJson(str) {
  if (typeof str !== 'string' || !str.trim()) return str
  const trimmed = str.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
  }
  return str
}

const KIND_STYLE = {
  agent: { bg: 'bg-violet-100', text: 'text-violet-700', icon: Bot },
  llm: { bg: 'bg-blue-100', text: 'text-blue-700', icon: MessageSquare },
  tool: { bg: 'bg-amber-100', text: 'text-amber-700', icon: Wrench },
  retriever: { bg: 'bg-green-100', text: 'text-green-700', icon: Search },
  embedding: { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: Database },
  chain: { bg: 'bg-slate-100', text: 'text-slate-600', icon: Layers },
}

/* ──────────────── ContentBlock (reusable) ──────────────── */

function ContentBlock({ label, content, className = '' }) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const formatted = tryFormatJson(typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content || ''))
  const lines = (formatted || '').split('\n').length
  const isLong = lines > 12

  const handleCopy = useCallback(async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }, [content])

  if (!content && content !== '') return null

  return (
    <div className={`mb-2 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <div className="flex items-center gap-1">
          <button onClick={handleCopy} className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Copy">
            {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
          </button>
          {isLong && (
            <button onClick={() => setCollapsed(!collapsed)} className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              {collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
            </button>
          )}
        </div>
      </div>
      <pre className={`font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded-lg p-2.5 ${collapsed ? 'max-h-32' : 'max-h-[400px]'} overflow-y-auto text-slate-700`}>
        {formatted}
      </pre>
    </div>
  )
}

/* ──────────────── MessageBubble (for LLM prompts) ──────────────── */

function MessageBubble({ role, content }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
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
  const isLong = contentStr.length > 400

  const handleCopy = useCallback(async (e) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(contentStr)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }, [contentStr])

  return (
    <div className={`rounded-lg border p-2.5 ${color}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon size={11} />
          <span className="text-[10px] font-semibold uppercase tracking-wider">{role}</span>
          <span className="text-[9px] text-slate-400">{contentStr.length} chars</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCopy} className="p-0.5 rounded text-slate-400 hover:text-slate-600 transition-colors" title="Copy">
            {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
          </button>
          {isLong && (
            <button onClick={() => setExpanded(!expanded)} className="text-[9px] font-medium text-slate-500 hover:text-slate-700 transition-colors px-1">
              {expanded ? 'Less' : 'More'}
            </button>
          )}
        </div>
      </div>
      <pre className={`font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed ${isLong && !expanded ? 'max-h-36 overflow-y-auto' : 'max-h-[500px] overflow-y-auto'}`}>{contentStr}</pre>
    </div>
  )
}

/* ──────────────── SpanDetailPanel — full detail view ──────────────── */

function SpanDetailPanel({ span }) {
  const kind = (span.kind || '').toLowerCase()
  const name = (span.name || '').toLowerCase()
  const llmData = span.llm || {}

  const isLLM = kind === 'llm' || name.startsWith('llm:')
  const isRetriever = kind === 'retriever' || name.startsWith('retriever:')
  const isTool = kind === 'tool' || name.startsWith('tool:')
  const isEmbedding = kind === 'embedding' || name.startsWith('embedding:')
  const isGraphSnapshot = name.includes('knowledge_graph_snapshot') || name.includes('graph_snapshot')

  // ── LLM Detail ──
  if (isLLM) {
    const promptMessages = span.prompt_messages || llmData.prompt_messages || []
    const completion = span.completion || llmData.completion || span.response || span.output ||
      (span.outputs && typeof span.outputs === 'object' && span.outputs !== null ? span.outputs.completion : null) ||
      (typeof span.outputs === 'string' ? span.outputs : '') || ''
    const hasPrompt = Array.isArray(promptMessages) ? promptMessages.length > 0 : !!promptMessages
    const hasCompletion = !!completion

    return (
      <div className="p-3 space-y-3 bg-blue-50/30 border-t border-blue-100 animate-fade-in">
        {/* Model info strip */}
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <Bot size={12} className="text-blue-600" />
          <span className="font-mono font-semibold text-slate-700">{span.model || llmData.model || '—'}</span>
          <span className="text-slate-400">
            {span.input_tokens ?? llmData.input_tokens ?? 0} in / {span.output_tokens ?? llmData.output_tokens ?? 0} out
          </span>
          {(span.cost_usd ?? llmData.cost_usd) != null && (
            <span className="text-emerald-600 font-semibold">${(span.cost_usd ?? llmData.cost_usd ?? 0).toFixed(4)}</span>
          )}
          {(span.duration_ms || span.latency_ms) > 0 && (
            <span className="text-slate-400 font-mono">{((span.duration_ms || span.latency_ms) / 1000).toFixed(1)}s</span>
          )}
        </div>

        {/* Prompt Messages */}
        {hasPrompt && (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
              Prompt Messages {Array.isArray(promptMessages) ? `(${promptMessages.length})` : ''}
            </span>
            <div className="space-y-1.5">
              {Array.isArray(promptMessages)
                ? promptMessages.map((msg, i) => (
                    <MessageBubble key={i} role={msg.role || 'unknown'} content={msg.content || JSON.stringify(msg)} />
                  ))
                : <ContentBlock label="Input" content={typeof promptMessages === 'string' ? promptMessages : JSON.stringify(promptMessages, null, 2)} />
              }
            </div>
          </div>
        )}
        {!hasPrompt && span.inputs && (
          <ContentBlock label="Input" content={span.inputs} />
        )}

        {/* Completion */}
        {hasCompletion && (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Completion</span>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Bot size={11} className="text-emerald-700" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">assistant</span>
              </div>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed text-emerald-800 max-h-[400px] overflow-y-auto">
                {typeof completion === 'object' ? JSON.stringify(completion, null, 2) : String(completion)}
              </pre>
            </div>
          </div>
        )}
        {!hasCompletion && span.outputs && (
          <ContentBlock label="Output" content={span.outputs} />
        )}

        {!hasPrompt && !hasCompletion && !span.inputs && !span.outputs && (
          <p className="text-slate-400 text-xs italic">No prompt or completion data for this LLM span.</p>
        )}
      </div>
    )
  }

  // ── Retriever / RAG Detail ──
  if (isRetriever) {
    const retrieverData = span.retriever || {}
    const query = span.query || retrieverData.query || span.input || ''
    const documents = span.documents || span.retrieved_documents || retrieverData.documents || span.results || []

    return (
      <div className="p-3 space-y-3 bg-green-50/30 border-t border-green-100 animate-fade-in">
        {query && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Search size={11} className="text-violet-700" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">Query</span>
            </div>
            <pre className="font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed text-violet-800 max-h-[200px] overflow-y-auto">
              {typeof query === 'object' ? JSON.stringify(query, null, 2) : String(query)}
            </pre>
          </div>
        )}
        {Array.isArray(documents) && documents.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
              Retrieved Documents ({documents.length})
            </span>
            {documents.slice(0, 8).map((doc, i) => {
              const source = (typeof doc === 'object') ? (doc.source || (doc.metadata && doc.metadata.source) || '') : ''
              const score = (typeof doc === 'object') ? (doc.score ?? doc.relevance_score) : null
              const content = typeof doc === 'object'
                ? (doc.content || doc.text || doc.page_content || JSON.stringify(doc, null, 2))
                : String(doc)
              return (
                <div key={i} className="mb-2 rounded-lg border border-slate-200 bg-white p-2.5 border-l-4 border-l-violet-300">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold text-slate-600">#{i + 1}</span>
                    {score != null && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                        Score: {Number(score).toFixed(4)}
                      </span>
                    )}
                    {source && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                        {source}
                      </span>
                    )}
                  </div>
                  <pre className="font-mono text-[10px] bg-slate-50 p-2 rounded max-h-28 overflow-auto whitespace-pre-wrap break-words border border-slate-100 leading-relaxed">
                    {content}
                  </pre>
                </div>
              )
            })}
            {documents.length > 8 && (
              <p className="text-[10px] text-slate-400 italic">+{documents.length - 8} more documents</p>
            )}
          </div>
        )}
        {!query && (!documents || documents.length === 0) && span.inputs && (
          <ContentBlock label="Input" content={span.inputs} />
        )}
        {!documents?.length && span.outputs && (
          <ContentBlock label="Output" content={span.outputs} />
        )}
      </div>
    )
  }

  // ── Tool Detail ──
  if (isTool && !isGraphSnapshot) {
    const toolData = span.tool || {}
    const toolName = toolData.name || span.name || ''
    const toolInput = toolData.input || span.tool_input || span.inputs
    const toolOutput = toolData.output || span.tool_output || span.outputs

    return (
      <div className="p-3 space-y-2 bg-amber-50/30 border-t border-amber-100 animate-fade-in">
        {toolName && (
          <div className="flex items-center gap-2 text-[11px]">
            <Wrench size={12} className="text-amber-600" />
            <span className="font-mono font-semibold text-amber-800">{toolName}</span>
            {(span.duration_ms || span.latency_ms) > 0 && (
              <span className="text-slate-400 font-mono">{((span.duration_ms || span.latency_ms) / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
        {toolInput && <ContentBlock label="Tool Input" content={toolInput} />}
        {toolOutput && <ContentBlock label="Tool Output" content={toolOutput} />}
        {!toolInput && !toolOutput && (
          <p className="text-slate-400 text-xs italic">No input/output data for this tool span.</p>
        )}
      </div>
    )
  }

  // ── Graph Snapshot Detail ──
  if (isGraphSnapshot) {
    let outputs = span.outputs || span.tool?.output || {}
    if (typeof outputs === 'string') {
      try { outputs = JSON.parse(outputs) } catch { outputs = {} }
    }
    const entities = outputs.entities || []
    const relations = outputs.relations || []
    const events = outputs.events || []
    const entityCount = outputs.entity_count || entities.length
    const relationCount = outputs.relation_count || relations.length
    const eventCount = outputs.event_count || events.length

    // Group entities by type
    const typeGroups = {}
    for (const e of entities) {
      const t = e.type || 'Other'
      typeGroups[t] = (typeGroups[t] || 0) + 1
    }

    const ENTITY_COLORS = {
      Case: '#eab308', Person: '#3b82f6', Provider: '#10b981', Injury: '#ef4444',
      Vehicle: '#f59e0b', Treatment: '#8b5cf6', Facility: '#14b8a6', Statute: '#f97316',
      InsuranceCompany: '#ec4899', Event: '#06b6d4', Diagnosis: '#6366f1', Other: '#64748b',
    }

    return (
      <div className="p-3 space-y-3 bg-indigo-50/30 border-t border-indigo-100 animate-fade-in">
        {/* Stats */}
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <GitBranch size={12} className="text-indigo-600" />
          <span className="font-semibold text-slate-700">Knowledge Graph Snapshot</span>
          <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold text-[10px]">
            {entityCount} entities
          </span>
          <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold text-[10px]">
            {relationCount} relations
          </span>
          {eventCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 font-semibold text-[10px]">
              {eventCount} events
            </span>
          )}
        </div>

        {/* Entity type breakdown */}
        {Object.keys(typeGroups).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(typeGroups).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-white border border-slate-200 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ENTITY_COLORS[type] || ENTITY_COLORS.Other }} />
                {type} ({count})
              </span>
            ))}
          </div>
        )}

        {/* Entity list (first 15) */}
        {entities.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">
              Entities (top {Math.min(entities.length, 15)})
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
              {entities.slice(0, 15).map((ent, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-white rounded border border-slate-200 px-2 py-1 text-[10px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ENTITY_COLORS[ent.type] || ENTITY_COLORS.Other }} />
                  <span className="font-medium text-slate-700 truncate">{ent.label || ent.id}</span>
                  <span className="text-slate-400 text-[8px] uppercase shrink-0">{ent.type}</span>
                </div>
              ))}
            </div>
            {entities.length > 15 && (
              <p className="text-[9px] text-slate-400 mt-1 italic">+{entities.length - 15} more entities</p>
            )}
          </div>
        )}

        {/* Relation list (first 10) */}
        {relations.length > 0 && (
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 block">
              Relations (top {Math.min(relations.length, 10)})
            </span>
            <div className="space-y-0.5">
              {relations.slice(0, 10).map((rel, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] bg-white rounded border border-slate-200 px-2 py-1">
                  <span className="font-medium text-slate-700">{rel.from}</span>
                  <span className="text-indigo-500 font-mono text-[9px]">—{rel.type || 'RELATES_TO'}→</span>
                  <span className="font-medium text-slate-700">{rel.to}</span>
                </div>
              ))}
            </div>
            {relations.length > 10 && (
              <p className="text-[9px] text-slate-400 mt-1 italic">+{relations.length - 10} more relations</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Embedding Detail ──
  if (isEmbedding) {
    const embData = span.embedding || {}
    return (
      <div className="p-3 bg-cyan-50/30 border-t border-cyan-100 animate-fade-in">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <Database size={12} className="text-cyan-600" />
          {(span.embedding_model || embData.model) && <span className="font-mono font-semibold text-slate-700">{span.embedding_model || embData.model}</span>}
          {(span.embedding_count || embData.count) != null && <span className="text-slate-500">{span.embedding_count ?? embData.count} vectors</span>}
          {(span.embedding_dimensions || embData.dimensions) != null && <span className="text-slate-500">{span.embedding_dimensions ?? embData.dimensions}d</span>}
          {(span.input_tokens ?? embData.input_tokens) > 0 && <span className="text-slate-500">{span.input_tokens ?? embData.input_tokens} tokens</span>}
          {(span.cost_usd ?? embData.cost_usd) > 0 && (
            <span className="text-emerald-600 font-semibold">${Number(span.cost_usd ?? embData.cost_usd).toFixed(4)}</span>
          )}
        </div>
        {span.inputs && <ContentBlock label="Input" content={span.inputs} className="mt-2" />}
      </div>
    )
  }

  // ── Generic: show inputs/outputs ──
  if (span.inputs || span.outputs) {
    return (
      <div className="p-3 space-y-2 bg-slate-50/50 border-t border-slate-100 animate-fade-in">
        {span.inputs && <ContentBlock label="Input" content={span.inputs} />}
        {span.outputs && <ContentBlock label="Output" content={span.outputs} />}
      </div>
    )
  }

  return null
}

/* ──────────────── SpanRow (with expandable detail) ──────────────── */

function SpanRow({ span, depth = 0 }) {
  const [showDetail, setShowDetail] = useState(false)
  const kind = span.kind || 'chain'
  const name = span.name || ''
  const status = span.status || 'running'
  const duration = span.duration_ms || 0
  const style = KIND_STYLE[kind] || KIND_STYLE.chain
  const Icon = style.icon

  const hasDetail = kind === 'llm' || kind === 'retriever' || kind === 'tool' || kind === 'embedding' ||
    (name.includes('graph_snapshot') || name.includes('knowledge_graph_snapshot')) ||
    span.inputs || span.outputs || span.prompt_messages || span.llm?.prompt_messages || span.tool?.input

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-3 border-b border-slate-50 transition-colors cursor-pointer ${
          showDetail ? 'bg-slate-100/60' : 'hover:bg-slate-50/60'
        }`}
        style={{ paddingLeft: 12 + depth * 20 }}
        onClick={() => hasDetail && setShowDetail(!showDetail)}
      >
        {/* Expand indicator */}
        {hasDetail ? (
          showDetail
            ? <ChevronDown size={11} className="text-slate-400 shrink-0" />
            : <ChevronRight size={11} className="text-slate-400 shrink-0" />
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        <Icon size={12} className={style.text} />
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${style.bg} ${style.text}`}>
          {kind}
        </span>
        <span className="text-xs font-mono text-slate-700 flex-1 truncate">{name}</span>
        {hasDetail && (
          <span className="text-[9px] text-slate-400 shrink-0">
            {showDetail ? <EyeOff size={10} className="inline" /> : <Eye size={10} className="inline" />}
          </span>
        )}
        {status === 'running' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 animate-pulse">
            <Radio size={10} /> running
          </span>
        ) : status === 'error' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-red-500">
            <XCircle size={10} /> error
          </span>
        ) : (
          <CheckCircle size={12} className="text-green-500" />
        )}
        <span className="text-[10px] text-slate-400 w-16 text-right font-mono">
          {duration > 0 ? `${(duration / 1000).toFixed(1)}s` : '—'}
        </span>
      </div>
      {showDetail && <SpanDetailPanel span={span} />}
    </div>
  )
}

/* ──────────────── TraceCard ──────────────── */

function TraceCard({ trace, spans, isExpanded, onToggle }) {
  const isRunning = trace.status === 'running'
  const spanCount = spans.length
  const llmCalls = spans.filter(s => s.kind === 'llm').length
  const embCalls = spans.filter(s => s.kind === 'embedding').length
  const toolCalls = spans.filter(s => s.kind === 'tool').length
  const ragCalls = spans.filter(s => s.kind === 'retriever').length
  const graphSpans = spans.filter(s => {
    const n = (s.name || '').toLowerCase()
    return n.includes('knowledge_graph_snapshot') || n.includes('graph_snapshot')
  })

  let totalTokens = 0, totalCost = 0
  for (const s of spans) {
    const llm = s.llm || {}
    totalTokens += (llm.input_tokens || 0) + (llm.output_tokens || 0)
    totalCost += llm.cost_usd || s.cost_usd || 0
    if (s.embedding) {
      totalTokens += s.embedding.input_tokens || s.embedding.token_count || 0
      totalCost += s.embedding.cost_usd || 0
    }
  }

  const traceTok = trace.total_tokens || 0
  const traceCost = trace.total_cost_usd || 0
  const displayTokens = Math.max(totalTokens, traceTok)
  const displayCost = Math.max(totalCost, traceCost)

  const spanListRef = useRef(null)
  useEffect(() => {
    if (isExpanded && spanListRef.current) {
      spanListRef.current.scrollTop = spanListRef.current.scrollHeight
    }
  }, [spans.length, isExpanded])

  return (
    <div className={`rounded-xl border transition-all duration-200 ${isRunning
      ? 'border-brand-200 bg-white shadow-sm shadow-brand-100/40'
      : 'border-slate-200 bg-white/80'
      }`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50/60 transition-colors rounded-t-xl"
        onClick={onToggle}
      >
        {isExpanded
          ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
          : <ChevronRight size={16} className="text-slate-400 shrink-0" />
        }

        {/* Status dot */}
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-slate-300'}`} />

        {/* Trace identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 truncate">
              {trace.service_name || 'agent'}
            </span>
            {trace.product_id && trace.product_id !== 'default' && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px] font-medium">
                {trace.product_id}
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${isRunning
              ? 'bg-green-100 text-green-700'
              : trace.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'
              }`}>
              {trace.status || 'running'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{trace.trace_id}</span>
        </div>

        {/* Quick stats */}
        <div className="hidden sm:flex items-center gap-4 shrink-0 text-[11px]">
          <span className="flex items-center gap-1 text-slate-500">
            <Layers size={11} /> {spanCount}
          </span>
          <span className="flex items-center gap-1 text-blue-600">
            <MessageSquare size={11} /> {llmCalls}
          </span>
          {ragCalls > 0 && (
            <span className="flex items-center gap-1 text-green-600">
              <Search size={11} /> {ragCalls}
            </span>
          )}
          <span className="flex items-center gap-1 text-amber-600">
            <Wrench size={11} /> {toolCalls}
          </span>
          <span className="flex items-center gap-1 text-cyan-600">
            <Database size={11} /> {embCalls}
          </span>
          {graphSpans.length > 0 && (
            <span className="flex items-center gap-1 text-indigo-600">
              <GitBranch size={11} /> Graph
            </span>
          )}
          <span className="flex items-center gap-1 text-violet-600">
            <Zap size={11} /> {fmtTokens(displayTokens)}
          </span>
          <span className="flex items-center gap-1 text-emerald-600 font-medium">
            <DollarSign size={11} /> {fmtCost(displayCost)}
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <Clock size={11} /> {elapsed(trace.created_at)}
          </span>
        </div>
      </button>

      {/* Mobile stats row */}
      <div className="sm:hidden flex flex-wrap items-center gap-3 px-4 pb-2 text-[10px]">
        <span className="flex items-center gap-1 text-slate-500"><Layers size={10} /> {spanCount}</span>
        <span className="flex items-center gap-1 text-blue-600"><MessageSquare size={10} /> {llmCalls} LLM</span>
        <span className="flex items-center gap-1 text-green-600"><Search size={10} /> {ragCalls} RAG</span>
        <span className="flex items-center gap-1 text-amber-600"><Wrench size={10} /> {toolCalls} Tools</span>
        <span className="flex items-center gap-1 text-violet-600"><Zap size={10} /> {fmtTokens(displayTokens)}</span>
        <span className="flex items-center gap-1 text-emerald-600"><DollarSign size={10} /> {fmtCost(displayCost)}</span>
      </div>

      {/* Expanded: span timeline with detail views */}
      {isExpanded && (
        <div className="border-t border-slate-100">
          {/* Hint */}
          <div className="px-3 py-1.5 bg-slate-50/70 text-[10px] text-slate-400 border-b border-slate-100 flex items-center gap-1.5">
            <Eye size={10} />
            Click any span to view its details — LLM prompts, tool I/O, retrieved docs, graph snapshots
          </div>

          {spanCount === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              <Radio size={16} className="mx-auto mb-1 animate-pulse text-brand-400" />
              Waiting for spans...
            </div>
          ) : (
            <div ref={spanListRef} className="max-h-[600px] overflow-y-auto">
              {spans.map((s, i) => (
                <SpanRow key={s.span_id || i} span={s} />
              ))}
            </div>
          )}

          {/* Live totals bar */}
          <div className="flex items-center gap-4 px-4 py-2 bg-slate-50/70 border-t border-slate-100 text-[10px] text-slate-500">
            <span><strong className="text-slate-700">{spanCount}</strong> spans</span>
            <span><strong className="text-blue-700">{llmCalls}</strong> LLM</span>
            <span><strong className="text-green-700">{ragCalls}</strong> RAG</span>
            <span><strong className="text-amber-700">{toolCalls}</strong> tools</span>
            <span><strong className="text-cyan-700">{embCalls}</strong> embed</span>
            {graphSpans.length > 0 && <span><strong className="text-indigo-700">{graphSpans.length}</strong> graph</span>}
            <span className="ml-auto font-medium text-violet-700">{fmtTokens(displayTokens)} tokens</span>
            <span className="font-medium text-emerald-700">{fmtCost(displayCost)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ──────────────── Main Page ──────────────── */

export default function LiveMonitorPage() {
  const [traces, setTraces] = useState({})
  const [spanMap, setSpanMap] = useState({})
  const [connected, setConnected] = useState(false)
  const [monitoring, setMonitoring] = useState(false)
  const [expandedTraceId, setExpandedTraceId] = useState(null)
  const [productFilter, setProductFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [products, setProducts] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const [elapsedTick, setElapsedTick] = useState(0)

  const [autoScroll, setAutoScroll] = useState(true)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const notificationsRef = useRef(false)
  const [errorFlash, setErrorFlash] = useState(null)
  const traceListEndRef = useRef(null)
  const [traceArrivalLog, setTraceArrivalLog] = useState([])

  // Tick every 5s to re-render elapsed times
  useEffect(() => {
    const id = setInterval(() => setElapsedTick(t => t + 1), 5000)
    return () => clearInterval(id)
  }, [])

  // Load products for filter dropdown
  useEffect(() => {
    getProducts().then(r => {
      const prods = r?.data?.products || r?.data || []
      if (Array.isArray(prods)) setProducts(prods)
    }).catch(() => {})
  }, [])

  // Disconnect helper
  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnected(false)
    setMonitoring(false)
  }, [])

  // Connect helper
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setErrorMsg('')
    setMonitoring(true)

    const filters = {}
    if (productFilter) filters.product_id = productFilter
    if (serviceFilter) filters.service_name = serviceFilter
    const wsUrl = getGlobalLiveWsUrl(filters)

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setErrorMsg('')

        const activeParams = { limit: 30 }
        if (productFilter) activeParams.product_id = productFilter
        if (serviceFilter) activeParams.service_name = serviceFilter

        const loadSpansForTraces = (traceList) => {
          for (const t of traceList) {
            getSpans({ trace_id: t.trace_id, limit: 500 }).then(sr => {
              const list = sr?.data?.spans || []
              if (list.length) setSpanMap(prev => ({ ...prev, [t.trace_id]: list }))
            }).catch(() => {})
          }
        }

        // Load active (running) traces
        getActiveTraces(activeParams).then(r => {
          const active = r?.data?.traces || []
          if (active.length > 0) {
            const tMap = {}
            for (const t of active) { tMap[t.trace_id] = t }
            setTraces(prev => ({ ...prev, ...tMap }))
            loadSpansForTraces(active)
          }
        }).catch(() => {})

        // Also load recent completed traces so the monitor isn't empty
        const recentParams = { limit: 15 }
        if (productFilter) recentParams.product_id = productFilter
        if (serviceFilter) recentParams.service_name = serviceFilter
        getTraces(recentParams).then(r => {
          const recent = r?.data?.traces || []
          if (recent.length > 0) {
            const tMap = {}
            for (const t of recent) { tMap[t.trace_id] = t }
            setTraces(prev => ({ ...prev, ...tMap }))
            loadSpansForTraces(recent)
          }
        }).catch(() => {})
      }

      ws.onclose = () => {
        setConnected(false)
        if (wsRef.current === ws) {
          reconnectTimer.current = setTimeout(() => {
            if (wsRef.current === ws || !wsRef.current) connectWs()
          }, 3000)
        }
      }

      ws.onerror = () => {
        setConnected(false)
        setErrorMsg('Cannot connect to the backend WebSocket. Is the Cluco backend running on port 9410?')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'pong') return

          if (msg.type === 'span' && msg.trace_id) {
            const tid = msg.trace_id
            setTraces(prev => {
              if (prev[tid]) return prev
              setTraceArrivalLog(log => [...log.slice(-200), { ts: Date.now(), tid }])
              return {
                ...prev,
                [tid]: {
                  trace_id: tid,
                  product_id: msg.product_id || '',
                  service_name: msg.service_name || '',
                  session_id: msg.session_id || '',
                  status: 'running',
                  created_at: new Date().toISOString(),
                },
              }
            })
            if (msg.span) {
              setSpanMap(prev => {
                const existing = prev[tid] || []
                const idx = existing.findIndex(s => s.span_id === msg.span.span_id)
                if (idx >= 0) {
                  const updated = [...existing]
                  updated[idx] = { ...updated[idx], ...msg.span }
                  return { ...prev, [tid]: updated }
                }
                return { ...prev, [tid]: [...existing, msg.span] }
              })
            }
          }

          if (msg.type === 'trace_finalized' && msg.trace_id) {
            const finalStatus = msg.status || 'ok'
            setTraces(prev => {
              if (!prev[msg.trace_id]) return prev
              return {
                ...prev,
                [msg.trace_id]: { ...prev[msg.trace_id], status: finalStatus },
              }
            })
            if (finalStatus === 'error') {
              setErrorFlash(msg.trace_id)
              setTimeout(() => setErrorFlash(null), 3000)
              if (notificationsRef.current && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Cluco: Trace Error', {
                  body: `Trace ${msg.trace_id.slice(0, 12)}… finished with error`,
                  icon: '/favicon.ico',
                })
              }
            }
          }
        } catch (_e) { /* ignore */ }
      }
    } catch (_e) {
      setErrorMsg('Failed to create WebSocket connection.')
      setMonitoring(false)
    }
  }, [productFilter, serviceFilter])

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping')
      }
    }, 25000)
    return () => clearInterval(id)
  }, [])

  const { running, completed } = useMemo(() => {
    const all = Object.values(traces)
    const r = all.filter(t => t.status === 'running').sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    const c = all.filter(t => t.status !== 'running').sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    return { running: r, completed: c }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces, elapsedTick])

  // Auto-scroll to bottom when new traces arrive
  useEffect(() => {
    if (autoScroll && traceListEndRef.current) {
      traceListEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [traces, autoScroll])

  const handleClear = () => { setTraces({}); setSpanMap({}); setExpandedTraceId(null); setTraceArrivalLog([]) }

  const totalTraces = running.length + completed.length
  const totalSpans = Object.values(spanMap).reduce((s, arr) => s + arr.length, 0)

  // ── Computed Stats ──
  const liveStats = useMemo(() => {
    const all = Object.values(traces)
    const runningCount = all.filter(t => t.status === 'running').length
    const completedCount = all.filter(t => t.status !== 'running' && t.status !== 'error').length
    const errorCount = all.filter(t => t.status === 'error').length
    const total = all.length

    const completedTraces = all.filter(t => t.status !== 'running')
    const latencies = completedTraces
      .map(t => t.latency_ms || t.duration_ms || 0)
      .filter(l => l > 0)
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0

    const totalTokens = all.reduce((sum, t) => sum + (t.total_tokens || 0), 0)
    const totalCost = all.reduce((sum, t) => sum + (t.total_cost_usd || 0), 0)
    const errorRate = total > 0 ? (errorCount / total) * 100 : 0

    return { runningCount, completedCount, errorCount, total, avgLatency, totalTokens, totalCost, errorRate }
  }, [traces])

  // ── Sparkline Data (trace arrivals per 30s bucket over last 5 minutes) ──
  const sparklineData = useMemo(() => {
    const now = Date.now()
    const windowMs = 5 * 60 * 1000
    const bucketMs = 30_000
    const bucketCount = windowMs / bucketMs
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      time: now - (bucketCount - 1 - i) * bucketMs,
      count: 0,
    }))

    for (const entry of traceArrivalLog) {
      const age = now - entry.ts
      if (age > windowMs) continue
      const bucketIdx = Math.floor((bucketCount - 1) - age / bucketMs)
      if (bucketIdx >= 0 && bucketIdx < bucketCount) {
        buckets[bucketIdx].count++
      }
    }

    return buckets.map(b => ({
      label: new Date(b.time).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
      traces: b.count,
    }))
  }, [traceArrivalLog, elapsedTick])

  useEffect(() => { notificationsRef.current = notificationsEnabled }, [notificationsEnabled])

  // ── Enable browser notifications ──
  const toggleNotifications = useCallback(() => {
    if (!notificationsEnabled && 'Notification' in window) {
      Notification.requestPermission().then(perm => {
        setNotificationsEnabled(perm === 'granted')
      })
    } else {
      setNotificationsEnabled(prev => !prev)
    }
  }, [notificationsEnabled])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Live Agent Monitor"
        subtitle="Real-time auto-discovery — click Connect, then trigger a pipeline"
        icon={Radio}
      />

      {/* ── Connection Control Bar ── */}
      <div className="card p-5 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          {!monitoring ? (
            <button
              onClick={connectWs}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 shadow-sm shadow-brand-200 transition-all hover:shadow-md active:scale-[0.98]"
            >
              <PlugZap size={16} />
              Connect &amp; Monitor
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
            >
              <Unplug size={16} />
              Disconnect
            </button>
          )}

          {monitoring && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${connected
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
              }`}>
              {connected ? <Wifi size={13} /> : <WifiOff size={13} className="animate-pulse" />}
              {connected ? 'Connected' : 'Reconnecting...'}
            </div>
          )}

          {monitoring && (
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Activity size={12} className="text-brand-500" /> <strong className="text-slate-700">{running.length}</strong> running</span>
              <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> <strong className="text-slate-700">{completed.length}</strong> completed</span>
              <span className="flex items-center gap-1"><Layers size={12} /> <strong className="text-slate-700">{totalSpans}</strong> spans</span>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {monitoring && (
              <>
                <button
                  onClick={toggleNotifications}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    notificationsEnabled
                      ? 'text-brand-600 bg-brand-50 border-brand-200 hover:bg-brand-100'
                      : 'text-slate-500 bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                  title={notificationsEnabled ? 'Disable error notifications' : 'Enable browser notifications on errors'}
                >
                  {notificationsEnabled ? <Bell size={12} /> : <BellOff size={12} />}
                  {notificationsEnabled ? 'Alerts On' : 'Alerts'}
                </button>
                <button
                  onClick={() => setAutoScroll(prev => !prev)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    autoScroll
                      ? 'text-brand-600 bg-brand-50 border-brand-200 hover:bg-brand-100'
                      : 'text-slate-500 bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                  title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                >
                  {autoScroll ? <ArrowDownToLine size={12} /> : <Pause size={12} />}
                  {autoScroll ? 'Auto-scroll' : 'Paused'}
                </button>
              </>
            )}
            {totalTraces > 0 && (
              <button onClick={handleClear} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
        </div>

        {monitoring && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
            <Filter size={13} className="text-slate-400" />
            <span className="text-[11px] text-slate-400 font-medium">Filters:</span>
            <select
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-400"
              value={productFilter}
              onChange={e => {
                setProductFilter(e.target.value)
                if (monitoring) { setTimeout(() => { disconnect(); setTimeout(connectWs, 200) }, 0) }
              }}
            >
              <option value="">All Products</option>
              {products.map(p => (
                <option key={typeof p === 'string' ? p : p.product_id} value={typeof p === 'string' ? p : p.product_id}>
                  {typeof p === 'string' ? p : p.product_id}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Service name..."
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-600 w-36 focus:outline-none focus:ring-2 focus:ring-brand-400"
              value={serviceFilter}
              onChange={e => setServiceFilter(e.target.value)}
              onBlur={() => { if (monitoring) { disconnect(); setTimeout(connectWs, 200) } }}
              onKeyDown={e => { if (e.key === 'Enter' && monitoring) { disconnect(); setTimeout(connectWs, 200) } }}
            />
            <span className="text-[10px] text-slate-400">Enter to apply</span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">{errorMsg}</div>
        )}
      </div>

      {/* ── Error Flash Banner ── */}
      {errorFlash && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 animate-pulse">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700 font-medium">
            Trace <code className="font-mono text-xs bg-red-100 px-1.5 py-0.5 rounded">{errorFlash.slice(0, 16)}…</code> finished with an error
          </span>
        </div>
      )}

      {/* ── Real-Time Stats Bar ── */}
      {monitoring && totalTraces > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-5">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Total</div>
            <div className="text-xl font-bold text-slate-800">{liveStats.total}</div>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-green-500 mb-1 flex items-center gap-1"><Activity size={10} /> Running</div>
            <div className="text-xl font-bold text-green-700">{liveStats.runningCount}</div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500 mb-1 flex items-center gap-1"><CheckCircle size={10} /> Completed</div>
            <div className="text-xl font-bold text-blue-700">{liveStats.completedCount}</div>
          </div>
          <div className={`rounded-xl border p-3.5 shadow-sm ${liveStats.errorCount > 0 ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${liveStats.errorCount > 0 ? 'text-red-500' : 'text-slate-400'}`}><XCircle size={10} /> Errors</div>
            <div className={`text-xl font-bold ${liveStats.errorCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>{liveStats.errorCount}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Clock size={10} /> Avg Latency</div>
            <div className="text-xl font-bold text-slate-800">{liveStats.avgLatency > 0 ? `${(liveStats.avgLatency / 1000).toFixed(1)}s` : '—'}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Zap size={10} /> Tokens</div>
            <div className="text-xl font-bold text-slate-800">{fmtTokens(liveStats.totalTokens)}</div>
          </div>
          <div className={`rounded-xl border p-3.5 shadow-sm ${liveStats.errorRate > 10 ? 'border-red-200 bg-red-50' : liveStats.errorRate > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${liveStats.errorRate > 10 ? 'text-red-500' : liveStats.errorRate > 0 ? 'text-amber-500' : 'text-slate-400'}`}><AlertTriangle size={10} /> Error Rate</div>
            <div className={`text-xl font-bold ${liveStats.errorRate > 10 ? 'text-red-600' : liveStats.errorRate > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{liveStats.errorRate.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {/* ── Trace Arrival Sparkline ── */}
      {monitoring && traceArrivalLog.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-brand-500" />
            <span className="text-xs font-semibold text-slate-600">Trace Arrival Rate</span>
            <span className="text-[10px] text-slate-400">(last 5 min, 30s buckets)</span>
          </div>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <RechartsTooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                  formatter={(v) => [`${v} traces`, 'Arrivals']}
                  labelFormatter={(l) => l}
                />
                <Area type="monotone" dataKey="traces" stroke="#6366f1" strokeWidth={1.5} fill="url(#sparkGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Aggregate Judge Stats ── */}
      {monitoring && totalTraces > 0 && (() => {
        const allTracesList = [...running, ...completed]
        const withAssessments = allTracesList.filter(t => t.feedback && t.feedback.length > 0)
        const judgeStats = {}
        for (const t of allTracesList) {
          for (const fb of (t.feedback || [])) {
            if (!fb.key) continue
            if (!judgeStats[fb.key]) judgeStats[fb.key] = { total: 0, passed: 0 }
            judgeStats[fb.key].total++
            if (fb.value === 'True' || fb.value === 'true' || fb.score >= 50) judgeStats[fb.key].passed++
          }
        }
        const statEntries = Object.entries(judgeStats)
        if (statEntries.length === 0) return null
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
            {statEntries.map(([name, stats]) => {
              const pct = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0
              const color = pct >= 90 ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
                           pct >= 70 ? 'text-amber-600 bg-amber-50 border-amber-200' :
                           'text-red-600 bg-red-50 border-red-200'
              return (
                <div key={name} className={`rounded-xl border p-4 ${color}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">{name.replace(/_/g, ' ')}</div>
                  <div className="text-2xl font-bold">{pct}%</div>
                  <div className="text-[10px] mt-1">{stats.passed}/{stats.total} passed</div>
                </div>
              )
            })}
            <div className="rounded-xl border p-4 bg-slate-50 border-slate-200 text-slate-600">
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Total Traces</div>
              <div className="text-2xl font-bold text-slate-800">{totalTraces}</div>
              <div className="text-[10px] mt-1">{withAssessments.length} assessed</div>
            </div>
          </div>
        )
      })()}

      {/* ── Not monitoring ── */}
      {!monitoring && (
        <EmptyState
          icon={PlugZap}
          title="Ready to monitor"
          description="Click Connect & Monitor to start. Running and new agent pipelines will appear automatically. Click any span to inspect LLM prompts, tool I/O, retrieved documents, and graph snapshots in real-time."
        />
      )}

      {/* ── Running Traces ── */}
      {monitoring && running.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-sm font-semibold text-slate-700">Running ({running.length})</h2>
          </div>
          <div className="space-y-3">
            {running.map(t => (
              <TraceCard
                key={t.trace_id}
                trace={t}
                spans={spanMap[t.trace_id] || []}
                isExpanded={expandedTraceId === t.trace_id}
                onToggle={() => setExpandedTraceId(prev => prev === t.trace_id ? null : t.trace_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Completed Traces ── */}
      {monitoring && completed.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-500">Completed ({completed.length})</h2>
          </div>
          <div className="space-y-3">
            {completed.map(t => (
              <TraceCard
                key={t.trace_id}
                trace={t}
                spans={spanMap[t.trace_id] || []}
                isExpanded={expandedTraceId === t.trace_id}
                onToggle={() => setExpandedTraceId(prev => prev === t.trace_id ? null : t.trace_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── No traces yet ── */}
      {monitoring && totalTraces === 0 && (
        <EmptyState
          icon={Radio}
          title="Listening for agent activity..."
          description={
            connected
              ? `Live feed is connected${productFilter ? ` (filtered to ${productFilter})` : ''}. Start a pipeline and traces will appear here automatically. New spans stream in real-time.`
              : "Connecting to backend... Make sure the Cluco backend is running on port 9410."
          }
        />
      )}

      <div ref={traceListEndRef} />
    </div>
  )
}
