import { useState } from 'react'
import { compareTraces } from '../api'
import { GitCompare, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable } from '../components/ui/Skeleton'

function DiffBadge({ value, unit = '', invert = false }) {
  if (value === 0 || value === undefined) return <span className="text-slate-400 text-xs"><Minus size={12} className="inline" /> 0</span>
  const isPositive = invert ? value < 0 : value > 0
  const color = isPositive ? 'text-red-600' : 'text-green-600'
  const Icon = value > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={12} />
      {value > 0 ? '+' : ''}{typeof value === 'number' && Math.abs(value) < 1 ? value.toFixed(4) : Math.round(value)}{unit}
    </span>
  )
}

function TraceCard({ data, label }) {
  if (!data) return null
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{label}</h3>
      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div><span className="text-slate-500">Trace ID:</span> <span className="font-mono">{data.trace_id?.slice(0, 16)}...</span></div>
        <div><span className="text-slate-500">Status:</span> <span className={`font-medium ${data.status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{data.status}</span></div>
        <div><span className="text-slate-500">Tokens:</span> <span className="font-medium">{(data.total_tokens || 0).toLocaleString()}</span></div>
        <div><span className="text-slate-500">Cost:</span> <span className="font-medium text-emerald-600">${(data.total_cost_usd || 0).toFixed(4)}</span></div>
        <div><span className="text-slate-500">Latency:</span> <span className="font-medium">{((data.latency_ms || 0) / 1000).toFixed(1)}s</span></div>
        <div><span className="text-slate-500">Spans:</span> <span className="font-medium">{data.span_count || 0}</span></div>
      </div>
      {data.agents && Object.keys(data.agents).length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-slate-600 mb-2">Agents</h4>
          <div className="space-y-1">
            {Object.entries(data.agents).map(([name, info]) => (
              <div key={name} className="flex justify-between items-center text-xs py-1 border-b border-slate-100 last:border-0">
                <span className="font-mono text-slate-700">{name}</span>
                <div className="flex gap-3 text-slate-500">
                  <span>{info.tokens} tok</span>
                  <span className="text-emerald-600">${(info.cost_usd || 0).toFixed(4)}</span>
                  <span>{((info.duration_ms || 0) / 1000).toFixed(1)}s</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function TraceComparisonPage() {
  const [traceA, setTraceA] = useState('')
  const [traceB, setTraceB] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCompare = async () => {
    if (!traceA.trim() || !traceB.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await compareTraces(traceA.trim(), traceB.trim())
      if (res.data.error) {
        setError(res.data.error)
        setResult(null)
      } else {
        setResult(res.data)
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Comparison failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const diff = result?.diff

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Trace Comparison"
        subtitle="Compare two pipeline runs side by side"
        icon={GitCompare}
      />

      <div className="card p-5 mb-6">
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <div className="flex-1 w-full">
            <label className="text-xs font-medium text-slate-600 mb-1 block">Trace A</label>
            <input
              type="text"
              value={traceA}
              onChange={e => setTraceA(e.target.value)}
              placeholder="Enter trace ID..."
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
          </div>
          <ArrowRight size={20} className="text-slate-400 hidden sm:block mb-2" />
          <div className="flex-1 w-full">
            <label className="text-xs font-medium text-slate-600 mb-1 block">Trace B</label>
            <input
              type="text"
              value={traceB}
              onChange={e => setTraceB(e.target.value)}
              placeholder="Enter trace ID..."
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
          </div>
          <button
            onClick={handleCompare}
            disabled={loading || !traceA.trim() || !traceB.trim()}
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Comparing...' : 'Compare'}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      </div>

      {loading && <SkeletonTable rows={4} cols={4} />}

      {result && (
        <>
          {diff && (
            <div className="card p-5 mb-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Differences (A - B)</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">Tokens</div>
                  <DiffBadge value={diff.tokens_diff} invert />
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">Cost</div>
                  <DiffBadge value={diff.cost_diff} unit="$" invert />
                </div>
                <div className="text-center">
                  <div className="text-xs text-slate-500 mb-1">Latency</div>
                  <DiffBadge value={diff.latency_diff} unit="ms" invert />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TraceCard data={result.trace_a} label="Trace A" />
            <TraceCard data={result.trace_b} label="Trace B" />
          </div>
        </>
      )}
    </div>
  )
}
