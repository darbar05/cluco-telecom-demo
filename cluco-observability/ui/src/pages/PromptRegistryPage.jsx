import { useState, useEffect, useRef, useCallback } from 'react'
import { getPromptTemplates, getPromptTemplate, getPromptTemplateVersions, getPromptVersionDetail, createPromptTemplate, createPromptVersion, comparePromptVersions, optimizePrompt, getOptimizationRun, getDatasets, getEvaluators, getPromptVersions, getProducts, getPipelines } from '../api'
import { FileText, ArrowLeft, GitCompare, ChevronRight, Sparkles, Loader2, Radio, Clock, Hash, AlertTriangle, CheckCircle, XCircle, Trophy } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import MarkdownRenderer from '../components/MarkdownRenderer'

export default function PromptRegistryPage() {
  const [activeTab, setActiveTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPrompt, setSelectedPrompt] = useState(null)
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [versionDetail, setVersionDetail] = useState(null)
  const [compareMode, setCompareMode] = useState(false)
  const [compareVersionA, setCompareVersionA] = useState(null)
  const [compareVersionB, setCompareVersionB] = useState(null)
  const [compareData, setCompareData] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showNewVersion, setShowNewVersion] = useState(false)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [showOptimize, setShowOptimize] = useState(false)
  const [optimizeDatasetId, setOptimizeDatasetId] = useState('')
  const [optimizeEvaluatorId, setOptimizeEvaluatorId] = useState('')
  const [optimizeMaxIter, setOptimizeMaxIter] = useState(4)
  const [optimizeModel, setOptimizeModel] = useState('gpt-4o')
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeResult, setOptimizeResult] = useState(null)
  const [optimizeRunId, setOptimizeRunId] = useState(null)
  const [optimizeProgress, setOptimizeProgress] = useState(null)
  const [availableDatasets, setAvailableDatasets] = useState([])
  const [availableEvaluators, setAvailableEvaluators] = useState([])
  const pollRef = useRef(null)
  const [sdkVersions, setSdkVersions] = useState([])
  const [sdkLoading, setSdkLoading] = useState(false)
  const [expandedSdkRow, setExpandedSdkRow] = useState(null)
  const [products, setProducts] = useState([])
  const [selectedProduct, setSelectedProduct] = useState('')

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

  const loadTemplates = async () => {
    setLoading(true)
    try {
      const params = selectedProduct ? { product_id: selectedProduct } : {}
      const res = await getPromptTemplates(params)
      setTemplates(res.data.prompts || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  const loadSdkVersions = async () => {
    setSdkLoading(true)
    try {
      const params = selectedProduct ? { product_id: selectedProduct } : {}
      const res = await getPromptVersions(params)
      setSdkVersions(res.data.prompt_versions || [])
    } catch { /* ignore */ }
    setSdkLoading(false)
  }

  useEffect(() => { if (selectedProduct) loadTemplates() }, [selectedProduct])

  const selectPrompt = async (promptId) => {
    try {
      const [tmpl, vers] = await Promise.all([
        getPromptTemplate(promptId),
        getPromptTemplateVersions(promptId),
      ])
      setSelectedPrompt(tmpl.data)
      setVersions(vers.data.versions || [])
      setCompareMode(false)
      setCompareData(null)
      if (vers.data.versions?.length > 0) {
        const latest = vers.data.versions[0]
        setSelectedVersion(latest.version_number)
        setVersionDetail(latest)
      }
    } catch { /* ignore */ }
  }

  const selectVersion = async (vNum) => {
    setSelectedVersion(vNum)
    try {
      const res = await getPromptVersionDetail(selectedPrompt.prompt_id, vNum)
      setVersionDetail(res.data)
    } catch { /* ignore */ }
  }

  const handleCompare = async () => {
    if (!compareVersionA || !compareVersionB || !selectedPrompt) return
    try {
      const res = await comparePromptVersions(selectedPrompt.prompt_id, compareVersionA, compareVersionB)
      setCompareData(res.data)
    } catch { /* ignore */ }
  }

  const handleCreatePrompt = async () => {
    if (!newName.trim() || !newContent.trim()) return
    setSaving(true)
    try {
      const res = await createPromptTemplate({
        name: newName.trim(), content: newContent.trim(),
        description: newDesc.trim(), tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
        product_id: selectedProduct || 'default',
      })
      setShowCreate(false)
      setNewName(''); setNewContent(''); setNewDesc(''); setNewTags('')
      loadTemplates()
      if (res.data.prompt_id) selectPrompt(res.data.prompt_id)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleCreateVersion = async () => {
    if (!newContent.trim() || !selectedPrompt) return
    setSaving(true)
    try {
      await createPromptVersion(selectedPrompt.prompt_id, {
        content: newContent.trim(),
        tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
      })
      setShowNewVersion(false)
      setNewContent(''); setNewTags('')
      selectPrompt(selectedPrompt.prompt_id)
      loadTemplates()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const goBack = () => {
    setSelectedPrompt(null)
    setVersions([])
    setSelectedVersion(null)
    setVersionDetail(null)
    setCompareMode(false)
    setCompareData(null)
  }

  const openOptimizeWizard = async () => {
    setShowOptimize(true)
    setOptimizeResult(null)
    try {
      const [dsRes, evRes] = await Promise.all([getDatasets(), getEvaluators()])
      setAvailableDatasets(dsRes.data?.datasets || [])
      setAvailableEvaluators((evRes.data?.evaluators || []).filter(e => e.type === 'llm_judge' || e.type === 'conversation_judge'))
    } catch { /* ignore */ }
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const handleOptimize = async () => {
    if (!optimizeDatasetId || !optimizeEvaluatorId || !selectedPrompt) return
    setOptimizing(true)
    setOptimizeResult(null)
    setOptimizeProgress(null)
    setOptimizeRunId(null)
    stopPolling()

    try {
      const res = await optimizePrompt(selectedPrompt.prompt_id, {
        dataset_id: optimizeDatasetId,
        evaluator_id: optimizeEvaluatorId,
        max_iterations: optimizeMaxIter,
        optimizer_model: optimizeModel,
      })
      const runId = res.data?.run_id
      if (!runId) {
        setOptimizeResult(res.data)
        setOptimizing(false)
        return
      }
      setOptimizeRunId(runId)

      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await getOptimizationRun(runId)
          const data = pollRes.data
          setOptimizeProgress(data)

          if (data.status === 'completed' || data.status === 'failed') {
            stopPolling()
            setOptimizeResult(data)
            setOptimizing(false)
            if (data.status === 'completed') selectPrompt(selectedPrompt.prompt_id)
          }
        } catch {
          // run not yet written — keep polling
        }
      }, 4000)
    } catch (e) {
      setOptimizeResult({ ok: false, error: e.response?.data?.detail || e.message || 'Optimization failed' })
      setOptimizing(false)
    }
  }

  if (selectedPrompt) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={goBack} className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{selectedPrompt.name}</h1>
            {selectedPrompt.description && <p className="text-sm text-slate-500">{selectedPrompt.description}</p>}
          </div>
          <div className="flex-1" />
          <button onClick={() => { setCompareMode(!compareMode); setCompareData(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${compareMode ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <GitCompare size={14} /> {compareMode ? 'List' : 'Compare'}
          </button>
          <button onClick={openOptimizeWizard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-50 text-violet-600 hover:bg-violet-100 border border-violet-200">
            <Sparkles size={14} /> Optimize
          </button>
          <button onClick={() => { setShowNewVersion(true); setNewContent(versionDetail?.content || '') }}
            className="btn-brand text-xs px-3 py-1.5">+ New Version</button>
        </div>

        {showOptimize && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => !optimizing && setShowOptimize(false)}>
            <div className="bg-white rounded-xl shadow-xl w-[560px] max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-200 bg-gradient-to-r from-violet-50 to-purple-50">
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-violet-500" />
                  <h3 className="text-lg font-semibold text-slate-800">Optimize Prompt</h3>
                </div>
                <p className="text-sm text-slate-500 mt-1">Runs all strategies (custom + DSPy) and picks the best result</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Evaluation Dataset</label>
                  <select value={optimizeDatasetId} onChange={e => setOptimizeDatasetId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">Select dataset...</option>
                    {availableDatasets.map(d => <option key={d.dataset_id} value={d.dataset_id}>{d.name} ({d.item_count || 0} items)</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Judge (Evaluator)</label>
                  <select value={optimizeEvaluatorId} onChange={e => setOptimizeEvaluatorId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">Select judge...</option>
                    {availableEvaluators.map(e => <option key={e.evaluator_id} value={e.evaluator_id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Max Iterations</label>
                    <input type="number" min={1} max={10} value={optimizeMaxIter} onChange={e => setOptimizeMaxIter(parseInt(e.target.value) || 4)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Optimizer Model</label>
                    <select value={optimizeModel} onChange={e => setOptimizeModel(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <option value="gpt-4o">gpt-4o (recommended)</option>
                      <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                    </select>
                  </div>
                </div>

                {/* Small dataset warning */}
                {optimizeDatasetId && (() => {
                  const ds = availableDatasets.find(d => d.dataset_id === optimizeDatasetId)
                  const count = ds?.item_count || 0
                  return count > 0 && count < 5 ? (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
                      <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                      <div className="text-xs text-amber-700">
                        <span className="font-semibold">Small dataset ({count} items).</span> Optimization works best with 10+ items.
                        Results may be unreliable with fewer than 5 items.
                      </div>
                    </div>
                  ) : null
                })()}

                {/* Auto-best: strategy-level live progress */}
                {optimizing && (() => {
                  const p = optimizeProgress
                  const strategies = p?.strategies_completed || []
                  const allStrategies = [
                    { id: 'failure_driven', label: 'Failure-Driven', type: 'custom' },
                    { id: 'instruction_refinement', label: 'Instruction Refinement', type: 'custom' },
                    { id: 'few_shot', label: 'Few-Shot', type: 'custom' },
                    { id: 'dspy_bootstrap', label: 'DSPy Bootstrap', type: 'dspy' },
                    { id: 'dspy_mipro', label: 'DSPy MIPROv2', type: 'dspy' },
                  ]
                  const completedIds = strategies.map(s => s.strategy)
                  const currentStrategy = p?.current_strategy

                  return (
                    <div className="space-y-3">
                      {/* Overall status bar */}
                      <div className="flex items-center gap-3 p-4 bg-violet-50 rounded-lg border border-violet-200">
                        <Loader2 size={18} className="animate-spin text-violet-500" />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-violet-700">
                            {p?.current_phase === 'baseline' ? 'Evaluating baseline prompt...' :
                             p?.current_phase === 'baseline_complete' ? 'Baseline evaluated. Running strategies...' :
                             p?.current_phase === 'strategy_running' && currentStrategy
                               ? `Running: ${allStrategies.find(s => s.id === currentStrategy)?.label || currentStrategy}...`
                               : 'Optimizing across all strategies...'}
                          </div>
                          <div className="text-xs text-violet-500 mt-0.5">
                            {strategies.length > 0 && `${strategies.length}/5 strategies complete`}
                            {p?.best_pass_rate != null && p.best_pass_rate > 0 && ` · Best so far: ${p.best_pass_rate}%`}
                          </div>
                        </div>
                      </div>

                      {/* Baseline card */}
                      {p?.baseline_pass_rate != null && (
                        <div className="flex items-center gap-3 p-3 rounded-lg border bg-slate-50 border-slate-200 text-xs">
                          <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-white border border-slate-200">B</div>
                          <div className="flex-1">
                            <span className="font-semibold text-slate-700">Baseline</span>
                            <span className="text-slate-400 ml-2">{p.baseline_passed}/{p.baseline_total || '?'} passed</span>
                          </div>
                          <div className="text-sm font-bold text-slate-700">{p.baseline_pass_rate}%</div>
                        </div>
                      )}

                      {/* Strategy cards */}
                      <div className="space-y-2">
                        {allStrategies.map(strat => {
                          const completed = strategies.find(s => s.strategy === strat.id)
                          const isRunning = currentStrategy === strat.id && !completed
                          const isWaiting = !completed && !isRunning

                          return (
                            <div key={strat.id} className={`flex items-center gap-3 p-3 rounded-lg border text-xs transition-all ${
                              isRunning ? 'bg-violet-50 border-violet-300 ring-1 ring-violet-200' :
                              completed?.status === 'done' && completed?.is_best ? 'bg-emerald-50 border-emerald-200' :
                              completed?.status === 'done' ? 'bg-white border-slate-200' :
                              completed?.status === 'error' ? 'bg-red-50/50 border-red-200' :
                              completed?.status === 'skipped' ? 'bg-slate-50 border-slate-100 opacity-60' :
                              'bg-slate-50 border-slate-100 opacity-50'
                            }`}>
                              <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white border border-slate-200">
                                {isRunning ? <Loader2 size={14} className="animate-spin text-violet-500" /> :
                                 completed?.status === 'done' && completed?.is_best ? <Trophy size={14} className="text-amber-500" /> :
                                 completed?.status === 'done' ? <CheckCircle size={14} className="text-emerald-500" /> :
                                 completed?.status === 'error' ? <XCircle size={14} className="text-red-400" /> :
                                 completed?.status === 'skipped' ? <span className="text-slate-300 text-2xs">--</span> :
                                 <span className="text-slate-300 text-2xs">{allStrategies.indexOf(strat) + 1}</span>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`font-semibold ${isRunning ? 'text-violet-700' : 'text-slate-700'}`}>{strat.label}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-2xs ${
                                    strat.type === 'dspy' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                                  }`}>{strat.type === 'dspy' ? 'DSPy' : 'Custom'}</span>
                                  {isRunning && <span className="text-violet-500 text-2xs">running...</span>}
                                </div>
                                {completed?.changes_summary && (
                                  <div className="text-slate-500 truncate mt-0.5">{completed.changes_summary}</div>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                {completed?.status === 'done' && completed.pass_rate != null ? (
                                  <div className={`text-sm font-bold ${completed.is_best ? 'text-emerald-600' : 'text-slate-700'}`}>
                                    {completed.pass_rate}%
                                  </div>
                                ) : completed?.status === 'error' ? (
                                  <span className="text-2xs text-red-400">failed</span>
                                ) : completed?.status === 'skipped' ? (
                                  <span className="text-2xs text-slate-400">skipped</span>
                                ) : isWaiting ? (
                                  <span className="text-2xs text-slate-300">waiting</span>
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}

                {/* Final result */}
                {optimizeResult && !optimizing && (
                  <div className={`p-4 rounded-lg border ${optimizeResult.ok || optimizeResult.status === 'completed' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    {optimizeResult.ok || optimizeResult.status === 'completed' ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                          <CheckCircle size={16} /> Optimization Complete
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="p-2 bg-white rounded-lg">
                            <div className="text-2xs text-slate-400 uppercase">Initial</div>
                            <div className="text-lg font-bold text-slate-700">{optimizeResult.initial_pass_rate ?? optimizeResult.baseline_pass_rate}%</div>
                          </div>
                          <div className="p-2 bg-white rounded-lg">
                            <div className="text-2xs text-slate-400 uppercase">Final</div>
                            <div className="text-lg font-bold text-emerald-600">{optimizeResult.final_pass_rate ?? optimizeResult.best_pass_rate}%</div>
                          </div>
                          <div className="p-2 bg-white rounded-lg">
                            <div className="text-2xs text-slate-400 uppercase">Uplift</div>
                            <div className={`text-lg font-bold ${optimizeResult.uplift > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {optimizeResult.uplift > 0 ? '+' : ''}{optimizeResult.uplift}%
                            </div>
                          </div>
                        </div>
                        {optimizeResult.best_strategy && optimizeResult.best_strategy !== 'baseline' && (
                          <div className="flex items-center gap-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-xs">
                            <Trophy size={14} className="text-amber-500" />
                            <span className="font-semibold text-amber-700">Winning strategy: {optimizeResult.best_strategy.replace(/_/g, ' ')}</span>
                            {optimizeResult.new_version && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded text-2xs ml-auto">Saved as v{optimizeResult.new_version}</span>
                            )}
                          </div>
                        )}
                        {optimizeResult.strategies_completed?.map((s, i) => (
                          <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg border text-xs ${
                            s.is_best ? 'bg-emerald-50/50 border-emerald-200' :
                            s.status === 'error' ? 'bg-red-50/30 border-red-100' :
                            'bg-white border-slate-100'
                          }`}>
                            <div className="shrink-0 w-6 flex justify-center">
                              {s.is_best ? <Trophy size={12} className="text-amber-500" /> :
                               s.status === 'done' ? <CheckCircle size={12} className="text-emerald-400" /> :
                               s.status === 'error' ? <XCircle size={12} className="text-red-400" /> :
                               <span className="text-slate-300">--</span>}
                            </div>
                            <span className={`font-semibold ${s.is_best ? 'text-emerald-600' : 'text-slate-600'}`}>
                              {s.label || s.strategy}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-2xs ${
                              s.type === 'dspy' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                            }`}>{s.type === 'dspy' ? 'DSPy' : 'Custom'}</span>
                            {s.status === 'done' && s.pass_rate != null && (
                              <span className={`ml-auto font-bold ${s.is_best ? 'text-emerald-600' : 'text-slate-600'}`}>{s.pass_rate}%</span>
                            )}
                            {s.status === 'error' && <span className="ml-auto text-red-400">error</span>}
                            {s.status === 'skipped' && <span className="ml-auto text-slate-400">skipped</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <XCircle size={16} />
                        {optimizeResult.error || 'Optimization failed'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 p-4 border-t border-slate-200">
                <button onClick={() => setShowOptimize(false)} disabled={optimizing} className="px-4 py-1.5 text-sm text-slate-500 disabled:opacity-50">Cancel</button>
                <button onClick={handleOptimize} disabled={optimizing || !optimizeDatasetId || !optimizeEvaluatorId}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                  {optimizing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {optimizing ? 'Optimizing...' : 'Start Optimization'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showNewVersion && (
          <div className="card p-5 mb-5 border-brand-200 bg-brand-50/30">
            <div className="text-sm font-semibold text-slate-700 mb-3">Create New Version</div>
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono mb-3" rows={8}
              placeholder="Prompt content..." />
            <input value={newTags} onChange={e => setNewTags(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3" placeholder="Tags (comma-separated)" />
            <div className="flex gap-2">
              <button onClick={() => { setShowNewVersion(false); setNewContent(''); setNewTags('') }} className="px-3 py-1.5 text-sm text-slate-500">Cancel</button>
              <button onClick={handleCreateVersion} disabled={saving || !newContent.trim()} className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Version'}
              </button>
            </div>
          </div>
        )}

        {compareMode ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <select value={compareVersionA || ''} onChange={e => setCompareVersionA(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Version A</option>
                {versions.map(v => <option key={v.version_number} value={v.version_number}>Version {v.version_number}</option>)}
              </select>
              <span className="text-slate-400">vs</span>
              <select value={compareVersionB || ''} onChange={e => setCompareVersionB(Number(e.target.value))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Version B</option>
                {versions.map(v => <option key={v.version_number} value={v.version_number}>Version {v.version_number}</option>)}
              </select>
              <button onClick={handleCompare} disabled={!compareVersionA || !compareVersionB}
                className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">Compare</button>
            </div>
            {compareData && (
              <div className="grid grid-cols-2 gap-4">
                {[compareData.version_a, compareData.version_b].map((v, i) => (
                  <div key={i} className="card p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-2">
                      Version {v?.version_number}
                      <span className="text-xs text-slate-400 ml-2">{v?.created_at ? new Date(v.created_at).toLocaleDateString() : ''}</span>
                    </div>
                    {v?.tags?.length > 0 && (
                      <div className="flex gap-1 mb-2">
                        {v.tags.map(t => <span key={t} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">{t}</span>)}
                      </div>
                    )}
                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700 bg-slate-50 rounded-lg p-3 max-h-[500px] overflow-auto">{v?.content || 'No content'}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-5">
            <div className="col-span-1">
              <div className="card p-3">
                <div className="text-xs font-semibold text-slate-500 mb-2 uppercase">Versions</div>
                <div className="space-y-1">
                  {versions.map(v => (
                    <button key={v.version_number} onClick={() => selectVersion(v.version_number)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedVersion === v.version_number ? 'bg-brand-50 text-brand-700 font-medium' : 'hover:bg-slate-50 text-slate-600'
                      }`}>
                      <div>Version {v.version_number}</div>
                      <div className="text-xs text-slate-400">{v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="col-span-3 card p-5">
              {versionDetail ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-700">Version {versionDetail.version_number}</h3>
                      <span className="text-xs text-slate-400">{versionDetail.created_at ? new Date(versionDetail.created_at).toLocaleString() : ''}</span>
                    </div>
                    {versionDetail.tags?.length > 0 && (
                      <div className="flex gap-1">
                        {versionDetail.tags.map(t => <span key={t} className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-600">{t}</span>)}
                      </div>
                    )}
                  </div>
                  {versionDetail.variables?.length > 0 && (
                    <div className="mb-3 text-xs text-slate-500">
                      Variables: {versionDetail.variables.map(v => <code key={v} className="px-1.5 py-0.5 bg-slate-100 rounded mx-0.5">{'{{'}{v}{'}}'}</code>)}
                    </div>
                  )}
                  <pre className="text-sm font-mono whitespace-pre-wrap text-slate-700 bg-slate-50 rounded-lg p-4 max-h-[600px] overflow-auto leading-relaxed">
                    {versionDetail.content || 'No content'}
                  </pre>
                </>
              ) : (
                <div className="text-center py-12 text-slate-400">Select a version</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader title="Prompt Registry" subtitle="Manage prompt templates and versions" icon={FileText} />
        <div className="flex items-center gap-3">
          {products.length > 0 && (
            <FilterBar>
              <FilterSelect
                value={selectedProduct}
                onChange={(v) => { setSelectedProduct(v); setSelectedPrompt(null) }}
                options={products.map(p => ({ value: p, label: p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }))}
                placeholder="Select project"
              />
            </FilterBar>
          )}
          <button onClick={() => setShowCreate(true)} className="btn-brand text-sm px-4 py-2">+ New Prompt</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        <button onClick={() => setActiveTab('templates')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'templates' ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <FileText size={14} className="inline mr-1.5 -mt-0.5" />
          Prompt Templates
        </button>
        <button onClick={() => { setActiveTab('sdk'); loadSdkVersions() }}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'sdk' ? 'border-brand-500 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <Radio size={14} className="inline mr-1.5 -mt-0.5" />
          SDK-Detected Versions
        </button>
      </div>

      {showCreate && (
        <div className="card p-5 mb-6 border-brand-200 bg-brand-50/30">
          <div className="text-sm font-semibold text-slate-700 mb-3">Register New Prompt</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Prompt name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Prompt content (version 1)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono mb-3" rows={6} />
          <input value={newTags} onChange={e => setNewTags(e.target.value)} placeholder="Tags (comma-separated)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm mb-3" />
          <div className="flex gap-2">
            <button onClick={() => { setShowCreate(false); setNewName(''); setNewContent(''); setNewDesc(''); setNewTags('') }} className="px-3 py-1.5 text-sm text-slate-500">Cancel</button>
            <button onClick={handleCreatePrompt} disabled={saving || !newName.trim() || !newContent.trim()} className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Templates tab */}
      {activeTab === 'templates' && (
        <>
          {loading ? (
            <div className="text-center py-12 text-slate-400">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg mb-2">No prompt templates yet</p>
              <p className="text-sm">Register a prompt to start tracking versions</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Prompt Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Agent</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Versions</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Last Updated</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Created</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.prompt_id} className="border-b border-slate-100 hover:bg-brand-50/30 cursor-pointer"
                      role="button" tabIndex={0} aria-label={t.name}
                      onClick={() => selectPrompt(t.prompt_id)}
                      onKeyDown={e => e.key === 'Enter' && selectPrompt(t.prompt_id)}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{t.name}</div>
                        {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
                      </td>
                      <td className="px-4 py-3">
                        {t.agent_name ? <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">{t.agent_name}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t.version_count || 0}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{t.updated_at ? new Date(t.updated_at).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3"><ChevronRight size={14} className="text-slate-400" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* SDK-Detected Versions tab */}
      {activeTab === 'sdk' && (
        <>
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <Radio size={12} className="inline mr-1 -mt-0.5" />
            These prompt versions are auto-detected by the Cluco SDK when your agents run. They capture prompt hashes, agent names, and usage counts.
          </div>
          {sdkLoading ? (
            <div className="text-center py-12 text-slate-400">Loading SDK versions...</div>
          ) : sdkVersions.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p className="text-lg mb-2">No SDK-detected prompt versions yet</p>
              <p className="text-sm">Run your AI agents with the Cluco SDK to auto-capture prompt versions</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Agent</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Template Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">
                      <Hash size={12} className="inline mr-1 -mt-0.5" />Hash
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Model</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Uses</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">
                      <Clock size={12} className="inline mr-1 -mt-0.5" />First Seen
                    </th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-600">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {sdkVersions.map((v, i) => (
                    <tr key={v._id || i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {v.agent_name ? <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs font-medium">{v.agent_name}</span> : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{v.prompt_template_name || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedSdkRow(expandedSdkRow === i ? null : i)}
                          className="font-mono text-xs text-slate-500 hover:text-brand-600 cursor-pointer">
                          {v.prompt_hash ? v.prompt_hash.substring(0, 12) + '...' : '-'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{v.model || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium">{v.usage_count || 0}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{v.first_seen ? new Date(v.first_seen).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{v.last_seen ? new Date(v.last_seen).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {expandedSdkRow !== null && sdkVersions[expandedSdkRow] && (
                <div className="border-t border-slate-200 p-4 bg-slate-50">
                  <div className="text-xs font-semibold text-slate-600 mb-2">Prompt Preview</div>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700 bg-white rounded-lg p-3 max-h-[300px] overflow-auto border border-slate-200">
                    {sdkVersions[expandedSdkRow].content || sdkVersions[expandedSdkRow].prompt_preview || 'No preview available'}
                  </pre>
                  <div className="mt-2 text-xs text-slate-400">
                    Full hash: <code className="bg-white px-1 py-0.5 rounded">{sdkVersions[expandedSdkRow].prompt_hash || '-'}</code>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
