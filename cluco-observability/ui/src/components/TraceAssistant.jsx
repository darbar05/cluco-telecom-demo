import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, X, Bug, Gauge, BarChart3, Loader2, ArrowLeftRight, FileSearch, Shield } from 'lucide-react'
import { debugTraceAssistant } from '../api'
import MarkdownRenderer from './MarkdownRenderer'

const SUGGESTED_QUESTIONS = [
  { icon: Bug, text: 'Debug the error in this trace.', color: 'text-red-500' },
  { icon: Gauge, text: 'What is the performance bottleneck in this trace?', color: 'text-amber-500' },
  { icon: BarChart3, text: 'How to measure the quality of my agent with traces?', color: 'text-blue-500' },
  { icon: ArrowLeftRight, text: 'Was the query routed to the correct handler? Analyze the routing decision.', color: 'text-violet-500' },
  { icon: FileSearch, text: 'What documents were retrieved and were they relevant to the question?', color: 'text-emerald-500' },
  { icon: Shield, text: 'Are there any safety or PII concerns in this trace response?', color: 'text-orange-500' },
]

export default function TraceAssistant({ traceId, isOpen, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const askQuestion = async (question) => {
    if (!question.trim() || loading) return

    setMessages(prev => [...prev, { role: 'user', content: question }])
    setInput('')
    setLoading(true)

    try {
      const res = await debugTraceAssistant(traceId, question, false)
      const analysis = res.data?.analysis || 'No analysis returned.'
      setMessages(prev => [...prev, { role: 'assistant', content: analysis }])
    } catch (e) {
      const errMsg = e.response?.data?.detail || e.message || 'Failed to analyze trace.'
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    askQuestion(input)
  }

  if (!isOpen) return null

  return (
    <div className="w-[380px] border-l border-slate-200 bg-white flex flex-col h-full shrink-0">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-violet-50 to-purple-50">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-500" />
          <span className="font-semibold text-sm text-slate-800">Cluco Assistant</span>
          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">Beta</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Sparkles size={32} className="mx-auto text-violet-400 mb-2" />
              <p className="text-sm text-slate-600">Ask questions about your traces, evaluations, and more.</p>
            </div>
            <div className="space-y-2">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => askQuestion(q.text)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <q.icon size={14} className={`${q.color} mt-0.5 shrink-0`} />
                    <span className="text-xs text-slate-700 group-hover:text-violet-700">{q.text}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`${msg.role === 'user' ? 'flex justify-end' : ''}`}>
            {msg.role === 'user' ? (
              <div className="bg-brand-600 text-white px-3 py-2 rounded-lg rounded-br-sm max-w-[90%] text-xs">
                {msg.content}
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-700 leading-relaxed">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={12} className="text-violet-500" />
                  <span className="text-2xs font-semibold text-violet-600 uppercase">Analysis</span>
                </div>
                <MarkdownRenderer content={msg.content} size="xs" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-violet-600">
            <Loader2 size={14} className="animate-spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="mt-1.5 text-2xs text-slate-400 text-center">
          {traceId?.slice(0, 16)}...
        </div>
      </form>
    </div>
  )
}
