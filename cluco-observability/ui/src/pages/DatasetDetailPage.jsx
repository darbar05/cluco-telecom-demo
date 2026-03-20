import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getDataset, addDatasetItems, deleteDatasetItem,
  uploadDatasetFile, getDatasetFileUrl, addDatasetItemWithFiles,
  approveDatasetItem, bulkApproveDatasetItems,
} from '../api'
import {
  Database, Plus, Trash2, ArrowLeft, Upload, FileText,
  Code, ChevronDown, ChevronUp, File, Download, Eye,
  Edit2, FileIcon, FileType, Image, X,
  CheckCircle, AlertCircle, ThumbsUp, ThumbsDown, Check, Pencil,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable } from '../components/ui/Skeleton'

const FILE_ICONS = {
  '.pdf': { icon: FileText, color: '#ef4444' },
  '.docx': { icon: FileType, color: '#3b82f6' },
  '.doc': { icon: FileType, color: '#3b82f6' },
  '.txt': { icon: FileText, color: '#64748b' },
  '.csv': { icon: FileText, color: '#10b981' },
  '.json': { icon: Code, color: '#f59e0b' },
  '.png': { icon: Image, color: '#8b5cf6' },
  '.jpg': { icon: Image, color: '#8b5cf6' },
  '.jpeg': { icon: Image, color: '#8b5cf6' },
  '.xlsx': { icon: FileText, color: '#10b981' },
}

function getFileIcon(filename) {
  if (!filename) return { icon: FileIcon, color: '#94a3b8' }
  const ext = '.' + filename.split('.').pop().toLowerCase()
  return FILE_ICONS[ext] || { icon: FileIcon, color: '#94a3b8' }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DatasetDetailPage() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addMode, setAddMode] = useState(null)
  const [expandedItems, setExpandedItems] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getDataset(datasetId)
      setDataset(r.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [datasetId])

  useEffect(() => { load() }, [load])

  const handleDeleteItem = async (itemId) => {
    if (!confirm('Delete this item?')) return
    await deleteDatasetItem(datasetId, itemId)
    load()
  }

  const handleApproveItem = async (itemId, expectedOutput) => {
    await approveDatasetItem(datasetId, itemId, expectedOutput ? { expected_output: expectedOutput } : {})
    load()
  }

  const handleBulkApprove = async () => {
    await bulkApproveDatasetItems(datasetId, { positive_feedback_only: true })
    load()
  }

  if (loading) return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <SkeletonTable rows={6} />
    </div>
  )

  if (!dataset || dataset.error) return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', textAlign: 'center', paddingTop: 80 }}>
      <h3>Dataset not found</h3>
      <button onClick={() => navigate('/evaluations/datasets')} style={{
        padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
        cursor: 'pointer', fontWeight: 600,
      }}>Back to Datasets</button>
    </div>
  )

  const items = dataset.items || []
  const needsReviewCount = items.filter(i => i.needs_review).length
  const approvedCount = items.filter(i => i.needs_review === false).length
  const hasPositiveFeedback = items.some(i =>
    (i.feedback || []).some(f => f.key === 'user_feedback' && f.value === 'True') && i.needs_review
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={() => navigate('/evaluations/datasets')} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0',
        background: 'none', border: 'none', cursor: 'pointer', color: '#64748b',
        fontSize: 13, fontWeight: 500, marginBottom: 8,
      }}>
        <ArrowLeft size={16} /> Back to Datasets
      </button>

      <PageHeader title={dataset.name || 'Dataset'} subtitle={`${items.length} items · ${dataset.product_id || 'default'}`} icon={Database} />

      {dataset.description && (
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
          {dataset.description}
        </div>
      )}

      {/* Review status bar */}
      {(needsReviewCount > 0 || approvedCount > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
          padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
        }}>
          <AlertCircle size={16} color="#d97706" />
          <span style={{ fontSize: 12, color: '#92400e', flex: 1 }}>
            <strong>{needsReviewCount}</strong> items need review ·{' '}
            <strong>{approvedCount}</strong> approved ·{' '}
            <strong>{items.length - needsReviewCount - approvedCount}</strong> other
          </span>
          {hasPositiveFeedback && (
            <button onClick={handleBulkApprove} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
              background: '#059669', color: '#fff', border: 'none', borderRadius: 6,
              cursor: 'pointer', fontWeight: 600, fontSize: 11,
            }}>
              <ThumbsUp size={12} /> Approve All Thumbs-Up
            </button>
          )}
        </div>
      )}

      {/* Add items controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <AddBtn label="Upload Documents" icon={Upload} color="#3b82f6" active={addMode === 'files'} onClick={() => setAddMode(addMode === 'files' ? null : 'files')} />
        <AddBtn label="Paste JSON" icon={Code} color="#8b5cf6" active={addMode === 'json'} onClick={() => setAddMode(addMode === 'json' ? null : 'json')} />
        <AddBtn label="Upload CSV" icon={FileText} color="#10b981" active={addMode === 'csv'} onClick={() => setAddMode(addMode === 'csv' ? null : 'csv')} />
        <AddBtn label="Manual Entry" icon={Edit2} color="#f59e0b" active={addMode === 'manual'} onClick={() => setAddMode(addMode === 'manual' ? null : 'manual')} />
      </div>

      {addMode === 'files' && <FileUploadForm datasetId={datasetId} onClose={() => setAddMode(null)} onAdded={load} />}
      {addMode === 'json' && <JsonPasteForm datasetId={datasetId} onClose={() => setAddMode(null)} onAdded={load} />}
      {addMode === 'csv' && <CsvUploadForm datasetId={datasetId} onClose={() => setAddMode(null)} onAdded={load} />}
      {addMode === 'manual' && <ManualEntryForm datasetId={datasetId} onClose={() => setAddMode(null)} onAdded={load} />}

      {/* Items list */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24,
        border: '1px solid #e2e8f0',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
          Items ({items.length})
        </h3>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
            No items yet. Add items using document upload, JSON paste, CSV, or manual entry.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map((item, idx) => (
              <ItemRow key={item.item_id || idx} item={item} idx={idx}
                expanded={expandedItems[idx]}
                onToggle={() => setExpandedItems(p => ({ ...p, [idx]: !p[idx] }))}
                onDelete={() => handleDeleteItem(item.item_id)}
                onApprove={(text) => handleApproveItem(item.item_id, text)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ────── Add Button ────── */
function AddBtn({ label, icon: Icon, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
      background: active ? color + '15' : '#f8fafc',
      color: active ? color : '#475569',
      border: `1px solid ${active ? color : '#e2e8f0'}`,
      borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12,
      transition: 'all 0.15s',
    }}>
      <Icon size={14} /> {label}
    </button>
  )
}

/* ────── Item Row ────── */
function ItemRow({ item, idx, expanded, onToggle, onDelete, onApprove }) {
  const [editMode, setEditMode] = useState(false)
  const [editText, setEditText] = useState('')
  const inputFile = item.input?.filename || item.input?.file_ref
  const hasActualOutput = !!item.actual_output
  const needsReview = item.needs_review

  const feedbackList = item.feedback || []
  const hasPositive = feedbackList.some(f => f.key === 'user_feedback' && f.value === 'True')
  const hasNegative = feedbackList.some(f => f.key === 'user_feedback' && f.value === 'False')

  const handleStartEdit = (e) => {
    e.stopPropagation()
    const currentText = typeof item.expected_output === 'string' ? item.expected_output
      : item.expected_output?.text || ''
    setEditText(currentText || (typeof item.actual_output === 'string' ? item.actual_output : ''))
    setEditMode(true)
  }

  const handleSaveEdit = (e) => {
    e.stopPropagation()
    onApprove(editText)
    setEditMode(false)
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{
        padding: '10px 14px', cursor: 'pointer',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: expanded ? '#f8fafc' : '#fff',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>
            {item.item_id || `item_${idx}`}
          </span>

          {/* Status badges */}
          {needsReview && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: '#fef3c7', color: '#92400e',
            }}>Needs Review</span>
          )}
          {needsReview === false && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
              background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', gap: 2,
            }}><CheckCircle size={10} /> Approved</span>
          )}

          {/* Feedback indicators */}
          {hasPositive && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#059669' }}>
              <ThumbsUp size={10} />
            </span>
          )}
          {hasNegative && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#dc2626' }}>
              <ThumbsDown size={10} />
            </span>
          )}

          {/* Input preview */}
          {!inputFile && item.input && (
            <span style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
              {typeof item.input === 'string' ? item.input.slice(0, 50) : (item.input.text || '').slice(0, 50)}
            </span>
          )}

          {item.trace_id && (
            <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
              source_trace_id: {item.trace_id.slice(0, 8)}...
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {needsReview && hasActualOutput && (
            <button onClick={(e) => { e.stopPropagation(); onApprove('') }} title="Approve (copy actual to expected)" style={{
              padding: '3px 8px', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#166534',
            }}>
              <Check size={10} /> Approve
            </button>
          )}
          {needsReview && (
            <button onClick={handleStartEdit} title="Edit expected output" style={{
              padding: '3px 6px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 4, cursor: 'pointer',
            }}>
              <Pencil size={11} color="#2563eb" />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} style={{
            padding: '3px 6px', background: '#fef2f2', border: 'none', borderRadius: 4, cursor: 'pointer',
          }}>
            <Trash2 size={11} color="#ef4444" />
          </button>
          {expanded ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
        </div>
      </div>

      {/* Inline edit mode */}
      {editMode && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', background: '#eff6ff' }} onClick={e => e.stopPropagation()}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#1e40af', marginBottom: 4, display: 'block' }}>
            Edit Expected Output (Ground Truth)
          </label>
          <textarea value={editText} onChange={e => setEditText(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', border: '1px solid #93c5fd', borderRadius: 6,
              fontSize: 12, minHeight: 80, resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box',
            }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); setEditMode(false) }} style={{
              padding: '5px 12px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}>Cancel</button>
            <button onClick={handleSaveEdit} style={{
              padding: '5px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}>Save</button>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: hasActualOutput ? '1fr 1fr 1fr' : '1fr 1fr', gap: 12 }}>
            <ContentPanel label="INPUT" data={item.input} bgColor="#f8fafc" />
            {hasActualOutput && (
              <ContentPanel label="ACTUAL OUTPUT (model response)" data={item.actual_output} bgColor="#fef3c7" />
            )}
            <ContentPanel
              label={hasActualOutput ? "EXPECTED OUTPUT (ground truth)" : "EXPECTED OUTPUT"}
              data={item.expected_output}
              bgColor="#dcfce7"
              emptyLabel={needsReview ? "Needs human review" : undefined}
            />
          </div>
          {feedbackList.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>FEEDBACK</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {feedbackList.map((fb, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 4,
                    background: fb.value === 'True' ? '#dcfce7' : fb.value === 'False' ? '#fef2f2' : '#f1f5f9',
                    color: fb.value === 'True' ? '#166534' : fb.value === 'False' ? '#991b1b' : '#475569',
                  }}>
                    {fb.key}: {fb.value}{fb.comment ? ` — ${fb.comment}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ────── File Badge ────── */
function FileBadge({ filename, size, type }) {
  const { icon: Icon, color } = getFileIcon(filename)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
      background: color + '12', color: color,
    }}>
      <Icon size={10} />
      {filename?.length > 20 ? filename.slice(0, 18) + '...' : filename}
      {size ? ` (${formatBytes(size)})` : ''}
    </span>
  )
}

/* ────── Content Panel (for expanded item) ────── */
function ContentPanel({ label, data, bgColor, emptyLabel }) {
  if (!data || (typeof data === 'string' && !data.trim())) return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ padding: 10, background: bgColor, borderRadius: 6, fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>
        {emptyLabel || 'No data'}
      </div>
    </div>
  )

  const hasFile = typeof data === 'object' && (data.file_ref || data.filename)
  const text = typeof data === 'object' ? (data.text || '') : (typeof data === 'string' ? data : '')

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>{label}</div>

      {hasFile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 10,
          background: bgColor, borderRadius: 6, marginBottom: text ? 8 : 0,
        }}>
          {(() => {
            const { icon: Icon, color } = getFileIcon(data.filename || data.file_ref)
            return (
              <div style={{
                width: 32, height: 32, borderRadius: 6, background: color + '15',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={16} color={color} />
              </div>
            )
          })()}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.filename || data.file_ref}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>
              {data.size_bytes ? formatBytes(data.size_bytes) : ''}
            </div>
          </div>
          {data.file_ref && (
            <a href={getDatasetFileUrl(data.file_ref)} target="_blank" rel="noopener noreferrer"
              style={{
                padding: '4px 8px', background: '#3b82f6', color: '#fff', borderRadius: 4,
                fontSize: 10, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4,
              }}
              onClick={(e) => e.stopPropagation()}>
              <Download size={10} /> Download
            </a>
          )}
        </div>
      )}

      {text && (
        <pre style={{
          background: bgColor, padding: 10, borderRadius: 6, fontSize: 11,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
          margin: 0,
        }}>
          {hasFile && <span style={{ color: '#94a3b8', fontSize: 10 }}>Extracted text:\n</span>}
          {text.length > 2000 ? text.slice(0, 2000) + '\n... (truncated)' : text}
        </pre>
      )}

      {!hasFile && !text && typeof data === 'object' && (
        <pre style={{
          background: bgColor, padding: 10, borderRadius: 6, fontSize: 11,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
          margin: 0,
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════════════
   ADD-ITEM FORMS
   ═══════════════════════════════════════════════════════════════════════ */

const formWrapper = {
  background: '#fff', borderRadius: 12, padding: 24,
  border: '2px solid #3b82f6', marginBottom: 20,
}
const inputStyle = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const labelSt = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

function FormHeader({ title, onClose }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h4>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18 }}>&times;</button>
    </div>
  )
}

function FormActions({ onClose, onSave, saving, label = 'Add Items' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      <button onClick={onClose} style={{
        padding: '8px 14px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
      }}>Cancel</button>
      <button onClick={onSave} disabled={saving} style={{
        padding: '8px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6,
        cursor: saving ? 'wait' : 'pointer', fontWeight: 600, fontSize: 12, opacity: saving ? 0.5 : 1,
      }}>{saving ? 'Uploading...' : label}</button>
    </div>
  )
}

/* ────── 1. File Upload Form ────── */
function FileUploadForm({ datasetId, onClose, onAdded }) {
  const [inputFiles, setInputFiles] = useState([])
  const [outputFiles, setOutputFiles] = useState([])
  const [metaJson, setMetaJson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const outputRef = useRef(null)

  const handleSave = async () => {
    if (inputFiles.length === 0 && outputFiles.length === 0) {
      setError('Upload at least one input or output file')
      return
    }
    setSaving(true)
    setError('')
    try {
      const count = Math.max(inputFiles.length, outputFiles.length) || 1
      for (let i = 0; i < count; i++) {
        const form = new FormData()
        if (inputFiles[i]) form.append('input_file', inputFiles[i])
        if (outputFiles[i]) form.append('output_file', outputFiles[i])
        if (metaJson) form.append('metadata_json', metaJson)
        await addDatasetItemWithFiles(datasetId, form)
      }
      onAdded()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Upload failed')
    }
    setSaving(false)
  }

  return (
    <div style={formWrapper}>
      <FormHeader title="Upload Documents" onClose={onClose} />
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
        Upload input documents (PDFs, Word files, etc.) and their corresponding expected output (ground truth) documents.
        Files are paired by order -- first input with first output, and so on.
      </p>
      {error && (
        <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <label style={labelSt}>Input Documents</label>
          <DropZone files={inputFiles} setFiles={setInputFiles} inputRef={inputRef}
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.xlsx,.png,.jpg,.jpeg"
            placeholder="Drop input files here or click to browse" />
        </div>
        <div>
          <label style={labelSt}>Expected Output Documents (Ground Truth)</label>
          <DropZone files={outputFiles} setFiles={setOutputFiles} inputRef={outputRef}
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.xlsx,.png,.jpg,.jpeg"
            placeholder="Drop expected output files here or click to browse" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={labelSt}>Metadata (optional JSON)</label>
        <input value={metaJson} onChange={e => setMetaJson(e.target.value)} style={inputStyle}
          placeholder='{"case_type": "auto_accident", "injury_type": "brain"}' />
      </div>
      <FormActions onClose={onClose} onSave={handleSave} saving={saving} label="Upload & Add" />
    </div>
  )
}

/* ────── Drop Zone ────── */
function DropZone({ files, setFiles, inputRef, accept, placeholder }) {
  const [dragOver, setDragOver] = useState(false)
  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]) }
  const handleChange = (e) => { setFiles(prev => [...prev, ...Array.from(e.target.files)]); e.target.value = '' }
  const removeFile = (idx) => { setFiles(prev => prev.filter((_, i) => i !== idx)) }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef?.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#3b82f6' : '#d1d5db'}`,
          borderRadius: 8, padding: files.length ? '10px' : '24px 16px',
          textAlign: 'center', cursor: 'pointer',
          background: dragOver ? '#eff6ff' : '#fafafa',
          transition: 'all 0.15s', minHeight: 60,
        }}
      >
        <input ref={inputRef} type="file" multiple accept={accept} onChange={handleChange} style={{ display: 'none' }} />
        {files.length === 0 ? (
          <>
            <Upload size={20} color="#94a3b8" style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{placeholder}</div>
            <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 2 }}>Supported: PDF, DOCX, DOC, TXT, CSV, JSON, XLSX, Images</div>
          </>
        ) : (
          <div style={{ display: 'grid', gap: 4 }}>
            {files.map((f, i) => {
              const { icon: Icon, color } = getFileIcon(f.name)
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                  background: '#fff', borderRadius: 4, border: '1px solid #e2e8f0', textAlign: 'left',
                }}>
                  <Icon size={14} color={color} />
                  <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>{formatBytes(f.size)}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeFile(i) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    <X size={12} color="#94a3b8" />
                  </button>
                </div>
              )
            })}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>Click or drop to add more files</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ────── 2. JSON Paste Form ────── */
function JsonPasteForm({ datasetId, onClose, onAdded }) {
  const [jsonText, setJsonText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      const parsed = JSON.parse(jsonText)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      if (items.length === 0) { setError('No items to add'); setSaving(false); return }
      await addDatasetItems(datasetId, items)
      onAdded(); onClose()
    } catch (e) { setError(e.message || 'Invalid JSON') }
    setSaving(false)
  }

  return (
    <div style={formWrapper}>
      <FormHeader title="Paste JSON" onClose={onClose} />
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
        Paste a JSON array of items. Each item should have "input" and "expected_output" fields.
      </div>
      <textarea value={jsonText} onChange={e => setJsonText(e.target.value)}
        style={{ ...inputStyle, minHeight: 120, resize: 'vertical', fontFamily: 'monospace' }}
        placeholder={'[\n  {\n    "input": { "text": "Case description..." },\n    "expected_output": { "text": "Expected demand draft..." },\n    "metadata": { "case_type": "auto_accident" }\n  }\n]'} />
      <FormActions onClose={onClose} onSave={handleSave} saving={saving} />
    </div>
  )
}

/* ────── 3. CSV Upload Form ────── */
function CsvUploadForm({ datasetId, onClose, onAdded }) {
  const [csvFile, setCsvFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!csvFile) { setError('Select a CSV file'); return }
    setSaving(true); setError('')
    try {
      const text = await csvFile.text()
      const items = parseCSV(text)
      if (items.length === 0) { setError('No valid rows found'); setSaving(false); return }
      await addDatasetItems(datasetId, items)
      onAdded(); onClose()
    } catch (e) { setError(e.message || 'CSV parse failed') }
    setSaving(false)
  }

  return (
    <div style={formWrapper}>
      <FormHeader title="Upload CSV" onClose={onClose} />
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
        Upload a CSV with columns: input, expected_output (and optionally metadata columns).
      </div>
      <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files[0])} style={{ fontSize: 13 }} />
      <FormActions onClose={onClose} onSave={handleSave} saving={saving} />
    </div>
  )
}

/* ────── 4. Manual Entry Form ────── */
function ManualEntryForm({ datasetId, onClose, onAdded }) {
  const [manualInput, setManualInput] = useState('')
  const [manualOutput, setManualOutput] = useState('')
  const [manualMeta, setManualMeta] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      let meta = {}
      if (manualMeta.trim()) { try { meta = JSON.parse(manualMeta) } catch { meta = {} } }
      const items = [{ input: tryParseJSON(manualInput), expected_output: tryParseJSON(manualOutput), metadata: meta }]
      await addDatasetItems(datasetId, items)
      onAdded(); onClose()
    } catch (e) { setError(e.message || 'Failed to add item') }
    setSaving(false)
  }

  return (
    <div style={formWrapper}>
      <FormHeader title="Manual Entry" onClose={onClose} />
      {error && <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#991b1b', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label style={labelSt}>Input</label>
          <textarea value={manualInput} onChange={e => setManualInput(e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder="Enter the input text or JSON..." />
        </div>
        <div>
          <label style={labelSt}>Expected Output (Ground Truth)</label>
          <textarea value={manualOutput} onChange={e => setManualOutput(e.target.value)}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'monospace' }}
            placeholder="Enter the expected correct output..." />
        </div>
        <div>
          <label style={labelSt}>Metadata (optional JSON)</label>
          <input value={manualMeta} onChange={e => setManualMeta(e.target.value)} style={inputStyle}
            placeholder='{"category": "qa"}' />
        </div>
      </div>
      <FormActions onClose={onClose} onSave={handleSave} saving={saving} label="Add Item" />
    </div>
  )
}

/* ────── Helpers ────── */
function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const items = []
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj = {}
    headers.forEach((h, j) => { obj[h] = vals[j] || '' })
    items.push({
      input: obj.input || obj.Input || '',
      expected_output: { text: obj.expected_output || obj.Expected_Output || obj.output || '' },
      metadata: Object.fromEntries(
        Object.entries(obj).filter(([k]) => !['input', 'expected_output', 'output', 'Input', 'Expected_Output'].includes(k))
      ),
    })
  }
  return items
}

function tryParseJSON(text) {
  try { return JSON.parse(text) } catch { return text }
}
