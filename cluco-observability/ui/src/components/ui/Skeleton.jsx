export function SkeletonLine({ className = '', width = 'w-full' }) {
  return <div className={`skeleton h-4 ${width} ${className}`} />
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card p-5 space-y-3 ${className}`}>
      <SkeletonLine width="w-24" className="h-3" />
      <SkeletonLine width="w-32" className="h-7" />
      <SkeletonLine width="w-16" className="h-3" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="card overflow-hidden">
      <div className="bg-surface-2 px-4 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} width="w-24" className="h-3" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="px-4 py-3 flex gap-4 border-b border-slate-100">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} width={c === 0 ? 'w-32' : 'w-20'} className="h-4" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200/80">
        <div className="space-y-2">
          <SkeletonLine width="w-48" className="h-6" />
          <SkeletonLine width="w-32" className="h-3" />
        </div>
        <SkeletonLine width="w-24" className="h-9" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable />
    </div>
  )
}
