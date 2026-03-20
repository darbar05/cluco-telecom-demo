import { useMemo, useState, useCallback } from 'react'
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow'
import dagre from 'dagre'
import { Bot, ArrowRight, Zap, Wrench, Search, Clock } from 'lucide-react'
import { formatLatency } from '../utils/format'
import 'reactflow/dist/style.css'

const PALETTE = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#14b8a6', '#3b82f6', '#f97316',
]

function AgentNode({ data }) {
  const isStart = data.nodeType === 'start'
  const isEnd = data.nodeType === 'end'
  const isAgent = data.nodeType === 'agent'
  const isActive = data.active

  if (isStart || isEnd) {
    return (
      <div className={`px-4 py-2 rounded-full border-2 text-xs font-bold ${isStart ? 'bg-emerald-50 border-emerald-400 text-emerald-700' : 'bg-slate-100 border-slate-400 text-slate-600'}`}>
        {isStart ? <Handle type="source" position={Position.Right} className="!bg-emerald-500" /> : null}
        {isEnd ? <Handle type="target" position={Position.Left} className="!bg-slate-400" /> : null}
        {data.label}
      </div>
    )
  }

  return (
    <div
      className={`rounded-lg border-2 shadow-sm min-w-[160px] transition-all ${isActive ? 'ring-2 ring-brand-400 ring-offset-2' : ''}`}
      style={{ borderColor: data.color || '#6366f1', backgroundColor: `${data.color || '#6366f1'}10` }}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Bot size={12} style={{ color: data.color }} />
          <span className="text-xs font-semibold text-slate-800 truncate">{data.label}</span>
        </div>
        <div className="flex items-center gap-2 text-2xs text-slate-500">
          {data.latency != null && (
            <span className="flex items-center gap-0.5">
              <Clock size={9} /> {formatLatency(data.latency, 1).display}
            </span>
          )}
          {data.kind && <span className="px-1 py-0.5 rounded bg-slate-100 text-slate-500 uppercase text-2xs">{data.kind}</span>}
        </div>
        {data.routingDecision && (
          <div className="mt-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-2xs text-amber-700 truncate">
            Routed: {data.routingDecision}
          </div>
        )}
      </div>
    </div>
  )
}

const nodeTypes = { agentNode: AgentNode }

function buildGraphFromSpans(spans) {
  if (!spans || spans.length === 0) return { nodes: [], edges: [] }

  const flatSpans = []
  function flatten(spanList, parentId = null) {
    for (const s of (spanList || [])) {
      flatSpans.push({ ...s, _parentId: parentId || s.parent_span_id })
      if (s.children?.length) flatten(s.children, s.span_id)
    }
  }
  flatten(spans)

  const agentSpans = flatSpans.filter(s =>
    s.kind === 'agent' || s.kind === 'chain' || (s.name || '').startsWith('agent:')
  )

  if (agentSpans.length === 0) {
    const topSpans = flatSpans.filter(s => !s._parentId || s._parentId === flatSpans[0]?.span_id)
    if (topSpans.length === 0) return { nodes: [], edges: [] }
    agentSpans.push(...topSpans.slice(0, 10))
  }

  const sorted = [...agentSpans].sort((a, b) => (a.start_time_ns || 0) - (b.start_time_ns || 0))
  const nodes = []
  const edges = []
  const colorMap = {}
  let colorIdx = 0

  nodes.push({
    id: '__start__',
    type: 'agentNode',
    data: { label: 'START', nodeType: 'start' },
    position: { x: 0, y: 0 },
  })

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    const name = (s.name || '').replace(/^agent:/, '') || `span-${i}`
    if (!colorMap[name]) {
      colorMap[name] = PALETTE[colorIdx % PALETTE.length]
      colorIdx++
    }

    let routingDecision = null
    const out = s.outputs || s.output
    if (typeof out === 'string' && out.length < 80) routingDecision = out
    else if (typeof out === 'object' && out) {
      const val = out.routing_decision || out.agent_type || out.selected_agent || out.classification
      if (val) routingDecision = String(val)
    }

    nodes.push({
      id: s.span_id || `agent-${i}`,
      type: 'agentNode',
      data: {
        label: name,
        kind: s.kind,
        color: colorMap[name],
        latency: s.latency_ms ?? s.duration_ms,
        nodeType: 'agent',
        routingDecision,
        inputs: s.inputs || s.input,
        outputs: s.outputs || s.output,
      },
      position: { x: 0, y: 0 },
    })
  }

  nodes.push({
    id: '__end__',
    type: 'agentNode',
    data: { label: 'END', nodeType: 'end' },
    position: { x: 0, y: 0 },
  })

  if (sorted.length > 0) {
    edges.push({
      id: 'e-start-0',
      source: '__start__',
      target: sorted[0].span_id || 'agent-0',
      animated: true,
      style: { stroke: '#94a3b8' },
    })
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    const isParallel = current.end_time_ns && next.start_time_ns &&
      (current.end_time_ns > next.start_time_ns + 500_000_000)

    edges.push({
      id: `e-${i}-${i + 1}`,
      source: current.span_id || `agent-${i}`,
      target: next.span_id || `agent-${i + 1}`,
      animated: true,
      style: {
        stroke: isParallel ? '#3b82f6' : '#94a3b8',
        strokeDasharray: isParallel ? '5 5' : undefined,
      },
      label: isParallel ? 'parallel' : undefined,
      labelStyle: { fontSize: 10, fill: '#64748b' },
    })
  }

  if (sorted.length > 0) {
    edges.push({
      id: 'e-last-end',
      source: sorted[sorted.length - 1].span_id || `agent-${sorted.length - 1}`,
      target: '__end__',
      animated: true,
      style: { stroke: '#94a3b8' },
    })
  }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 60 })
  for (const n of nodes) {
    g.setNode(n.id, { width: 180, height: n.data.nodeType === 'start' || n.data.nodeType === 'end' ? 36 : 70 })
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  for (const n of nodes) {
    const pos = g.node(n.id)
    n.position = { x: pos.x - 90, y: pos.y - 35 }
  }

  return { nodes, edges }
}

export default function TraceAgentGraph({ trace }) {
  const [selectedNode, setSelectedNode] = useState(null)

  const { nodes, edges } = useMemo(() => {
    const spans = trace?.spans || []
    return buildGraphFromSpans(spans)
  }, [trace])

  const onNodeClick = useCallback((_, node) => {
    if (node.data.nodeType === 'start' || node.data.nodeType === 'end') return
    setSelectedNode(prev => prev?.id === node.id ? null : node)
  }, [])

  if (nodes.length <= 2) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        <p className="font-medium text-slate-700 mb-1">No agent interactions to visualize.</p>
        <p>This trace does not contain identifiable agent or chain spans.</p>
      </div>
    )
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1" style={{ height: 400 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} color="#f1f5f9" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => n.data?.color || '#94a3b8'}
            maskColor="rgba(0,0,0,0.05)"
            style={{ height: 60, width: 100 }}
          />
        </ReactFlow>
      </div>

      {selectedNode && (
        <div className="w-80 border border-slate-200 rounded-lg bg-white overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <Bot size={14} style={{ color: selectedNode.data.color }} />
              <span className="font-semibold text-sm text-slate-800">{selectedNode.data.label}</span>
            </div>
            {selectedNode.data.kind && (
              <span className="text-2xs text-slate-400 uppercase">{selectedNode.data.kind}</span>
            )}
          </div>
          <div className="p-4 text-xs overflow-auto max-h-[320px] space-y-3">
            {selectedNode.data.latency != null && (
              <div>
                <span className="text-2xs font-semibold text-slate-400 uppercase">Latency</span>
                <p className="text-slate-700 font-mono">{formatLatency(selectedNode.data.latency, 2).display}</p>
              </div>
            )}
            {selectedNode.data.routingDecision && (
              <div>
                <span className="text-2xs font-semibold text-slate-400 uppercase">Routing Decision</span>
                <p className="text-amber-700 bg-amber-50 px-2 py-1 rounded">{selectedNode.data.routingDecision}</p>
              </div>
            )}
            {selectedNode.data.inputs && (
              <div>
                <span className="text-2xs font-semibold text-slate-400 uppercase">Input</span>
                <pre className="text-slate-600 bg-slate-50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap break-words">
                  {typeof selectedNode.data.inputs === 'string' ? selectedNode.data.inputs : JSON.stringify(selectedNode.data.inputs, null, 2)}
                </pre>
              </div>
            )}
            {selectedNode.data.outputs && (
              <div>
                <span className="text-2xs font-semibold text-slate-400 uppercase">Output</span>
                <pre className="text-slate-600 bg-slate-50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap break-words">
                  {typeof selectedNode.data.outputs === 'string' ? selectedNode.data.outputs : JSON.stringify(selectedNode.data.outputs, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
