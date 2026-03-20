import { Filter, RefreshCw } from 'lucide-react'

export default function FilterBar({ children, onRefresh }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Filter size={14} />
      </div>
      {children}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="btn-ghost !px-2 !py-1.5"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  )
}

export function FilterSelect({ value, onChange, options, placeholder = 'All', className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`select-field text-xs py-1.5 ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value
        const label = typeof opt === 'string' ? opt : opt.label
        return <option key={val} value={val}>{label}</option>
      })}
    </select>
  )
}
