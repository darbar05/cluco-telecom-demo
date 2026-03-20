import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDatasets, createDataset, deleteDataset, getProducts } from '../api'
import {
  Database, Plus, Trash2, ChevronRight, FileText,
  Search, Package,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

export default function DatasetManagerPage() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [products, setProducts] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ds, pr] = await Promise.all([
        getDatasets({ product_id: productFilter || undefined }).then(r => r.data),
        getProducts().then(r => r.data),
      ])
      setDatasets(ds.datasets || [])
      setProducts(pr.products || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [productFilter])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id) => {
    if (!confirm('Delete this dataset and all its items?')) return
    await deleteDataset(id)
    load()
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader title="Datasets" subtitle="Manage ground truth datasets for evaluations" icon={Database} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <FilterBar>
          <FilterSelect label="Product" value={productFilter} onChange={e => setProductFilter(e.target.value)}
            options={[{ value: '', label: 'All Products' }, ...products.map(p => ({ value: p, label: p }))]} />
        </FilterBar>
        <button onClick={() => setShowCreate(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
          fontWeight: 600, cursor: 'pointer', fontSize: 13,
        }}>
          <Plus size={14} /> Create Dataset
        </button>
      </div>

      {showCreate && (
        <CreateDatasetForm
          products={products}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); load(); navigate(`/evaluations/datasets/${id}`) }}
        />
      )}

      {loading ? <SkeletonTable rows={4} /> : datasets.length === 0 ? (
        <EmptyState message="No datasets yet. Create one to get started with evaluations." icon={Database} />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {datasets.map(ds => (
            <div key={ds.dataset_id} style={{
              background: '#fff', borderRadius: 12, padding: '16px 20px',
              border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
              onClick={() => navigate(`/evaluations/datasets/${ds.dataset_id}`)}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                marginRight: 16,
              }}>
                <Database size={18} color="#3b82f6" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', marginBottom: 2 }}>
                  {ds.name}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {ds.product_id || 'default'} &middot; {ds.item_count || 0} items
                  {ds.description ? ` · ${ds.description.slice(0, 80)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {ds.updated_at ? new Date(ds.updated_at).toLocaleDateString() : ''}
                </span>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(ds.dataset_id) }} style={{
                  padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: 4, cursor: 'pointer',
                }}>
                  <Trash2 size={12} color="#ef4444" />
                </button>
                <ChevronRight size={16} color="#94a3b8" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateDatasetForm({ products, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [productId, setProductId] = useState('default')
  const [description, setDescription] = useState('')
  const [inputType, setInputType] = useState('text')
  const [outputType, setOutputType] = useState('text')
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    setSaving(true)
    try {
      const res = await createDataset({
        name, product_id: productId, description,
        schema: { input_type: inputType, output_type: outputType, metadata_fields: [] },
      })
      onCreated(res.data.dataset_id)
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 24,
      border: '2px solid #3b82f6', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Create Dataset</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>×</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. Demand Draft Gold Standard v1" />
        </div>
        <div>
          <label style={labelStyle}>Product</label>
          <select value={productId} onChange={e => setProductId(e.target.value)} style={inputStyle}>
            <option value="default">default</option>
            {products.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} placeholder="Describe the purpose of this dataset..." />
        </div>
        <div>
          <label style={labelStyle}>Input Type</label>
          <select value={inputType} onChange={e => setInputType(e.target.value)} style={inputStyle}>
            <option value="text">Text</option>
            <option value="document">Document</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Output Type</label>
          <select value={outputType} onChange={e => setOutputType(e.target.value)} style={inputStyle}>
            <option value="text">Text</option>
            <option value="document">Document</option>
            <option value="json">JSON</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={{
          padding: '8px 16px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
        }}>Cancel</button>
        <button onClick={handleCreate} disabled={saving || !name} style={{
          padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
          cursor: saving ? 'wait' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving || !name ? 0.5 : 1,
        }}>{saving ? 'Creating...' : 'Create'}</button>
      </div>
    </div>
  )
}
