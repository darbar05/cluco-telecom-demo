import { useMemo, useEffect } from 'react'
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
import { Bot, User, Wrench, Database, Search, FileText } from 'lucide-react'

import 'reactflow/dist/style.css'

const NODE_WIDTH = 180
const NODE_HEIGHT = 52

function getLayoutedElements(nodes, edges, direction = 'LR') {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80 })

  nodes.forEach((node) => g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((edge) => {
    if (edge.source && edge.target && edge.source !== edge.target) {
      g.setEdge(edge.source, edge.target)
    }
  })

  try { dagre.layout(g) } catch (_) {}

  const layoutedNodes = nodes.map((node, i) => {
    const nodeWithPosition = g.node(node.id)
    let x = 0, y = 0
    if (nodeWithPosition && typeof nodeWithPosition.x === 'number' && typeof nodeWithPosition.y === 'number') {
      x = nodeWithPosition.x - NODE_WIDTH / 2
      y = nodeWithPosition.y - NODE_HEIGHT / 2
    } else {
      x = i * (NODE_WIDTH + 60)
      y = 0
    }
    return { ...node, position: { x, y } }
  })

  return { nodes: layoutedNodes, edges }
}

function classifySpan(span) {
  const name = (span.name || '').toLowerCase()
  const kind = (span.kind || '').toLowerCase()

  if (kind === 'agent' || name.startsWith('agent:')) {
    const agentName = name.replace(/^agent:/, '').trim()
    return { type: 'agent', label: agentName || 'Agent' }
  }
  if (kind === 'llm' || name.startsWith('llm:')) {
    const model = name.replace(/^llm:/, '').trim()
    return { type: 'llm', label: model || 'LLM' }
  }
  if (kind === 'tool' || name.startsWith('tool:')) {
    const toolName = name.replace(/^tool:/, '').trim()
    return { type: 'tool', label: toolName || 'Tool' }
  }
  if (kind === 'retriever' || name.startsWith('retriever:')) {
    const src = name.replace(/^retriever:/, '').trim()
    return { type: 'retriever', label: src || 'RAG Query' }
  }
  if (kind === 'embedding' || name.startsWith('embedding:')) {
    return { type: 'embedding', label: 'Embedding' }
  }
  if (name.startsWith('graph:')) {
    const op = name.replace(/^graph:/, '').trim()
    return { type: 'graph', label: op || 'Graph Op' }
  }
  if (kind === 'chain') {
    return { type: 'chain', label: name || 'Chain' }
  }
  return null
}

function buildFlowFromSpanTree(spans, flatSpans) {
  const nodes = []
  const edges = []
  const seen = new Set()

  const agentSpans = []

  function collectAgentSpans(spanList) {
    for (const sp of spanList || []) {
      if (!sp || typeof sp !== 'object') continue
      const cls = classifySpan(sp)
      if (cls && cls.type === 'agent') {
        agentSpans.push(sp)
      }
      collectAgentSpans(sp.children || [])
    }
  }

  collectAgentSpans(spans || [])

  if (agentSpans.length === 0 && flatSpans && flatSpans.length > 0) {
    for (const sp of flatSpans) {
      const cls = classifySpan(sp)
      if (cls && cls.type === 'agent') {
        agentSpans.push(sp)
      }
    }
  }

  agentSpans.sort((a, b) => (a.start_time_ns || 0) - (b.start_time_ns || 0))

  if (agentSpans.length === 0) {
    return buildFlowFromAllSpans(spans, flatSpans)
  }

  let lastNodeId = null
  for (let i = 0; i < agentSpans.length; i++) {
    const sp = agentSpans[i]
    const cls = classifySpan(sp)
    if (!cls) continue
    const nodeId = `agent-${i}`
    if (seen.has(cls.label)) {
      cls.label = `${cls.label} (${i + 1})`
    }
    seen.add(cls.label)

    nodes.push({
      id: nodeId,
      type: 'flowNode',
      data: { label: cls.label, type: cls.type, span: sp },
    })

    if (lastNodeId) {
      edges.push({
        id: `e-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      })
    }
    lastNodeId = nodeId
  }

  return { nodes, edges }
}

function buildFlowFromAllSpans(spans, flatSpans) {
  const nodes = []
  const edges = []
  const allSpans = []

  function collectAll(spanList) {
    for (const sp of spanList || []) {
      if (!sp || typeof sp !== 'object') continue
      allSpans.push(sp)
      collectAll(sp.children || [])
    }
  }

  collectAll(spans || [])

  if (allSpans.length === 0 && flatSpans) {
    allSpans.push(...flatSpans)
  }

  allSpans.sort((a, b) => (a.start_time_ns || 0) - (b.start_time_ns || 0))

  const significantSpans = allSpans.filter((sp) => {
    const cls = classifySpan(sp)
    return cls && cls.type !== 'embedding' && cls.type !== 'chain'
  })

  if (significantSpans.length === 0) return { nodes: [], edges: [] }

  let lastNodeId = null
  for (let i = 0; i < significantSpans.length; i++) {
    const sp = significantSpans[i]
    const cls = classifySpan(sp)
    if (!cls) continue
    const nodeId = `span-${i}`
    nodes.push({
      id: nodeId,
      type: 'flowNode',
      data: { label: cls.label, type: cls.type, span: sp },
    })
    if (lastNodeId) {
      edges.push({
        id: `e-${lastNodeId}-${nodeId}`,
        source: lastNodeId,
        target: nodeId,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
        style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      })
    }
    lastNodeId = nodeId
  }

  return { nodes, edges }
}

function FlowNode({ data }) {
  const colors = {
    user: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    agent: 'bg-brand-50 border-brand-300 text-brand-800',
    llm: 'bg-blue-50 border-blue-300 text-blue-800',
    tool: 'bg-violet-50 border-violet-300 text-violet-800',
    retriever: 'bg-amber-50 border-amber-300 text-amber-800',
    graph: 'bg-teal-50 border-teal-300 text-teal-800',
    chain: 'bg-slate-50 border-slate-300 text-slate-700',
    embedding: 'bg-gray-50 border-gray-300 text-gray-700',
  }
  const iconMap = {
    user: User,
    agent: Bot,
    llm: Bot,
    tool: Wrench,
    retriever: Search,
    graph: Database,
    chain: FileText,
    embedding: Database,
  }
  const Icon = iconMap[data?.type] || Bot
  const colorClass = colors[data?.type] || colors.agent

  return (
    <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border ${colorClass} shadow-card min-w-[150px]`}>
      <Handle type="target" position={Position.Left} id="in" className="!w-2 !h-2 !border-2 !bg-white !border-slate-300" />
      <Icon size={16} />
      <span className="font-medium text-sm truncate">{data?.label ?? 'Node'}</span>
      <Handle type="source" position={Position.Right} id="out" className="!w-2 !h-2 !border-2 !bg-white !border-slate-300" />
    </div>
  )
}

const nodeTypes = { flowNode: FlowNode }

export default function TraceFlowGraph({ trace }) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const spans = trace?.spans ?? []
    const flatSpans = trace?.flat_spans ?? []
    if (!spans.length && !flatSpans.length) return { nodes: [], edges: [] }

    const { nodes, edges } = buildFlowFromSpanTree(spans, flatSpans)
    if (nodes.length === 0) return { nodes: [], edges: [] }
    const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(nodes, edges)
    return { nodes: layouted, edges: layoutedEdges }
  }, [trace])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (initialNodes.length === 0) {
    return (
      <div className="py-4">
        <p className="text-slate-400 text-sm">No agent flow data available for this trace.</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="rounded-xl border border-slate-200 bg-surface-1 overflow-hidden" style={{ height: 420 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.5}
          defaultViewport={{ x: 0, y: 0, zoom: 0.9 }}
          attributionPosition="bottom-left"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#dde2ee" gap={16} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => {
              const t = n.data?.type
              if (t === 'user') return '#34d399'
              if (t === 'tool') return '#a78bfa'
              if (t === 'retriever') return '#fbbf24'
              if (t === 'graph') return '#2dd4bf'
              if (t === 'llm') return '#60a5fa'
              return '#748ffc'
            }}
            maskColor="rgba(241, 243, 249, 0.7)"
          />
        </ReactFlow>
      </div>
      <p className="text-xs text-slate-400 mt-2">Interactive graph: pan, zoom, and drag to explore the agent execution flow.</p>
    </div>
  )
}
