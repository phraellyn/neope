import moment from 'moment'

const spanishDateFormatter = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

export function orderedStudentResults(results = {}, dates = {}) {
  return Object.entries(results).map(([id, value], index) => ({ id, value, index, date: /^\d{4}-\d{2}-\d{2}$/.test(dates[id] || '') ? dates[id] : '' }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
}

export function formatStudentResultDate(value) {
  const source = String(value || '')
  const date = moment(source, 'YYYY-MM-DD', 'en', true)
  return date.isValid() ? spanishDateFormatter.format(new Date(`${source}T12:00:00Z`)) : ''
}
