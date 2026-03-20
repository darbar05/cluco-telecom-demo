import { useState, useEffect, useCallback } from 'react'
import {
  getScoreConfigs,
  createScoreConfig,
  updateScoreConfig,
  deleteScoreConfig,
  getProducts,
} from '../api'
import { Settings, Plus, Trash2, Edit2, X } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

const DATA_TYPES = [
  { value: 'numeric', label: 'Numeric' },
  { value: 'categorical', label: 'Categorical' },
  { value: 'binary', label: 'Binary' },
]

export default function ScoreConfigsPage() {
  const [configs, setConfigs] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalConfig, setModalConfig] = useState(null) // null = closed, 'new' = create, or config object = edit

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, prRes] = await Promise.all([
        getScoreConfigs({ product_id: productFilter || undefined }),
        getProducts(),
      ])
      setConfigs(cfgRes.data.configs || [])
      setProducts(prRes.data.products || [])
    } catch (e) {
      console.error(e)
      setConfigs([])
    }
    setLoading(false)
  }, [productFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (config) => {
    if (!confirm(`Delete score config "${config.name}"?`)) return
    try {
      await deleteScoreConfig(config.config_id)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async (payload) => {
    try {
      if (modalConfig === 'new') {
        await createScoreConfig(payload)
      } else {
        await updateScoreConfig(modalConfig.config_id, payload)
      }
      setModalConfig(null)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const filteredConfigs = configs

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Score Configs"
        subtitle="Standardized score definitions for annotations, evaluations, and feedback"
        icon={Settings}
      />

      <div className="flex justify-between items-center mb-6">
        <FilterBar onRefresh={load}>
          <FilterSelect
            value={productFilter}
            onChange={setProductFilter}
            options={[
              { value: '', label: 'All Products' },
              ...products.map((p) => ({ value: p, label: p })),
            ]}
            placeholder="All Products"
          />
        </FilterBar>
        <button
          onClick={() => setModalConfig('new')}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={14} /> New Score Config
        </button>
      </div>

      {modalConfig && (
        <ScoreConfigModal
          config={modalConfig === 'new' ? null : modalConfig}
          products={products}
          onSave={handleSave}
          onClose={() => setModalConfig(null)}
        />
      )}

      {loading ? (
        <SkeletonTable rows={5} cols={5} />
      ) : filteredConfigs.length === 0 ? (
        <EmptyState
          icon={Settings}
          title="No score configs yet"
          description="Create a score config to define standardized scores for annotations, evaluations, and feedback."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Name</th>
                <th className="text-left">Data Type</th>
                <th className="text-left">Description</th>
                <th className="text-left">Product</th>
                <th className="text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredConfigs.map((cfg) => (
                <tr
                  key={cfg.config_id}
                  className="cursor-pointer hover:bg-slate-50/50"
                  onClick={() => setModalConfig(cfg)}
                >
                  <td className="text-sm font-medium text-slate-800">{cfg.name}</td>
                  <td>
                    <span className="text-xs font-medium text-slate-600">
                      {cfg.data_type || '—'}
                    </span>
                  </td>
                  <td className="text-xs text-slate-500 max-w-xs truncate">
                    {cfg.description || '—'}
                  </td>
                  <td className="text-xs text-slate-600">{cfg.product_id || 'default'}</td>
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setModalConfig(cfg)}
                        className="p-1 text-slate-400 hover:text-brand-600 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(cfg)}
                        className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ScoreConfigModal({ config, products, onSave, onClose }) {
  const isEdit = !!config
  const [name, setName] = useState(config?.name || '')
  const [description, setDescription] = useState(config?.description || '')
  const [dataType, setDataType] = useState(config?.data_type || 'numeric')
  const [minValue, setMinValue] = useState(config?.min_value ?? 0)
  const [maxValue, setMaxValue] = useState(config?.max_value ?? 10)
  const [categories, setCategories] = useState(
    config?.categories?.length
      ? config.categories.map((c) => ({ label: c.label || '', description: c.description || '' }))
      : [{ label: '', description: '' }]
  )
  const [productId, setProductId] = useState(config?.product_id || 'default')
  const [saving, setSaving] = useState(false)

  const addCategory = () => {
    setCategories((prev) => [...prev, { label: '', description: '' }])
  }

  const removeCategory = (idx) => {
    setCategories((prev) => prev.filter((_, i) => i !== idx))
  }

  const updateCategory = (idx, field, value) => {
    setCategories((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
    )
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        data_type: dataType,
        product_id: productId || 'default',
      }
      if (dataType === 'numeric') {
        payload.min_value = Number(minValue)
        payload.max_value = Number(maxValue)
      }
      if (dataType === 'categorical') {
        payload.categories = categories
          .filter((c) => c.label.trim())
          .map((c) => ({
            label: c.label.trim(),
            ...(c.description.trim() ? { description: c.description.trim() } : {}),
          }))
        if (payload.categories.length === 0) {
          payload.categories = [{ label: 'default' }]
        }
      }
      await onSave(payload)
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="card p-5 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto border-brand-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold text-slate-800">
            {isEdit ? 'Edit Score Config' : 'New Score Config'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field w-full"
              placeholder="e.g. Relevance Score"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field w-full"
              placeholder="Optional description"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data Type</label>
            <select
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
              className="select-field w-full text-xs py-2"
            >
              {DATA_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {dataType === 'numeric' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Min Value</label>
                <input
                  type="number"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Max Value</label>
                <input
                  type="number"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  className="input-field w-full"
                />
              </div>
            </div>
          )}

          {dataType === 'categorical' && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">
                Categories
              </label>
              <div className="space-y-2">
                {categories.map((cat, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <input
                      value={cat.label}
                      onChange={(e) => updateCategory(idx, 'label', e.target.value)}
                      className="input-field flex-1 text-xs"
                      placeholder="Label"
                    />
                    <input
                      value={cat.description}
                      onChange={(e) => updateCategory(idx, 'description', e.target.value)}
                      className="input-field flex-1 text-xs"
                      placeholder="Description (optional)"
                    />
                    <button
                      type="button"
                      onClick={() => removeCategory(idx)}
                      className="p-1.5 text-slate-400 hover:text-red-600 transition-colors shrink-0"
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCategory}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
                >
                  <Plus size={12} /> Add category
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Product</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="select-field w-full text-xs py-2"
            >
              <option value="default">default</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
