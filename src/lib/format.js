export const money = (n) =>
  new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 }).format(Number(n || 0)) + ' RWF'

export const num = (n) =>
  new Intl.NumberFormat('en-RW', { maximumFractionDigits: 3 }).format(Number(n || 0))

// Date range helpers for the dashboard filter.
export function rangeStart(range) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (range === 'today') return d
  if (range === 'week')  { d.setDate(d.getDate() - 6); return d }
  if (range === 'month') { d.setDate(1); return d }
  return null // 'all'
}
