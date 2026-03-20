export default function Tip({ value, full, className = '' }) {
  if (full == null || full === String(value)) {
    return <span className={className}>{value}</span>
  }
  return (
    <span className={className} title={full} style={{ cursor: 'default' }}>
      {value}
    </span>
  )
}
