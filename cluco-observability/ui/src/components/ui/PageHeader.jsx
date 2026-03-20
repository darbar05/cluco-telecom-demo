import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function PageHeader({ title, subtitle, icon: Icon, breadcrumbs, actions, children }) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-1.5">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={12} className="text-slate-400" />}
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-brand-600 transition-colors">{crumb.label}</Link>
                ) : (
                  <span className="text-slate-700 font-medium">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-brand-600" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-slate-900 truncate">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions}
        {children}
      </div>
    </div>
  )
}
