export function studentResultDate(value) {
  const text = String(value || '').trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const local = text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  const year = iso ? Number(iso[1]) : local ? Number(local[3].length === 2 ? `20${local[3]}` : local[3]) : 0
  const month = iso ? Number(iso[2]) : local ? Number(local[2]) : 0
  const day = iso ? Number(iso[3]) : local ? Number(local[1]) : 0
  const date = new Date(Date.UTC(year, month - 1, day))
  if (!year || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const flattenItems = (items) => (Array.isArray(items) ? items : []).flatMap((item) => item.type === 'group' ? flattenItems(item.children) : [item])

export function publishedResultDocumentIds(group, results, publications) {
  const published = new Set((publications || []).filter((entry) => entry.visible === true).map((entry) => entry.id))
  return [...new Set(flattenItems(group.evaluation?.structure)
    .filter((item) => published.has(`result-${item.id}`) && Object.hasOwn(results || {}, item.id) && !studentResultDate(item.programming?.date))
    .map((item) => item.documentAssessment?.documentId)
    .filter((id) => typeof id === 'string' && id && id.length <= 500 && id !== '.' && id !== '..' && !id.includes('/')))]
}

export function publishedStudentData(group, results, publications, plannedDocuments) {
  const published = new Set((publications || []).filter((entry) => entry.visible === true).map((entry) => entry.id))
  const items = flattenItems(group.evaluation?.structure).filter((item) => published.has(`result-${item.id}`))
  return {
    results: Object.fromEntries(items.filter((item) => Object.hasOwn(results || {}, item.id)).map((item) => [item.id, results[item.id]])),
    resultLabels: Object.fromEntries(items.map((item) => [item.id, item.nombre || item.nombreCorto || 'Resultado'])),
    resultDocuments: Object.fromEntries(items.filter((item) => item.documentAssessment?.documentId && Object.hasOwn(results || {}, item.id)).map((item) => [item.id, true])),
    resultDates: Object.fromEntries(items.filter((item) => Object.hasOwn(results || {}, item.id)).map((item) => {
      const doc = (plannedDocuments || []).find((entry) => entry.id === item.documentAssessment?.documentId)
      const date = [item.programming?.date, doc?.programming?.date, doc?.campos?.date, doc?.campos?.fecha].map(studentResultDate).find(Boolean) || ''
      return [item.id, date]
    })),
    upcoming: (plannedDocuments || []).filter((entry) => published.has(`date-${entry.id}`)).map((doc) => ({
      id: doc.id, date: doc.programming?.date || '', title: doc.campos?.title || doc.campos?.titulo || doc.assessment?.shortName || doc.plantilla?.nombre || 'Documento',
    })).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date)).sort((a, b) => a.date.localeCompare(b.date)),
  }
}
