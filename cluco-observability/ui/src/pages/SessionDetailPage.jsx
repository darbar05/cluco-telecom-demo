import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getSessionDetail, getTrace } from '../api'
import { Users, Activity, Clock, DollarSign, Bot, Coins, ArrowLeft, Layers, ChevronDown, ChevronRight, Cpu, Calendar, Workflow, Play, Pause, SkipForward, SkipBack, RotateCcw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import StatusBadge from '../components/ui/StatusBadge'
import { SkeletonPage } from '../components/ui/Skeleton'
import { formatNumber, formatLatency, formatCost } from '../utils/format'
import TraceContent from '../components/TraceContent'
import AgentFlowGraph from '../components/AgentFlowGraph'
import { buildPlaybackTimeline } from '../utils/playbackTimeline'

function formatDateTime(isoStr) {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diffMs = now - d
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const yearStr = d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''

    let relative = ''
    if (diffMins < 1) relative = 'just now'
    else if (diffMins < 60) relative = `${diffMins}m ago`
    else if (diffHours < 24) relative = `${diffHours}h ago`
    else if (diffDays < 7) relative = `${diffDays}d ago`

    return { dateStr: `${dateStr}${yearStr}`, timeStr, relative }
  } catch {
    return '-'
  }
}

function SessionFlowPlayback({ traces, productId }) {
  const [fullTraces, setFullTraces] = useState([])
  const [loadingTraces, setLoadingTraces] = useState(false)

  useEffect(() => {
    if (!traces?.length) return
    setLoadingTraces(true)
    Promise.all(
      traces.map(t =>
        getTrace(t.trace_id)
          .then(r => r?.data ?? r)
          .catch(() => null)
      )
    ).then(results => {
      setFullTraces(results.filter(Boolean))
      setLoadingTraces(false)
    })
  }, [traces])

  const sessionTimeline = useMemo(() => {
    const allEvents = []
    for (let i = 0; i < fullTraces.length; i++) {
      const t = fullTraces[i]
      const tl = buildPlaybackTimeline(t)
      tl.forEach(ev => {
        allEvents.push({ ...ev, traceIndex: i, traceId: t.trace_id })
      })
    }
    allEvents.sort((a, b) => a.startTimeNs - b.startTimeNs)
    return allEvents
  }, [fullTraces])

  const [playbackIndex, setPlaybackIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const timerRef = useRef(null)

  const currentEvent = playbackIndex >= 0 && playbackIndex < sessionTimeline.length
    ? sessionTimeline[playbackIndex] : null

  const activeAgentIds = useMemo(() => {
    const ids = new Set()
    sessionTimeline.forEach(ev => ids.add(ev.agentId))
    return ids
  }, [sessionTimeline])

  const visitedAgentIds = useMemo(() => {
    if (playbackIndex < 0) return null
    const visited = new Set()
    for (let i = 0; i <= playbackIndex && i < sessionTimeline.length; i++) {
      visited.add(sessionTimeline[i].agentId)
    }
    return visited
  }, [playbackIndex, sessionTimeline])

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const handlePlay = useCallback(() => {
    if (sessionTimeline.length === 0) return
    setIsPlaying(true)
    if (playbackIndex < 0) setPlaybackIndex(0)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setPlaybackIndex(prev => {
        const next = prev < 0 ? 0 : prev + 1
        if (next >= sessionTimeline.length) {
          clearInterval(timerRef.current)
          setIsPlaying(false)
          return sessionTimeline.length - 1
        }
        return next
      })
    }, 2000 / speed)
  }, [sessionTimeline, speed, playbackIndex])

  const handlePause = useCallback(() => {
    setIsPlaying(false)
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  useEffect(() => {
    if (isPlaying) {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setPlaybackIndex(prev => {
          const next = prev + 1
          if (next >= sessionTimeline.length) {
            clearInterval(timerRef.current)
            setIsPlaying(false)
            return sessionTimeline.length - 1
          }
          return next
        })
      }, 2000 / speed)
    }
    return () => { if (timerRef.current && !isPlaying) clearInterval(timerRef.current) }
  }, [speed])

  if (loadingTraces) {
    return (
      <div className="card p-8 text-center">
        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-3"></div>
        <p className="text-sm text-slate-500">Loading traces for flow playback...</p>
      </div>
    )
  }

  if (sessionTimeline.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-slate-500">
        No agent spans found across session traces. Agent spans are emitted when LangGraph nodes are wrapped with observability instrumentation.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { handlePause(); setPlaybackIndex(prev => prev > 0 ? prev - 1 : 0) }}
              disabled={playbackIndex <= 0}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
            >
              <SkipBack size={14} />
            </button>
            {isPlaying ? (
              <button onClick={handlePause} className="p-1.5 rounded bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors">
                <Pause size={14} />
              </button>
            ) : (
              <button onClick={handlePlay} className="p-1.5 rounded bg-brand-50 text-brand-600 hover:bg-brand-100 transition-colors">
                <Play size={14} />
              </button>
            )}
            <button
              onClick={() => { handlePause(); setPlaybackIndex(prev => prev + 1 < sessionTimeline.length ? prev + 1 : prev) }}
              disabled={playbackIndex >= sessionTimeline.length - 1}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
            >
              <SkipForward size={14} />
            </button>
            <button
              onClick={() => { handlePause(); setPlaybackIndex(-1) }}
              className="p-1.5 rounded hover:bg-slate-100 transition-colors"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="text-xs text-slate-500 flex-shrink-0">
            Step {playbackIndex < 0 ? 0 : playbackIndex + 1} / {sessionTimeline.length}
          </div>

          <div className="flex-1 min-w-[120px]">
            <input
              type="range"
              min={-1}
              max={sessionTimeline.length - 1}
              value={playbackIndex}
              onChange={e => { handlePause(); setPlaybackIndex(Number(e.target.value)) }}
              className="w-full h-1 accent-brand-600 cursor-pointer"
            />
          </div>

          <select
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>

          {currentEvent && (
            <div className="text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded">
              <span className="font-medium">{currentEvent.agentId}</span>
              <span className="text-slate-400 ml-2">Trace #{(currentEvent.traceIndex ?? 0) + 1}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <div className={`${currentEvent ? 'w-3/5' : 'w-full'} transition-all`}>
          <div className="card overflow-hidden">
            <AgentFlowGraph
              productId={productId}
              activeAgents={playbackIndex < 0 ? activeAgentIds : null}
              playbackActiveId={currentEvent?.agentId || null}
              visitedAgentIds={visitedAgentIds}
              compact
              hideStats
            />
          </div>
        </div>

        {currentEvent && (
          <div className="w-2/5 card overflow-hidden p-4" style={{ maxHeight: 500 }}>
            <h4 className="text-sm font-semibold text-slate-700 mb-3">
              {currentEvent.agentId}
              <span className="text-2xs text-slate-400 ml-2 font-normal">
                Trace #{(currentEvent.traceIndex ?? 0) + 1}
              </span>
            </h4>
            {currentEvent.durationMs > 0 && (
              <div className="text-xs text-slate-500 mb-2">
                Duration: {formatLatency(currentEvent.durationMs, 1).display}
              </div>
            )}
            {currentEvent.totalTokens > 0 && (
              <div className="text-xs text-slate-500 mb-2">
                Tokens: {currentEvent.totalTokens.toLocaleString()}
                {currentEvent.totalCost > 0 && ` | Cost: $${currentEvent.totalCost.toFixed(4)}`}
              </div>
            )}
            {currentEvent.llmCalls?.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-600 mb-1">LLM Calls ({currentEvent.llmCalls.length})</div>
                {currentEvent.llmCalls.slice(0, 3).map((lc, i) => (
                  <div key={i} className="text-2xs text-slate-500 bg-slate-50 rounded p-2 mb-1">
                    {lc.model} — {lc.totalTokens} tokens
                  </div>
                ))}
              </div>
            )}
            {currentEvent.toolCalls?.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-600 mb-1">Tool Calls ({currentEvent.toolCalls.length})</div>
                {currentEvent.toolCalls.slice(0, 3).map((tc, i) => (
                  <div key={i} className="text-2xs text-slate-500 bg-slate-50 rounded p-2 mb-1">
                    {tc.toolName}
                  </div>
                ))}
              </div>
            )}
            {currentEvent.inputs && (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-600 mb-1">Input</div>
                <pre className="text-2xs text-slate-500 bg-slate-50 rounded p-2 max-h-[120px] overflow-auto whitespace-pre-wrap">
                  {typeof currentEvent.inputs === 'string' ? currentEvent.inputs : JSON.stringify(currentEvent.inputs, null, 2)}
                </pre>
              </div>
            )}
            {currentEvent.outputs && (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-600 mb-1">Output</div>
                <pre className="text-2xs text-slate-500 bg-slate-50 rounded p-2 max-h-[120px] overflow-auto whitespace-pre-wrap">
                  {typeof currentEvent.outputs === 'string' ? currentEvent.outputs : JSON.stringify(currentEvent.outputs, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


export default function SessionDetailPage() {
  const { sessionId } = useParams()
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTraceId, setSelectedTraceId] = useState(null)
  const [selectedTrace, setSelectedTrace] = useState(null)
  const [traceLoading, setTraceLoading] = useState(false)
  const [sessionTab, setSessionTab] = useState('traces')

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    getSessionDetail(sessionId).then((r) => {
      const data = r.data
      setSession(data)
      const traces = data?.traces || []
      if (traces.length === 1) {
        loadFullTrace(traces[0].trace_id)
      }
    })
      .catch((err) => {
        setSession(null)
        setError(err?.response?.status === 404 ? 'Session not found' : 'Failed to load session')
      })
      .finally(() => setLoading(false))
  }, [sessionId])

  const loadFullTrace = (traceId) => {
    if (selectedTraceId === traceId) {
      setSelectedTraceId(null)
      setSelectedTrace(null)
      return
    }
    setSelectedTraceId(traceId)
    setTraceLoading(true)
    setSelectedTrace(null)
    const requestedId = traceId
    getTrace(traceId)
      .then((r) => {
        const data = r?.data ?? r
        if (data?.error) {
          setSelectedTrace(null)
        } else {
          setSelectedTraceId((currentId) => {
            if (currentId === requestedId) {
              setSelectedTrace(data)
            }
            return currentId
          })
        }
      })
      .catch(() => {
        setSelectedTraceId((currentId) => {
          if (currentId === requestedId) {
            setSelectedTrace(null)
          }
          return currentId
        })
      })
      .finally(() => setTraceLoading(false))
  }

  if (loading) return <SkeletonPage />

  if (error) {
    return (
      <div className="animate-fade-in">
        <div className="mb-4">
          <Link to="/sessions" className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1">
            <ArrowLeft size={14} /> Back to Sessions
          </Link>
        </div>
        <div className="card p-12 text-center">
          <Users size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">{error}</h2>
          <p className="text-sm text-slate-500">The session ID "{sessionId}" could not be loaded.</p>
        </div>
      </div>
    )
  }

  const traces = session?.traces || []
  const totalCost = session?.total_cost_usd ?? traces.reduce((a, t) => a + (t.total_cost_usd || 0), 0)
  const totalTokens = session?.total_tokens ?? traces.reduce((a, t) => a + (t.total_tokens || 0), 0)
  const totalLatency = traces.reduce((a, t) => a + (t.latency_ms || 0), 0)
  const agentName = session?.service_name || session?.agent || traces[0]?.service_name || '-'

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={`Session ${(sessionId || '').length > 20 ? (sessionId || '').slice(0, 20) + '...' : (sessionId || '-')}`}
        subtitle={`Agent: ${agentName}`}
        icon={Users}
        breadcrumbs={[
          { label: 'Sessions', to: '/sessions' },
          { label: (sessionId || '').length > 20 ? (sessionId || '').slice(0, 20) + '...' : (sessionId || '-') },
        ]}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Traces" value={traces.length} icon={Activity} color="text-brand-600" />
        <StatCard label="Agent" value={agentName} icon={Bot} color="text-blue-600" />
        <StatCard label="Total Latency" value={formatLatency(totalLatency, 1).display} icon={Clock} color="text-amber-600" />
        <StatCard label="Tokens" value={formatNumber(totalTokens).display} tooltip={totalTokens.toLocaleString()} icon={Coins} color="text-violet-600" />
        <StatCard label="Total Cost" value={totalCost != null ? formatCost(totalCost).display : '-'} icon={DollarSign} color="text-emerald-600" />
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { id: 'traces', label: 'Traces', icon: Activity },
          { id: 'agent_flow', label: 'Agent Flow', icon: Workflow },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSessionTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              sessionTab === tab.id
                ? 'bg-brand-50 text-brand-700 border border-brand-200'
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {sessionTab === 'agent_flow' && (
        <SessionFlowPlayback
          traces={traces}
          productId={session?.product_id || traces[0]?.product_id || traces[0]?.metadata?.product_id}
        />
      )}

      {sessionTab === 'traces' && (
      <div className="space-y-4">
        {traces.length === 0 ? (
          <div className="card p-8 text-center text-slate-400 text-sm">No traces in this session.</div>
        ) : (
          traces.map((t) => {
            const dt = formatDateTime(t.created_at)
            const isObj = typeof dt === 'object'
            const isSelected = selectedTraceId === t.trace_id
            const traceSpanCount = t.span_count || t.total_spans || '-'

            return (
              <div key={t.trace_id} className="card overflow-hidden">
                <div
                  className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-brand-50 border-b border-brand-200' : 'hover:bg-surface-1'
                  }`}
                  onClick={() => loadFullTrace(t.trace_id)}
                >
                  <span className="text-slate-400 flex-shrink-0">
                    {isSelected ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <Activity size={14} className="text-brand-500 flex-shrink-0" />
                      <span className="font-mono text-xs font-medium text-brand-600 truncate">{t.trace_id}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    {isObj && (
                      <div className="flex items-center gap-2 ml-5">
                        <Calendar size={11} className="text-slate-400" />
                        <span className="text-xs text-slate-500">{dt.dateStr} {dt.timeStr}</span>
                        {dt.relative && <span className="text-2xs text-slate-400">({dt.relative})</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-6 flex-shrink-0 text-xs">
                    <div className="text-center">
                      <div className="font-mono font-medium text-slate-700">{formatLatency(t.latency_ms || 0, 1).display}</div>
                      <div className="text-2xs text-slate-400">Latency</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono font-medium text-slate-700">{formatNumber(t.total_tokens ?? 0).display}</div>
                      <div className="text-2xs text-slate-400">Tokens</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono font-medium text-emerald-600">
                        {t.total_cost_usd != null ? formatCost(t.total_cost_usd).display : '-'}
                      </div>
                      <div className="text-2xs text-slate-400">Cost</div>
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <div className="border-t border-slate-100">
                    {traceLoading ? (
                      <div className="p-8 text-center">
                        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin mb-3"></div>
                        <p className="text-sm text-slate-500">Loading trace details...</p>
                      </div>
                    ) : selectedTrace ? (
                      <div className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="bg-surface-1 rounded-lg p-3 text-center">
                            <Clock size={14} className="mx-auto text-amber-500 mb-1" />
                            <div className="text-sm font-semibold text-slate-700">{formatLatency(t.latency_ms || 0, 1).display}</div>
                            <div className="text-2xs text-slate-400">Duration</div>
                          </div>
                          <div className="bg-surface-1 rounded-lg p-3 text-center">
                            <Cpu size={14} className="mx-auto text-blue-500 mb-1" />
                            <div className="text-sm font-semibold text-slate-700">{formatNumber(selectedTrace.total_tokens ?? 0).display}</div>
                            <div className="text-2xs text-slate-400">Tokens</div>
                          </div>
                          <div className="bg-surface-1 rounded-lg p-3 text-center">
                            <DollarSign size={14} className="mx-auto text-emerald-500 mb-1" />
                            <div className="text-sm font-semibold text-emerald-600">
                              {selectedTrace.total_cost_usd != null ? formatCost(selectedTrace.total_cost_usd).display : '-'}
                            </div>
                            <div className="text-2xs text-slate-400">Cost</div>
                          </div>
                          <div className="bg-surface-1 rounded-lg p-3 text-center">
                            <Layers size={14} className="mx-auto text-violet-500 mb-1" />
                            <div className="text-sm font-semibold text-slate-700">{selectedTrace.flat_spans?.length || 0}</div>
                            <div className="text-2xs text-slate-400">Spans</div>
                          </div>
                        </div>

                        <TraceContent trace={selectedTrace} traceId={t.trace_id} />
                      </div>
                    ) : (
                      <div className="p-8 text-center text-slate-400 text-sm">
                        Failed to load trace details.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      )}
    </div>
  )
}
