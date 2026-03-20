import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Bot, RefreshCw } from 'lucide-react'
import AgentFlowGraph from '../components/AgentFlowGraph'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { getProducts, getPipelines } from '../api'

export default function AgentFlowPage() {
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    Promise.all([
      getProducts().then(r => r?.data?.products || []).catch(() => []),
      getPipelines().then(r => (r?.data?.pipelines || []).map(p => p?.product_id || p).filter(Boolean)).catch(() => []),
    ]).then(([traceProducts, pipelineProducts]) => {
      const merged = [...new Set([...pipelineProducts, ...traceProducts])]
      setProducts(merged)
      if (merged.length > 0 && !selectedProduct) {
        setSelectedProduct(merged[0])
      }
    })
  }, [])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setRefreshKey(k => k + 1)
    // Brief visual feedback
    setTimeout(() => setRefreshing(false), 800)
  }, [])

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Agent Architecture"
        subtitle="Registered via SDK integration — reflects the project's agent graph"
        icon={GitBranch}
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50"
              title="Refresh agent architecture"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            {products.length > 0 && (
              <FilterBar>
                <FilterSelect
                  value={selectedProduct}
                  onChange={setSelectedProduct}
                  options={products.map(p => ({ value: p, label: p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }))}
                  placeholder="Select project"
                />
              </FilterBar>
            )}
          </div>
        }
      />
      <div className="card overflow-hidden">
        {selectedProduct ? (
          <AgentFlowGraph productId={selectedProduct} refreshKey={refreshKey} />
        ) : (
          <div className="p-8 text-center text-slate-500">
            <Bot size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="font-medium">No projects found</p>
            <p className="text-sm mt-1">Register a pipeline or run a trace to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
