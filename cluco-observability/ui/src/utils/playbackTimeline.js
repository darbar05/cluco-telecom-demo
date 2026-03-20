export function buildPlaybackTimeline(trace) {
  const allSpans = []
  const walk = (list) => {
    for (const sp of list || []) {
      if (!sp || typeof sp !== 'object') continue
      allSpans.push(sp)
      walk(sp.children || [])
    }
  }
  walk(trace?.spans ?? [])
  if (allSpans.length === 0 && trace?.flat_spans) {
    allSpans.push(...trace.flat_spans)
  }

  allSpans.sort((a, b) => (a.start_time_ns || 0) - (b.start_time_ns || 0))

  const agentMap = new Map()

  for (const sp of allSpans) {
    const name = (sp.name || '').toLowerCase()
    const kind = (sp.kind || '').toLowerCase()

    let agentId = null
    if (kind === 'agent' || name.startsWith('agent:')) {
      agentId = name.replace(/^agent:/, '').replace(/^graph:/, '').trim()
    } else if (sp.metadata?.agent) {
      agentId = sp.metadata.agent.toLowerCase().trim()
    } else if (sp.parent_agent) {
      agentId = sp.parent_agent.toLowerCase().trim()
    }

    if (!agentId && (kind === 'llm' || kind === 'tool' || kind === 'retriever')) {
      if (sp.parent_span_id) {
        const parentSpan = allSpans.find(p => p.span_id === sp.parent_span_id)
        if (parentSpan) {
          const pKind = (parentSpan.kind || '').toLowerCase()
          const pName = (parentSpan.name || '').toLowerCase()
          if (pKind === 'agent' || pName.startsWith('agent:')) {
            agentId = pName.replace(/^agent:/, '').replace(/^graph:/, '').trim()
          }
        }
      }
      if (!agentId) {
        for (const parent of allSpans) {
          const pKind = (parent.kind || '').toLowerCase()
          const pName = (parent.name || '').toLowerCase()
          if (pKind === 'agent' || pName.startsWith('agent:')) {
            const pStart = parent.start_time_ns || 0
            const pEnd = parent.end_time_ns || Infinity
            const sStart = sp.start_time_ns || 0
            if (sStart >= pStart && sStart <= pEnd) {
              agentId = pName.replace(/^agent:/, '').replace(/^graph:/, '').trim()
              break
            }
          }
        }
      }
    }

    if (!agentId) continue

    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, {
        agentId,
        startTimeNs: sp.start_time_ns || 0,
        endTimeNs: sp.end_time_ns || 0,
        llmCalls: [],
        toolCalls: [],
        ragQueries: [],
        totalTokens: 0,
        totalCost: 0,
        durationMs: 0,
        status: 'ok',
      })
    }

    const entry = agentMap.get(agentId)
    entry.endTimeNs = Math.max(entry.endTimeNs, sp.end_time_ns || 0)

    if (kind === 'agent') {
      entry.durationMs = sp.duration_ms || 0
      entry.status = sp.status || 'ok'
      if (sp.inputs) entry.inputs = sp.inputs
      if (sp.outputs) entry.outputs = sp.outputs
    }

    if (kind === 'llm') {
      const llm = sp.llm || {}
      entry.llmCalls.push({
        model: sp.model || llm.model || 'unknown',
        promptMessages: sp.prompt_messages || llm.prompt_messages || [],
        completion: sp.completion || llm.completion || '',
        inputTokens: sp.input_tokens || llm.input_tokens || 0,
        outputTokens: sp.output_tokens || llm.output_tokens || 0,
        totalTokens: sp.total_tokens || llm.total_tokens || 0,
        costUsd: sp.cost_usd || llm.cost_usd || 0,
        durationMs: sp.duration_ms || sp.latency_ms || 0,
        startTimeNs: sp.start_time_ns || 0,
      })
      entry.totalTokens += (sp.total_tokens || llm.total_tokens || 0)
      entry.totalCost += (sp.cost_usd || llm.cost_usd || 0)
    }

    if (kind === 'tool') {
      const tool = sp.tool || {}
      entry.toolCalls.push({
        toolName: sp.tool_name || tool.tool_name || sp.name?.replace(/^tool:/, '').trim() || 'unknown',
        toolInput: sp.tool_input || tool.tool_input || sp.inputs || null,
        toolOutput: sp.tool_output || tool.tool_output || sp.outputs || null,
        durationMs: sp.duration_ms || sp.latency_ms || 0,
        status: sp.status || 'ok',
        startTimeNs: sp.start_time_ns || 0,
      })
    }

    if (kind === 'retriever') {
      const ret = sp.retriever || {}
      entry.ragQueries.push({
        query: ret.query || sp.inputs?.query || '',
        documents: ret.documents || [],
        scores: ret.retrieval_scores || [],
        durationMs: sp.duration_ms || sp.latency_ms || 0,
        startTimeNs: sp.start_time_ns || 0,
      })
    }
  }

  const timeline = [...agentMap.values()]
  timeline.sort((a, b) => a.startTimeNs - b.startTimeNs)

  return timeline
}

export function getTimelineRange(timeline) {
  if (!timeline.length) return { startNs: 0, endNs: 0, durationMs: 0 }
  const startNs = timeline[0].startTimeNs
  const endNs = Math.max(...timeline.map(e => e.endTimeNs))
  return { startNs, endNs, durationMs: (endNs - startNs) / 1e6 }
}
