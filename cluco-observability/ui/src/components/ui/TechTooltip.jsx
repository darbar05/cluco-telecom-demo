import { useState } from 'react'
import { HelpCircle } from 'lucide-react'

const TERM_DEFINITIONS = {
  tokens: 'Units of text that AI models process. Think of them like word fragments — a typical word is 1-2 tokens. More tokens = more processing.',
  spans: 'Individual steps the AI agent took to answer your question, like "read documents", "think about the answer", or "format the reply".',
  latency: 'The total time (in milliseconds) it took the agent to process the question and produce an answer.',
  llm: 'Large Language Model — the AI brain that reads, reasons, and writes responses. Examples: GPT-4, Claude.',
  rag: 'Retrieval-Augmented Generation — the agent looks up relevant documents before answering, like checking a reference manual.',
  trace: 'A complete record of everything the agent did to handle one question, from start to finish.',
  cost: 'The estimated dollar cost of the AI processing for this interaction, based on the tokens used.',
  routing: 'How the agent decides which path, tool, or sub-agent should handle a given request based on the query intent.',
  judge: 'An automated quality checker that reviews agent responses for accuracy, relevance, and safety.',
  feedback: 'Ratings and comments from users or reviewers about whether the agent response was helpful.',
}

export default function TechTooltip({ term, children }) {
  const [show, setShow] = useState(false)
  const definition = TERM_DEFINITIONS[term?.toLowerCase()] || `Technical term: ${term}`

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      <HelpCircle
        size={11}
        style={{ color: '#94a3b8', cursor: 'help', flexShrink: 0 }}
      />
      {show && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
          marginBottom: 6, padding: '8px 12px', background: '#1e293b', color: '#e2e8f0',
          borderRadius: 8, fontSize: 11, lineHeight: 1.5, width: 240, zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', pointerEvents: 'none',
        }}>
          {definition}
          <div style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #1e293b',
          }} />
        </div>
      )}
    </span>
  )
}
