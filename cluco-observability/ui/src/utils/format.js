export function formatNumber(num) {
  if (num == null || isNaN(num)) return { display: '0', full: '0' }
  const n = Number(num)
  const full = n.toLocaleString()
  if (Math.abs(n) >= 1_000_000_000) {
    return { display: `${(n / 1_000_000_000).toFixed(1)}B`, full }
  }
  if (Math.abs(n) >= 1_000_000) {
    return { display: `${(n / 1_000_000).toFixed(1)}M`, full }
  }
  if (Math.abs(n) >= 10_000) {
    return { display: `${(n / 1_000).toFixed(1)}K`, full }
  }
  if (Math.abs(n) >= 1_000) {
    return { display: `${(n / 1_000).toFixed(1)}K`, full }
  }
  return { display: String(n), full }
}

export function fmtNum(num) {
  const { display } = formatNumber(num)
  return display
}

export function formatLatency(ms, count) {
  if (ms == null || isNaN(ms)) return { display: '0 ms', full: '0 ms', label: 'Latency' }
  const n = Number(ms)
  let display
  if (n >= 60_000) {
    display = `${(n / 60_000).toFixed(1)}m`
  } else if (n >= 1_000) {
    display = `${(n / 1_000).toFixed(1)}s`
  } else {
    display = `${Math.round(n)} ms`
  }
  const label = (count != null && count > 1) ? 'Avg Latency' : 'Latency'
  return { display, full: `${n.toLocaleString()} ms`, label }
}

export function formatCost(cost) {
  if (cost == null || isNaN(cost)) return { display: '$0.0000', full: '$0.000000' }
  const n = Number(cost)
  return { display: `$${n.toFixed(4)}`, full: `$${n.toFixed(6)}` }
}

export function formatTokens(num) {
  return formatNumber(num)
}
