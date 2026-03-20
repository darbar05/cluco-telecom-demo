import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react'

export default function StatusBadge({ status }) {
  const isError = status === 'error' || status === 'ERROR'
  const isPending = status === 'pending' || status === 'PENDING'
  const isWarning = status === 'warning' || status === 'WARNING'

  if (isError) {
    return (
      <span className="badge-error gap-1">
        <XCircle size={12} />
        Error
      </span>
    )
  }
  if (isPending) {
    return (
      <span className="badge-warning gap-1">
        <Clock size={12} />
        Pending
      </span>
    )
  }
  if (isWarning) {
    return (
      <span className="badge-warning gap-1">
        <AlertTriangle size={12} />
        Warning
      </span>
    )
  }
  return (
    <span className="badge-success gap-1">
      <CheckCircle2 size={12} />
      Success
    </span>
  )
}
