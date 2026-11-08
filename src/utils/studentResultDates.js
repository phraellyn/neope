import moment from 'moment'
import 'moment/locale/es.js'

export function orderedStudentResults(results = {}, dates = {}) {
  return Object.entries(results).map(([id, value], index) => ({ id, value, index, date: /^\d{4}-\d{2}-\d{2}$/.test(dates[id] || '') ? dates[id] : '' }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
}

export function formatStudentResultDate(value) {
  const date = moment(String(value || ''), 'YYYY-MM-DD', true)
  return date.isValid() ? date.locale('es').format('D [de] MMMM [de] YYYY') : ''
}
