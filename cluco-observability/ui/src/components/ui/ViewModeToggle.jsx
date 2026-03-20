import { useState, useEffect } from 'react'
import { Eye, Code } from 'lucide-react'

const STORAGE_KEY = 'cluco_view_mode'

export default function ViewModeToggle({ onChange, defaultMode }) {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || defaultMode || 'simple'
    } catch {
      return defaultMode || 'simple'
    }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch {}
    onChange?.(mode)
  }, [mode])

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', background: '#f1f5f9', borderRadius: 8, padding: 2 }}>
      <button
        onClick={() => setMode('simple')}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 6, border: 'none',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          transition: 'all 0.15s',
          background: mode === 'simple' ? '#fff' : 'transparent',
          color: mode === 'simple' ? '#6d28d9' : '#94a3b8',
          boxShadow: mode === 'simple' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        }}
      >
        <Eye size={13} />
        Simple
      </button>
      <button
        onClick={() => setMode('advanced')}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 6, border: 'none',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          transition: 'all 0.15s',
          background: mode === 'advanced' ? '#fff' : 'transparent',
          color: mode === 'advanced' ? '#6d28d9' : '#94a3b8',
          boxShadow: mode === 'advanced' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
        }}
      >
        <Code size={13} />
        Advanced
      </button>
    </div>
  )
}
