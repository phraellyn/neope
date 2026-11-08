export function examPdfCandidates(document, documentId, bucketName) {
  const templates = Array.isArray(document.plantillas) && document.plantillas.length ? document.plantillas : [document.plantilla || {}]
  const pdfs = Array.isArray(document.pdfs) && document.pdfs.length ? document.pdfs : (document.pdf ? [document.pdf] : [])
  return pdfs.map((entry, index) => {
    const pdf = typeof entry === 'string' ? { url: entry } : (entry || {})
    const template = templates.find((item) => item.key && item.key === pdf.templateKey) || templates[index] || {}
    const name = `${pdf.templateKey || ''} ${template.key || ''} ${template.nombre || ''} ${template.archivo || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    let path = pdf.path || ''
    if (!path && pdf.url) {
      try { const url = new URL(pdf.url); const prefix = `/v0/b/${bucketName}/o/`; if (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(prefix)) path = decodeURIComponent(url.pathname.slice(prefix.length)) } catch { /* Referencia no válida. */ }
    }
    if (typeof path !== 'string' || !path.startsWith(`documentos/${documentId}/`) || path.includes('..')) return null
    return { path, solved: /resuelt|solucion|solved|solution/.test(name), statement: /enunciad|statement/.test(name) }
  }).filter(Boolean).sort((a, b) => Number(b.solved) - Number(a.solved) || Number(b.statement) - Number(a.statement))
}

export function examResultItem(group, itemId) {
  const flatten = (items) => (Array.isArray(items) ? items : []).flatMap((item) => item.type === 'group' ? flatten(item.children) : [item])
  return flatten(group.evaluation?.structure).find((item) => item.type === 'item' && item.id === itemId && item.documentAssessment?.documentId) || null
}

const criteria = (values) => (Array.isArray(values) ? values : []).filter((item) => item && typeof item === 'object').map((item) => ({ id: String(item.id || ''), description: String(item.description || ''), points: Number(String(item.points ?? 0).replace(',', '.')) || 0 }))
const parts = (values) => (Array.isArray(values) ? values : []).map((part) => ({ id: String(part.id || ''), gradingCriteria: criteria(part.gradingCriteria) }))

// Se envían solo los datos necesarios para reconstruir la matriz, sin referencias privadas de Storage.
export function safeExamExercise(source = {}) {
  const structure = source.structure || {}
  return {
    schemaVersion: Number(source.schemaVersion) || 0,
    ...(source.statement ? { statement: { latex: '' } } : {}),
    codigo: String(source.codigo || source.latex || source.enunciado || ''),
    gradingCriteria: criteria(source.gradingCriteria),
    parts: parts(source.parts),
    apartados: parts(source.apartados),
    ...(source.structure ? { structure: { gradingCriteria: criteria(structure.gradingCriteria), apartados: parts(structure.apartados) } } : {}),
  }
}

export function safeExamAssessment(value = {}) {
  return { segments: Object.fromEntries(Object.entries(value.segments || {}).map(([key, entries]) => [key, criteria(entries)])) }
}
