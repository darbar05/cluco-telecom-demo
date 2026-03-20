import { useState, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Handle,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from 'reactflow'
import dagre from 'dagre'
import { Bot, Play, Square, Zap, FileText, Search, Shield, PenTool, CheckCircle, BookOpen, DollarSign, AlertTriangle, ClipboardCheck } from 'lucide-react'
import { getAgentArchitecture } from '../api'
import EmptyState from './ui/EmptyState'
import { SkeletonTable } from './ui/Skeleton'

import 'reactflow/dist/style.css'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

const PALETTE = [
  { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', dot: '#3b82f6' },
  { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-800', dot: '#6366f1' },
  { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-800', dot: '#8b5cf6' },
  { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800', dot: '#f97316' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', dot: '#10b981' },
  { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-800', dot: '#14b8a6' },
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', dot: '#f59e0b' },
  { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', dot: '#f43f5e' },
  { bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-800', dot: '#06b6d4' },
  { bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-800', dot: '#8b5cf6' },
  { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', dot: '#0ea5e9' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', text: 'text-fuchsia-800', dot: '#d946ef' },
  { bg: 'bg-pink-50', border: 'border-pink-300', text: 'text-pink-800', dot: '#ec4899' },
  { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-800', dot: '#64748b' },
  { bg: 'bg-lime-50', border: 'border-lime-300', text: 'text-lime-800', dot: '#84cc16' },
  { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800', dot: '#ef4444' },
]

const ICON_MAP = {
  planner: FileText,
  plan: FileText,
  extract: Search,
  document: Search,
  entity: Zap,
  relation: Zap,
  negligence: Shield,
  check: Shield,
  validate: Shield,
  biography: BookOpen,
  bio: BookOpen,
  medical: PenTool,
  liability: AlertTriangle,
  damage: DollarSign,
  cost: DollarSign,
  review: CheckCircle,
  quality: ClipboardCheck,
  intro: PenTool,
  demand: DollarSign,
  write: PenTool,
  writer: PenTool,
  generate: FileText,
  docx: FileText,
  output: FileText,
}

const DEFAULT_COLOR = { bg: 'bg-brand-50', border: 'border-brand-300', text: 'text-brand-800', dot: '#4c6ef5' }

function getAgentColor(agentId, index) {
  return PALETTE[index % PALETTE.length] || DEFAULT_COLOR
}

function getAgentIcon(agentId) {
  const lower = (agentId || '').toLowerCase()
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (lower.includes(key)) return icon
  }
  return Bot
}

export function formatLabel(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getLayoutedElements(nodes, edges) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((edge) => {
    if (edge.source && edge.target && edge.source !== edge.target) {
      g.setEdge(edge.source, edge.target)
    }
  })

  try { dagre.layout(g) } catch (_) {}

  const layoutedNodes = nodes.map((node, i) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: pos && typeof pos.x === 'number'
        ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
        : { x: i * (NODE_WIDTH + 60), y: 0 },
    }
  })

  return { nodes: layoutedNodes, edges }
}

function FlowNode({ data }) {
  const colors = data?.colors || DEFAULT_COLOR
  const Icon = data?.icon || Bot
  const dimmed = data?.dimmed
  const isPlaybackActive = data?.isPlaybackActive
  const isPlaybackVisited = data?.isPlaybackVisited

  const isStart = data?.agentId === '__start__'
  const isEnd = data?.agentId === '__end__'

  if (isStart || isEnd) {
    const startDimmed = dimmed && isStart
    const endDimmed = dimmed && isEnd
    return (
      <div
        className={`flex items-center justify-center gap-2 px-4 py-3 rounded-full border-2 shadow-card transition-all ${
          isStart
            ? (startDimmed ? 'bg-gray-100 border-gray-300 text-gray-400' : 'bg-emerald-100 border-emerald-400 text-emerald-800')
            : (endDimmed ? 'bg-gray-100 border-gray-300 text-gray-400' : 'bg-slate-100 border-slate-400 text-slate-800')
        }`}
        style={{ minWidth: 100, opacity: dimmed ? 0.4 : 1 }}
      >
        {isStart && <Handle type="source" position={Position.Right} id="out" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-emerald-400" />}
        {isEnd && <Handle type="target" position={Position.Left} id="in" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-slate-400" />}
        {isStart ? <Play size={16} /> : <Square size={16} />}
        <span className="font-semibold text-sm">{isStart ? 'START' : 'END'}</span>
      </div>
    )
  }

  if (dimmed && !isPlaybackVisited) {
    return (
      <div
        className="flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-400 shadow-sm transition-all"
        style={{ minWidth: NODE_WIDTH, opacity: 0.45 }}
      >
        <Handle type="target" position={Position.Left} id="in" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-gray-300" />
        <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-100">
          <Icon size={16} className="text-gray-400" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-medium text-sm truncate leading-tight text-gray-400">{data?.label ?? 'Agent'}</span>
          {data?.isParallel && (
            <span className="text-2xs opacity-50 leading-tight">parallel</span>
          )}
        </div>
        <Handle type="source" position={Position.Right} id="out" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-gray-300" />
      </div>
    )
  }

  const pulseClass = isPlaybackActive ? 'playback-pulse' : ''
  const visitedClass = isPlaybackVisited && !isPlaybackActive ? 'opacity-70' : ''

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border-2 ${colors.bg} ${colors.border} ${colors.text} shadow-card transition-all ${pulseClass} ${visitedClass}`}
      style={{
        minWidth: NODE_WIDTH,
        ...(isPlaybackActive ? { boxShadow: `0 0 16px 4px ${colors.dot}44`, borderWidth: 3 } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} id="in" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-slate-300" />
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colors.bg}`}>
        <Icon size={16} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-sm truncate leading-tight">{data?.label ?? 'Agent'}</span>
        {data?.assessments && Object.keys(data.assessments).length > 0 && (
          <div className="flex gap-1 flex-wrap mt-0.5">
            {Object.entries(data.assessments).map(([key, info]) => (
              <span key={key} className="text-2xs px-1 py-0 rounded bg-white/60" title={`${key}: ${info.true_pct}% true (${info.total} total)`}>
                {key.slice(0, 8)}: <span className={info.true_pct >= 70 ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>{info.true_pct}%</span>
              </span>
            ))}
          </div>
        )}
        {data?.isParallel && (
          <span className="text-2xs opacity-70 leading-tight">parallel</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!w-2.5 !h-2.5 !border-2 !bg-white !border-slate-300" />
    </div>
  )
}

const nodeTypes = { flowNode: FlowNode }

function normalizeArchData(apiData) {
  if (!apiData?.nodes?.length) return null

  const hasStartEnd = apiData.nodes.some(n => n.id === '__start__' || n.id === '__end__')

  const nodes = hasStartEnd
    ? apiData.nodes
    : [
        { id: '__start__', label: 'START', type: 'start' },
        ...apiData.nodes,
        { id: '__end__', label: 'END', type: 'end' },
      ]

  let edges = apiData.edges || []
  if (!hasStartEnd) {
    const hasStartEdge = edges.some(e => e.source === '__start__')
    const hasEndEdge = edges.some(e => e.target === '__end__')
    if (!hasStartEdge && nodes.length > 1) {
      const firstAgent = nodes.find(n => n.id !== '__start__' && n.id !== '__end__')
      if (firstAgent) edges = [{ source: '__start__', target: firstAgent.id }, ...edges]
    }
    if (!hasEndEdge && nodes.length > 1) {
      const lastAgent = [...nodes].reverse().find(n => n.id !== '__start__' && n.id !== '__end__')
      if (lastAgent) edges = [...edges, { source: lastAgent.id, target: '__end__' }]
    }
  }

  return {
    nodes,
    edges,
    parallel_groups: apiData.parallel_groups || [],
  }
}

function buildReactFlowElements(archData, activeAgents, colorMap, playbackActiveId, visitedAgentIds) {
  if (!archData?.nodes?.length) return { nodes: [], edges: [] }

  const hasHighlight = activeAgents && activeAgents.size > 0
  const hasPlayback = !!playbackActiveId

  const parallelAgents = new Set()
  for (const group of (archData.parallel_groups || [])) {
    for (const agent of group) {
      parallelAgents.add(agent)
    }
  }

  const activeWithTerminals = hasHighlight
    ? new Set([...activeAgents, '__start__', '__end__'])
    : null

  const rfNodes = archData.nodes.map(n => ({
    id: n.id,
    type: 'flowNode',
    data: {
      label: n.label || formatLabel(n.id),
      agentId: n.id,
      nodeType: n.type,
      isParallel: parallelAgents.has(n.id),
      dimmed: hasPlayback
        ? (n.id !== '__start__' && n.id !== '__end__' && !visitedAgentIds?.has(n.id) && n.id !== playbackActiveId)
        : (hasHighlight && !activeWithTerminals.has(n.id)),
      colors: colorMap[n.id] || DEFAULT_COLOR,
      icon: getAgentIcon(n.id),
      isPlaybackActive: hasPlayback && n.id === playbackActiveId,
      isPlaybackVisited: hasPlayback && visitedAgentIds?.has(n.id),
      assessments: n.assessments || {},
    },
  }))

  const rfEdges = (archData.edges || []).map((e, i) => {
    const edgeActive = hasHighlight
      && activeWithTerminals.has(e.source)
      && activeWithTerminals.has(e.target)

    const isParallel = e.type === 'parallel'
    const isConditional = e.type === 'conditional'

    let stroke = '#94a3b8'
    let strokeWidth = 1.5
    let animated = isParallel
    let labelText = isParallel ? 'fan-out' : (e.label || (e.transition_count ? `${e.transition_count}x (${e.transition_rate || 0}%)` : undefined))

    if (hasHighlight) {
      if (edgeActive) {
        stroke = isParallel ? '#4c6ef5' : isConditional ? '#f59e0b' : '#10b981'
        strokeWidth = 2.5
        animated = true
      } else {
        stroke = '#d1d5db'
        strokeWidth = 1
        animated = false
        labelText = undefined
      }
    } else {
      stroke = isParallel ? '#4c6ef5' : isConditional ? '#f59e0b' : '#94a3b8'
      strokeWidth = isParallel ? 2 : 1.5
    }

    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'default',
      animated,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: hasHighlight && !edgeActive ? '#d1d5db' : stroke,
      },
      style: { stroke, strokeWidth },
      label: labelText,
      labelStyle: {
        fontSize: 10,
        fill: hasHighlight && !edgeActive ? '#d1d5db' : '#64748b',
      },
    }
  })

  return getLayoutedElements(rfNodes, rfEdges)
}

export default function AgentFlowGraph({ productId, activeAgents, pipelineData, compact, hideStats, hideHeader, playbackActiveId, visitedAgentIds, refreshKey }) {
  const [apiData, setApiData] = useState(null)
  const [loading, setLoading] = useState(!pipelineData)
  const [error, setError] = useState(null)

  // Re-fetch every time productId, pipelineData, or refreshKey changes.
  // refreshKey allows parent components to force a re-fetch (e.g. refresh button).
  useEffect(() => {
    if (pipelineData) {
      setApiData(pipelineData)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const pid = productId && productId !== 'all' ? productId : undefined
    getAgentArchitecture(pid)
      .then(r => {
        setApiData(r.data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [productId, pipelineData, refreshKey])

  const archData = useMemo(() => normalizeArchData(apiData), [apiData])

  const colorMap = useMemo(() => {
    if (!archData?.nodes) return {}
    const map = {}
    let idx = 0
    for (const n of archData.nodes) {
      if (n.id !== '__start__' && n.id !== '__end__') {
        map[n.id] = getAgentColor(n.id, idx)
        idx++
      }
    }
    return map
  }, [archData])

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    return buildReactFlowElements(archData, activeAgents, colorMap, playbackActiveId, visitedAgentIds)
  }, [archData, activeAgents, colorMap, playbackActiveId, visitedAgentIds])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (loading) {
    return <SkeletonTable rows={3} cols={4} />
  }

  if (error || !archData || archData.nodes?.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No Agent Architecture Found"
        message={
          error
            ? `Could not load architecture: ${error}`
            : "No agent architecture registered yet. Use tracer.register_agent_architecture() in your SDK integration to register your project's agent graph."
        }
      />
    )
  }

  const agentCount = archData.nodes.filter(n => n.id !== '__start__' && n.id !== '__end__').length
  const activeCount = activeAgents ? activeAgents.size : 0
  const parallelCount = (archData.parallel_groups || []).reduce((sum, g) => sum + g.length, 0)
  const edgeCount = (archData.edges || []).length
  const graphHeight = compact ? 400 : 500
  const archSource = apiData?.source

  return (
    <div className="w-full">
      {!hideStats && (
        <div className="flex items-center gap-6 px-6 py-3 border-b border-slate-200 bg-surface-1">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-brand-600" />
            <span className="text-sm font-medium text-slate-700">
              {activeAgents ? `${activeCount} / ${agentCount} Agents Active` : `${agentCount} Agents`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            <span className="text-sm font-medium text-slate-700">{edgeCount} Connections</span>
          </div>
          {parallelCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1">
                {[1,2,3].map(i => <div key={i} className="w-2 h-2 rounded-full bg-brand-400 border border-white" />)}
              </div>
              <span className="text-sm font-medium text-slate-700">{parallelCount} Parallel Agents</span>
            </div>
          )}
          {archSource && !hideStats && (
            <div className="ml-auto">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                archSource === 'registered'
                  ? 'bg-emerald-100 text-emerald-700'
                  : archSource === 'traces'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
              }`}>
                {archSource === 'registered' ? 'SDK Registered' : archSource === 'traces' ? 'Discovered from Traces' : 'Unknown'}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={compact ? '' : 'rounded-b-xl overflow-hidden'} style={{ height: graphHeight }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          attributionPosition="bottom-left"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#dde2ee" gap={16} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => {
              const id = n.data?.agentId
              if (n.data?.dimmed) return '#d1d5db'
              if (id === '__start__') return '#34d399'
              if (id === '__end__') return '#94a3b8'
              return colorMap[id]?.dot || '#4c6ef5'
            }}
            maskColor="rgba(241, 243, 249, 0.7)"
            style={{ border: '1px solid #e2e8f0', borderRadius: 8 }}
          />
        </ReactFlow>
      </div>

      <div className="px-6 py-3 border-t border-slate-200 bg-surface-1">
        <div className="flex items-center gap-6 text-xs text-slate-500 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-slate-400 rounded" />
            <span>Sequential</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-brand-500 rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #4c6ef5 0, #4c6ef5 4px, transparent 4px, transparent 8px)' }} />
            <span>Parallel (fan-out / fan-in)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-amber-400 rounded" style={{ backgroundImage: 'repeating-linear-gradient(90deg, #f59e0b 0, #f59e0b 4px, transparent 4px, transparent 8px)' }} />
            <span>Conditional (revise)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Play size={12} className="text-emerald-500" />
            <span>Start</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Square size={12} className="text-slate-500" />
            <span>End</span>
          </div>
          {activeAgents && (
            <>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded border-2 border-blue-300 bg-blue-50" />
                <span>Active in trace</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded border-2 border-dashed border-gray-300 bg-gray-50 opacity-50" />
                <span>Not in trace</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
