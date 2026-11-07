export function publishedStudentData(group, results, publications, plannedDocuments) {
  const published = new Set((publications || []).filter((entry) => entry.visible === true).map((entry) => entry.id))
  const flatten = (items) => (Array.isArray(items) ? items : []).flatMap((item) => item.type === 'group' ? flatten(item.children) : [item])
  const items = flatten(group.evaluation?.structure).filter((item) => published.has(`result-${item.id}`))
  return {
    results: Object.fromEntries(items.filter((item) => Object.hasOwn(results || {}, item.id)).map((item) => [item.id, results[item.id]])),
    resultLabels: Object.fromEntries(items.map((item) => [item.id, item.nombre || item.nombreCorto || 'Resultado'])),
    upcoming: (plannedDocuments || []).filter((entry) => published.has(`date-${entry.id}`)).map((doc) => ({
      id: doc.id, date: doc.programming?.date || '', title: doc.campos?.title || doc.campos?.titulo || doc.assessment?.shortName || doc.plantilla?.nombre || 'Documento',
    })).filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date)).sort((a, b) => a.date.localeCompare(b.date)),
  }
}
