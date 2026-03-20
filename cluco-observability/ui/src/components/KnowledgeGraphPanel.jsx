import { useMemo, useEffect, useCallback } from 'react'
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
import { Database, GitBranch, Circle } from 'lucide-react'

import 'reactflow/dist/style.css'

const NODE_WIDTH = 160
const NODE_HEIGHT = 48

const ENTITY_COLORS = {
  Case: { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-900', dot: '#eab308' },
  Person: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', dot: '#3b82f6' },
  Provider: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', dot: '#10b981' },
  Injury: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-800', dot: '#ef4444' },
  Vehicle: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', dot: '#f59e0b' },
  Treatment: { bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-800', dot: '#8b5cf6' },
  Facility: { bg: 'bg-teal-50', border: 'border-teal-300', text: 'text-teal-800', dot: '#14b8a6' },
  Statute: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800', dot: '#f97316' },
  InsuranceCompany: { bg: 'bg-pink-50', border: 'border-pink-300', text: 'text-pink-800', dot: '#ec4899' },
  Event: { bg: 'bg-cyan-50', border: 'border-cyan-300', text: 'text-cyan-800', dot: '#06b6d4' },
  Diagnosis: { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-800', dot: '#6366f1' },
  Road: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-800', dot: '#6b7280' },
  ImpactPoint: { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', dot: '#f43f5e' },
  Direction: { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', dot: '#0ea5e9' },
  BodyRegion: { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', text: 'text-fuchsia-800', dot: '#d946ef' },
  Other: { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700', dot: '#64748b' },
}

function getColorForType(type) {
  return ENTITY_COLORS[type] || ENTITY_COLORS.Other
}

function getLayoutedElements(nodes, edges) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))

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
      x = (i % 6) * (NODE_WIDTH + 40)
      y = Math.floor(i / 6) * (NODE_HEIGHT + 40)
    }
    return { ...node, position: { x, y } }
  })

  return { nodes: layoutedNodes, edges }
}

function EntityNode({ data }) {
  const colors = getColorForType(data?.entityType)
  const label = data?.label || 'Unknown'
  const entityType = data?.entityType || 'Other'

  return (
    <div className={`px-3 py-2 rounded-lg border-2 shadow-sm ${colors.bg} ${colors.border} min-w-[120px] max-w-[200px]`}>
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0`} style={{ backgroundColor: colors.dot }} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold truncate ${colors.text}`}>{label}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide">{entityType}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  )
}

const nodeTypes = { entity: EntityNode }

function extractGraphData(trace) {
  const spans = trace?.flat_spans ?? []
  const treeSpans = trace?.spans ?? []

  function findSnapshotSpans(spanList) {
    const found = []
    for (const sp of spanList || []) {
      if (!sp || typeof sp !== 'object') continue
      const name = sp.name || ''
      if (name.includes('knowledge_graph_snapshot') || name.includes('graph_snapshot')) {
        found.push(sp)
      }
      if (sp.children) {
        found.push(...findSnapshotSpans(sp.children))
      }
    }
    return found
  }

  const snapshotSpans = [
    ...findSnapshotSpans(treeSpans),
    ...spans.filter(s => {
      const n = s.name || ''
      return n.includes('knowledge_graph_snapshot') || n.includes('graph_snapshot')
    }),
  ]

  if (snapshotSpans.length === 0) return null

  const snapshot = snapshotSpans[0]
  let outputs = snapshot.outputs || snapshot.tool?.output || {}
  if (typeof outputs === 'string') {
    try { outputs = JSON.parse(outputs) } catch { outputs = {} }
  }

  const entities = outputs.entities || []
  const relations = outputs.relations || []
  const events = outputs.events || []
  const stats = outputs.graph_stats || {}

  return {
    entities,
    relations,
    events,
    entityCount: outputs.entity_count || entities.length,
    relationCount: outputs.relation_count || relations.length,
    eventCount: outputs.event_count || events.length,
    caseId: outputs.case_id || '',
    stats,
  }
}

function buildGraphElements(graphData) {
  if (!graphData) return { nodes: [], edges: [] }

  const nodes = []
  const edges = []
  const entityIds = new Set()
  const caseId = graphData.caseId || ''

  const makeNodeKey = (entityId, entityCaseId) => {
    const cid = entityCaseId || caseId
    return cid ? `${cid}::${entityId}` : entityId
  }

  const entityIdToNodeKey = {}

  for (const entity of graphData.entities) {
    const rawId = entity.id || ''
    if (!rawId) continue
    const nodeKey = makeNodeKey(rawId, entity.case_id)
    if (entityIds.has(nodeKey)) continue
    entityIds.add(nodeKey)
    entityIdToNodeKey[rawId] = nodeKey
    nodes.push({
      id: nodeKey,
      type: 'entity',
      data: {
        label: entity.label || rawId,
        entityType: entity.type || 'Other',
        caseId: entity.case_id || caseId,
        entityId: rawId,
      },
      position: { x: 0, y: 0 },
    })
  }

  for (const rel of graphData.relations) {
    const rawSource = rel.from || ''
    const rawTarget = rel.to || ''
    if (!rawSource || !rawTarget || rawSource === rawTarget) continue
    const source = entityIdToNodeKey[rawSource] || rawSource
    const target = entityIdToNodeKey[rawTarget] || rawTarget
    if (!entityIds.has(source) || !entityIds.has(target)) continue

    edges.push({
      id: `${source}-${rel.type || 'RELATES_TO'}-${target}`,
      source,
      target,
      label: rel.type || 'RELATES_TO',
      type: 'smoothstep',
      animated: false,
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      labelStyle: { fontSize: 9, fill: '#64748b', fontWeight: 500 },
      labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.9 },
      labelBgPadding: [4, 2],
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 12, height: 12 },
    })
  }

  if (nodes.length > 0) {
    return getLayoutedElements(nodes, edges)
  }
  return { nodes, edges }
}

function GraphStats({ graphData }) {
  if (!graphData) return null

  const typeGroups = {}
  for (const e of graphData.entities) {
    const t = e.type || 'Other'
    typeGroups[t] = (typeGroups[t] || 0) + 1
  }

  return (
    <div className="flex flex-wrap gap-4 mb-4 p-3 bg-surface-1 rounded-lg border border-slate-200">
      <div className="flex items-center gap-2">
        <Database size={14} className="text-slate-500" />
        <span className="text-xs text-slate-500">Entities:</span>
        <span className="text-sm font-semibold text-slate-700">{graphData.entityCount}</span>
      </div>
      <div className="flex items-center gap-2">
        <GitBranch size={14} className="text-slate-500" />
        <span className="text-xs text-slate-500">Relations:</span>
        <span className="text-sm font-semibold text-slate-700">{graphData.relationCount}</span>
      </div>
      {graphData.eventCount > 0 && (
        <div className="flex items-center gap-2">
          <Circle size={14} className="text-slate-500" />
          <span className="text-xs text-slate-500">Events:</span>
          <span className="text-sm font-semibold text-slate-700">{graphData.eventCount}</span>
        </div>
      )}
      <div className="border-l border-slate-200 pl-4 flex flex-wrap gap-2">
        {Object.entries(typeGroups).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
          const colors = getColorForType(type)
          return (
            <span key={type} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.dot }} />
              {type} ({count})
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function KnowledgeGraphPanel({ trace }) {
  const graphData = useMemo(() => extractGraphData(trace), [trace])
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraphElements(graphData),
    [graphData],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  if (!graphData) {
    return (
      <div className="text-center py-12">
        <Database size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500 text-sm">No knowledge graph snapshot found in this trace.</p>
        <p className="text-slate-400 text-xs mt-1">Graph snapshots are captured during entity/relation extraction.</p>
      </div>
    )
  }

  if (initialNodes.length === 0) {
    return (
      <div className="text-center py-12">
        <Database size={32} className="mx-auto text-slate-300 mb-3" />
        <p className="text-slate-500 text-sm">Knowledge graph snapshot has no entities to display.</p>
      </div>
    )
  }

  return (
    <div>
      <GraphStats graphData={graphData} />
      <div className="rounded-lg border border-slate-200 overflow-hidden" style={{ height: 500 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e2e8f0" gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => {
              const colors = getColorForType(n.data?.entityType)
              return colors.dot
            }}
            maskColor="rgba(248, 250, 252, 0.7)"
            style={{ border: '1px solid #e2e8f0' }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

export { extractGraphData }
