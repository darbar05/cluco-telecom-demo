import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getLabelingSessions, createLabelingSession } from '../api'

export default function LabelingSessionsPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const fetchSessions = async () => {
    setLoading(true)
    try {
      const res = await getLabelingSessions()
      setSessions(res.data.sessions || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { fetchSessions() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await createLabelingSession({ name: newName.trim(), description: newDesc.trim() })
      if (res.data.session_id) {
        navigate(`/labeling-sessions/${res.data.session_id}`)
      } else {
        fetchSessions()
        setShowCreate(false)
        setNewName('')
        setNewDesc('')
      }
    } catch { /* ignore */ }
    setCreating(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Labeling Sessions</h1>
          <p className="text-sm text-slate-500 mt-1">Collect expert feedback on traces through structured review workflows</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-brand text-sm px-4 py-2">
          + Create Session
        </button>
      </div>

      {showCreate && (
        <div className="card p-5 mb-6 border-brand-200 bg-brand-50/30">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Session Name</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Sprint 12 Quality Review"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
              <input
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Optional description"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowCreate(false); setNewName(''); setNewDesc('') }} className="px-3 py-1.5 text-sm text-slate-500">Cancel</button>
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className="btn-brand text-sm px-4 py-1.5 disabled:opacity-50">
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <p className="text-lg mb-2">No labeling sessions yet</p>
          <p className="text-sm">Create a session and add traces from the Traces page</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Session Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Traces</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Review Progress</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Reviewers</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.session_id} className="border-b border-slate-100 hover:bg-brand-50/30 cursor-pointer" onClick={() => navigate(`/labeling-sessions/${s.session_id}`)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{s.name}</div>
                    {s.description && <div className="text-xs text-slate-400 mt-0.5">{s.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.trace_count || 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${s.review_progress || 0}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{s.review_progress || 0}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{(s.reviewer_emails || []).length}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{s.created_at ? new Date(s.created_at).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
