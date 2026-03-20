import { useState, useEffect, useCallback } from 'react'
import {
  getEvaluationSuites,
  createEvaluationSuite,
  updateEvaluationSuite,
  deleteEvaluationSuite,
  getEvaluators,
  getProducts,
} from '../api'
import { Layers, Plus, Trash2, Edit2, CheckSquare } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

export default function EvaluationSuitesPage() {
  const [suites, setSuites] = useState([])
  const [products, setProducts] = useState([])
  const [evaluators, setEvaluators] = useState([])
  const [productFilter, setProductFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalSuite, setModalSuite] = useState(null) // null = closed, 'new' = create, or suite object = edit

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [suitesRes, prRes, evRes] = await Promise.all([
        getEvaluationSuites({ product_id: productFilter || undefined }),
        getProducts(),
        getEvaluators({ product_id: productFilter || undefined }),
      ])
      setSuites(suitesRes.data?.suites || [])
      setProducts(prRes.data?.products || [])
      setEvaluators(evRes.data?.evaluators || evRes.data || [])
    } catch (e) {
      console.error(e)
      setSuites([])
    }
    setLoading(false)
  }, [productFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleDelete = async (suite) => {
    if (!confirm(`Delete evaluation suite "${suite.name || suite.suite_id}"?`)) return
    try {
      await deleteEvaluationSuite(suite.suite_id)
      setModalSuite(null)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const handleSave = async (payload) => {
    try {
      if (modalSuite === 'new') {
        await createEvaluationSuite(payload)
      } else {
        await updateEvaluationSuite(modalSuite.suite_id, payload)
      }
      setModalSuite(null)
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const productOptions = [
    { value: '', label: 'All Products' },
    ...(Array.isArray(products)
      ? products.map((p) =>
          typeof p === 'string'
            ? { value: p, label: p }
            : { value: p.product_id || p.id || p, label: p.name || p.product_id || p }
        )
      : []),
  ]

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        title="Evaluation Suites"
        subtitle="Group evaluators into reusable test suites"
        icon={Layers}
        actions={
          <button
            onClick={() => setModalSuite('new')}
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
            <Plus size={14} /> New Suite
          </button>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <FilterBar onRefresh={load}>
          <FilterSelect
            value={productFilter}
            onChange={setProductFilter}
            placeholder="All Products"
            options={productOptions}
          />
        </FilterBar>
      </div>

      {modalSuite && (
        <SuiteModal
          suite={modalSuite === 'new' ? null : modalSuite}
          products={products}
          evaluators={evaluators}
          onSave={handleSave}
          onDelete={modalSuite !== 'new' ? () => handleDelete(modalSuite) : null}
          onClose={() => setModalSuite(null)}
        />
      )}

      {loading ? (
        <SkeletonTable rows={4} cols={4} />
      ) : suites.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No evaluation suites yet"
          description="Create an evaluation suite to group evaluators for experiments, scheduled runs, and CI/CD."
          action={
            <button
              onClick={() => setModalSuite('new')}
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
              New Suite
            </button>
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {suites.map((s) => {
            const evaluatorCount = (s.evaluator_ids || []).length
            return (
              <div
                key={s.suite_id}
                style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '16px 20px',
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => setModalSuite(s)}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0' }}
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
                    marginBottom: 12,
                  }}
                >
                  <Layers size={18} color="#3b82f6" />
                </div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>
                    {s.name || s.suite_id || 'Unnamed Suite'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                  {s.description ? `${s.description.slice(0, 80)}${s.description.length > 80 ? '…' : ''}` : '—'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckSquare size={12} />
                    {evaluatorCount} evaluator{evaluatorCount !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {s.product_id || 'default'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SuiteModal({ suite, products, evaluators, onSave, onDelete, onClose }) {
  const isEdit = !!suite
  const [name, setName] = useState(suite?.name || '')
  const [description, setDescription] = useState(suite?.description || '')
  const [productId, setProductId] = useState(suite?.product_id || 'default')
  const [evaluatorIds, setEvaluatorIds] = useState(suite?.evaluator_ids || [])
  const [saving, setSaving] = useState(false)

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

  const toggleEvaluator = (id) => {
    setEvaluatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        product_id: productId || 'default',
        evaluator_ids: evaluatorIds,
      }
      await onSave(payload)
    } catch (e) {
      console.error(e)
    }
    setSaving(false)
  }

  const productList = Array.isArray(products) ? products : []
  const evaluatorList = Array.isArray(evaluators) ? evaluators : []

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 24,
          maxWidth: 480,
          width: '100%',
          margin: 16,
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '2px solid #e2e8f0',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEdit && <Edit2 size={16} color="#64748b" />}
            {isEdit ? 'Edit Suite' : 'New Suite'}
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Quality Gate Suite"
            />
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
              placeholder="Optional description..."
            />
          </div>
          <div>
            <label style={labelStyle}>Product</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} style={inputStyle}>
              <option value="default">default</option>
              {productList.map((p) => {
                const val = typeof p === 'string' ? p : (p.product_id || p.id || p)
                const label = typeof p === 'string' ? p : (p.name || p.product_id || p)
                return <option key={val} value={val}>{label}</option>
              })}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Evaluators</label>
            <div
              style={{
                border: '1px solid #d1d5db',
                borderRadius: 6,
                padding: '8px 12px',
                maxHeight: 160,
                overflowY: 'auto',
                background: '#fff',
              }}
            >
              {evaluatorList.length === 0 ? (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No evaluators available</span>
              ) : (
                evaluatorList.map((ev) => (
                  <label
                    key={ev.evaluator_id || ev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 6,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={evaluatorIds.includes(ev.evaluator_id || ev.id)}
                      onChange={() => toggleEvaluator(ev.evaluator_id || ev.id)}
                    />
                    <span style={{ fontSize: 12, color: '#374151' }}>
                      {ev.name || ev.evaluator_id || ev.id}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      ({ev.type || '—'})
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, gap: 8 }}>
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  background: '#fef2f2',
                  color: '#ef4444',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
              onClick={handleSubmit}
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
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
