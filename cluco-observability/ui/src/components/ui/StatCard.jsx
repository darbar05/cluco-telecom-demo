export default function StatCard({ label, value, icon: Icon, color = 'text-brand-600', subtitle, className = '', tooltip }) {
  const bgMap = {
    'text-brand-600': 'bg-brand-50',
    'text-emerald-600': 'bg-emerald-50',
    'text-blue-600': 'bg-blue-50',
    'text-amber-600': 'bg-amber-50',
    'text-violet-600': 'bg-violet-50',
    'text-cyan-600': 'bg-cyan-50',
    'text-rose-600': 'bg-rose-50',
    'text-red-600': 'bg-red-50',
    'text-slate-600': 'bg-slate-100',
    'text-orange-600': 'bg-orange-50',
    'text-teal-600': 'bg-teal-50',
  }
  const bg = bgMap[color] || 'bg-brand-50'

  return (
    <div className={`stat-card group ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>
            <Icon size={16} className={color} />
          </div>
        )}
      </div>
      <div className={`text-2xl font-bold ${color}`} title={tooltip || undefined}>
        {value}
      </div>
      {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
    </div>
  )
}
