const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })

export function madridDay(date = new Date()) {
  const parts = Object.fromEntries(madridDate.formatToParts(date).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function validTrainingDate(value) {
  if (value === '') return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validTrainingDateRange(range = {}) {
  const from = range?.from ?? ''
  const to = range?.to ?? ''
  return validTrainingDate(from) && validTrainingDate(to) && (!from || !to || from <= to)
}

export function completedInTrainingDateRange(attempt, range = {}) {
  if (attempt?.status !== 'completed') return false
  if (!range.from && !range.to) return true
  const value = attempt.completedAt
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || '')
  if (!Number.isFinite(date.getTime())) return false
  const day = madridDay(date)
  return (!range.from || day >= range.from) && (!range.to || day <= range.to)
}
