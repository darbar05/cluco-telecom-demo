import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getAnnotationQueues,
  createAnnotationQueue,
  deleteAnnotationQueue,
  getProducts,
  getDatasets,
  getScoreConfigs,
} from '../api'
import {
  ClipboardList,
  Plus,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

const STATUS_COLORS = {
  active: { bg: '#dcfce7', text: '#16a34a', label: 'Active' },
  paused: { bg: '#fef9c3', text: '#ca8a04', label: 'Paused' },
  completed: { bg: '#f1f5f9', text: '#64748b', label: 'Completed' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_COLORS[status] || STATUS_COLORS.active
  return (
    <span style={{
      background: cfg.bg,
      color: cfg.text,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {cfg.label}
    </span>
  )
}

export default function AnnotationQueuesPage() {
  const navigate = useNavigate()
  const [queues, setQueues] = useState([])
  const [products, setProducts] = useState([])
  const [datasets, setDatasets] = useState([])
  const [scoreConfigs, setScoreConfigs] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, pRes, dRes, sRes] = await Promise.all([
        getAnnotationQueues({ product_id: productFilter || undefined }).then(r => r.data),
        getProducts().then(r => r.data),
        getDatasets().then(r => r.data),
        getScoreConfigs().then(r => r.data),
      ])
      setQueues(qRes.queues || [])
      setProducts(pRes.products || [])
      setDatasets(dRes.datasets || [])
      setScoreConfigs(sRes.configs || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [productFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (queueId, e) => {
    e?.stopPropagation()
    if (!confirm('Delete this annotation queue and all its items?')) return
    try {
      await deleteAnnotationQueue(queueId)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const datasetMap = Object.fromEntries((datasets || []).map(d => [d.dataset_id, d]))

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        title="Annotation Queues"
        subtitle="Review and label traces for ground truth datasets"
        icon={ClipboardList}
        actions={
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <Plus size={14} /> New Annotation Queue
          </button>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <FilterBar onRefresh={load}>
          <FilterSelect
            value={productFilter}
            onChange={v => setProductFilter(v)}
            placeholder="All Products"
            options={(products || []).map(p => ({ value: p, label: p }))}
          />
        </FilterBar>
      </div>

      {showCreate && (
        <CreateQueueModal
          products={products}
          datasets={datasets}
          scoreConfigs={scoreConfigs}
          onClose={() => setShowCreate(false)}
          onCreated={(queueId) => {
            setShowCreate(false)
            load()
            navigate(`/annotation-queues/${queueId}`)
          }}
        />
      )}

      {loading ? (
        <SkeletonTable rows={4} />
      ) : queues.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No annotation queues yet"
          description="Create an annotation queue to review and label traces for ground truth datasets."
          action={
            <button
              onClick={() => setShowCreate(true)}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              New Annotation Queue
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {queues.map(q => {
            const targetDs = q.target_dataset_id ? datasetMap[q.target_dataset_id] : null
            const itemCount = q.item_count ?? q.items?.length ?? null
            const reviewedCount = q.reviewed_count ?? (q.items ? q.items.filter(i => i.status === 'reviewed' || i.status === 'approved').length : null)
            const progressPct = itemCount && itemCount > 0 && reviewedCount != null
              ? Math.round((reviewedCount / itemCount) * 100)
              : null

            return (
              <div
                key={q.queue_id}
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '16px 20px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => navigate(`/annotation-queues/${q.queue_id}`)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0' }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: '#eff6ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginRight: 16,
                  }}
                >
                  <ClipboardList size={18} color="#3b82f6" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                      {q.name || 'Unnamed Queue'}
                    </span>
                    <StatusBadge status={q.status || 'active'} />
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {q.description ? `${q.description.slice(0, 80)}${q.description.length > 80 ? '…' : ''} · ` : ''}
                    {q.product_id || 'default'}
                    {targetDs ? ` · ${targetDs.name}` : q.target_dataset_id ? ` · ${q.target_dataset_id}` : ''}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {itemCount != null ? `${itemCount} items` : '— items'}
                    </span>
                    {progressPct != null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div
                          style={{
                            width: 80,
                            height: 6,
                            background: '#e2e8f0',
                            borderRadius: 3,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${progressPct}%`,
                              height: '100%',
                              background: '#3b82f6',
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {reviewedCount ?? '—'} / {itemCount ?? '—'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {q.updated_at ? new Date(q.updated_at).toLocaleDateString() : ''}
                  </span>
                  <button
                    onClick={e => handleDelete(q.queue_id, e)}
                    style={{
                      padding: '4px 8px',
                      background: '#fef2f2',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={12} color="#ef4444" />
                  </button>
                  <ChevronRight size={16} color="#94a3b8" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CreateQueueModal({ products, datasets, scoreConfigs, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [productId, setProductId] = useState('default')
  const [targetDatasetId, setTargetDatasetId] = useState('')
  const [scoreConfigIds, setScoreConfigIds] = useState([])
  const [filterCriteria, setFilterCriteria] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [filterError, setFilterError] = useState('')

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

  const handleCreate = async () => {
    let filterObj = null
    if (filterCriteria.trim()) {
      try {
        filterObj = JSON.parse(filterCriteria)
        setFilterError('')
      } catch {
        setFilterError('Invalid JSON')
        return
      }
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        product_id: productId,
        target_dataset_id: targetDatasetId || undefined,
        score_configs: scoreConfigIds.length ? scoreConfigIds : undefined,
        filter_criteria: filterObj,
      }
      const res = await createAnnotationQueue(payload)
      const queueId = res.data?.queue_id
      if (queueId) {
        onCreated(queueId)
      } else {
        onClose()
      }
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const toggleScoreConfig = (id) => {
    setScoreConfigIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        padding: 24,
        border: '2px solid #3b82f6',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>New Annotation Queue</h3>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
            placeholder="e.g. Sprint 12 Quality Review"
          />
        </div>
        <div>
          <label style={labelStyle}>Product</label>
          <select value={productId} onChange={e => setProductId(e.target.value)} style={inputStyle}>
            <option value="default">default</option>
            {(products || []).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={inputStyle}
            placeholder="Describe the purpose of this queue..."
          />
        </div>
        <div>
          <label style={labelStyle}>Target Dataset</label>
          <select
            value={targetDatasetId}
            onChange={e => setTargetDatasetId(e.target.value)}
            style={inputStyle}
          >
            <option value="">— Select dataset —</option>
            {(datasets || []).map(d => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.name} ({d.dataset_id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Score Configs</label>
          <div
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '8px 12px',
              maxHeight: 120,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            {(scoreConfigs || []).length === 0 ? (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>No score configs available</span>
            ) : (
              (scoreConfigs || []).map(c => (
                <label key={c.config_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={scoreConfigIds.includes(c.config_id)}
                    onChange={() => toggleScoreConfig(c.config_id)}
                  />
                  <span style={{ fontSize: 12 }}>{c.name || c.config_id}</span>
                </label>
              ))
            )}
          </div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Filter Criteria (optional JSON)</label>
          <textarea
            value={filterCriteria}
            onChange={e => setFilterCriteria(e.target.value)}
            style={{ ...inputStyle, minHeight: 60, fontFamily: 'monospace' }}
            placeholder='{"product_id": "my-product"}'
          />
          {filterError && (
            <span style={{ fontSize: 11, color: '#ef4444', marginTop: 4, display: 'block' }}>{filterError}</span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 16px',
            background: '#f1f5f9',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={saving || !name.trim()}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'wait' : 'pointer',
            fontWeight: 600,
            fontSize: 13,
            opacity: saving || !name.trim() ? 0.5 : 1,
          }}
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  )
}
