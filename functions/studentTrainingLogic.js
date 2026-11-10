const unique = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))]
const positiveScore = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  if (typeof value === 'string' && !value.trim()) return false
  const score = Number(String(value).replace(',', '.'))
  return Number.isFinite(score) && score > 0
}

export function pdfStoragePath(reference, exerciseId, bucketName) {
  let path = typeof reference === 'object' && reference ? reference.storagePath || reference.path : ''
  const url = typeof reference === 'string' ? reference : reference?.downloadUrl || reference?.url
  if (!path && url) {
    try {
      const parsed = new URL(url)
      const prefix = `/v0/b/${bucketName}/o/`
      if (parsed.hostname === 'firebasestorage.googleapis.com' && parsed.pathname.startsWith(prefix)) path = decodeURIComponent(parsed.pathname.slice(prefix.length))
    } catch { return '' }
  }
  return typeof path === 'string' && path.startsWith(`ejercicios/${exerciseId}/`) && !path.includes('..') ? path : ''
}

export function trainingReadiness(version = {}, { exerciseId = '', bucketName = '', variant = false } = {}) {
  if (!version || typeof version !== 'object') version = {}
  const reasons = []
  const structure = version.structure || {}
  const statement = version.statement?.latex || structure.statement?.latex || structure.enunciado || version.enunciado || version.codigo || version.latex
  const parts = Array.isArray(version.parts) && version.parts.length ? version.parts : Array.isArray(structure.apartados) ? structure.apartados : []
  if (!String(statement || '').trim() && !parts.some((part) => String(part?.statement?.latex || part?.enunciado || '').trim())) reasons.push('Falta el enunciado.')
  try { if (!trainingSegments(version).length) reasons.push('Faltan conceptos, soluciones o criterios de calificación en el ejercicio o sus apartados.') }
  catch { reasons.push('Los datos del ejercicio están incompletos o no son válidos.') }
  const statementPdf = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, exerciseId, bucketName)
  const solutionPdf = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, exerciseId, bucketName)
  if (!statementPdf || !solutionPdf || statementPdf === solutionPdf) reasons.push('Faltan los PDF del enunciado y la solución.')
  if (variant && !version.id) reasons.push('La variante necesita un identificador estable.')
  const usable = reasons.length === 0
  const sourceCode = String(version.codigo || version.latex || version.enunciado || '').replace(/(^|[^\\])%[^\n]*/g, '$1')
  if (!parts.length && /\\(?:begin\s*\{apartadosc?\}|ap\b)/.test(sourceCode)) reasons.push('Faltan los datos estructurados de los apartados.')
  if (!parts.length && !positiveScore(version.points ?? version.puntuacion ?? structure.puntuacion ?? sourceCode.match(/\\M\s*\{\s*([^{}]+)\s*\}/)?.[1])) reasons.push('Falta la puntuación del ejercicio.')
  parts.forEach((part, index) => {
    const label = `Apartado ${String.fromCharCode(97 + index)}`
    if (!positiveScore(part?.points ?? part?.puntuacion ?? String(part?.statement?.latex || part?.enunciado || '').match(/\\p\s*\{\s*([^{}]+)\s*\}/)?.[1])) reasons.push(`${label}: falta la puntuación.`)
    if (!String(part?.statement?.latex || part?.enunciado || '').trim()) reasons.push(`${label}: falta el enunciado.`)
    if (!String(part?.workedSolution?.latex || part?.solucion || '').trim()) reasons.push(`${label}: falta la solución.`)
    if (!unique([...(Array.isArray(part?.contentIds) ? part.contentIds : []), ...(Array.isArray(part?.contenidos) ? part.contenidos : [])]).length) reasons.push(`${label}: faltan los conceptos.`)
    const criteria = Array.isArray(part?.gradingCriteria) ? part.gradingCriteria : []
    if (!criteria.length || criteria.some((criterion) => !String(criterion?.description || '').trim() || !Number.isFinite(Number(criterion?.points)) || Number(criterion.points) <= 0)) reasons.push(`${label}: faltan criterios de calificación válidos.`)
    const partStatement = pdfStoragePath(part?.statement?.pdf || part?.pdfenunciado, exerciseId, bucketName)
    const partSolution = pdfStoragePath(part?.workedSolution?.pdf || part?.pdfsolucion, exerciseId, bucketName)
    if (!partStatement || !partSolution || partStatement === partSolution) reasons.push(`${label}: faltan los PDF del enunciado y la solución.`)
  })
  return { complete: reasons.length === 0, usable, reasons }
}

export function conceptAncestors(id, nodes) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]))
  const result = []
  const seen = new Set([id])
  let current = parents.get(id)
  while (current && !seen.has(current)) { result.push(current); seen.add(current); current = parents.get(current) }
  return result
}

export function permittedConcepts(selected, nodes) {
  const ids = new Set(unique(selected))
  nodes.forEach((node) => {
    if (conceptAncestors(node.id, nodes).some((id) => ids.has(id))) ids.add(node.id)
  })
  return ids
}

export function exerciseMatchesSelection(segmentConcepts, selected, nodes) {
  const allowed = permittedConcepts(selected, nodes)
  const segments = Array.isArray(segmentConcepts) ? segmentConcepts : []
  return allowed.size > 0 && segments.length > 0 && segments.every((segment) => {
    const ids = unique(segment)
    return ids.length > 0 && ids.every((id) => allowed.has(id) || conceptAncestors(id, nodes).some((ancestor) => allowed.has(ancestor)))
  })
}

// Exclude incomplete exercises: every assessed segment needs concepts,
// positive criteria and a solution. The result is derived on the server.
export function trainingSegments(version = {}) {
  const structuredParts = Array.isArray(version.parts) ? version.parts : []
  const legacyParts = Array.isArray(version.structure?.apartados) ? version.structure.apartados : []
  const parts = structuredParts.length ? structuredParts : legacyParts
  const makeSegment = (part, index) => {
    const criteria = (Array.isArray(part.gradingCriteria) ? part.gradingCriteria : []).map((criterion, at) => ({
      id: String(criterion.id || `criterion-${at + 1}`),
      description: String(criterion.description || '').trim(),
      points: Number(criterion.points),
    }))
    const conceptIds = unique([...(Array.isArray(part.contentIds) ? part.contentIds : []), ...(Array.isArray(part.contenidos) ? part.contenidos : [])])
    const solution = part.workedSolution?.latex || part.solucion || ''
    if (!conceptIds.length || !String(solution).trim() || !criteria.length
      || criteria.some((item) => !item.description || !Number.isFinite(item.points) || item.points <= 0)
      || new Set(criteria.map((item) => item.id)).size !== criteria.length) return null
    return { id: String(part.id || `part-${index + 1}`), conceptIds, criteria, maximum: criteria.reduce((sum, item) => sum + item.points, 0) }
  }
  if (parts.length) {
    const segments = parts.map(makeSegment)
    if (segments.some((segment) => !segment) || new Set(segments.map((segment) => segment.id)).size !== segments.length) return []
    return segments
  }
  const structure = version.structure || {}
  const single = makeSegment({
    ...structure, ...version,
    id: 'exercise',
    contentIds: unique([...[version.generalContentIds, version.contenidosGenerales, version.contenidos, structure.contenidos, version.curriculum?.conceptIds].flatMap((items) => Array.isArray(items) ? items : [])]),
    gradingCriteria: version.gradingCriteria || structure.gradingCriteria,
    workedSolution: version.workedSolution || (structure.solucion ? { latex: structure.solucion, pdf: structure.pdfsolucioncompleto || structure.pdfsolucion } : null),
  }, 0)
  return single ? [single] : []
}

export function trainingVersionPublished(exercise, variationId = null) {
  if (!variationId) return exercise?.studentTrainingPublished === true
  const variant = (exercise?.variaciones || []).find((item) => item?.id === variationId)
  if (!variant) return false
  return typeof variant.studentTrainingPublished === 'boolean' ? variant.studentTrainingPublished : exercise.studentTrainingPublished === true
}

export function selectTrainingCandidate(exercises, selected, nodes, completed = [], { repeat = false, active = [] } = {}) {
  const used = new Set(completed)
  const reserved = new Set(active)
  const original = []
  const variants = []
  for (const exercise of exercises || []) {
    const versions = [exercise, ...(Array.isArray(exercise.variaciones) ? exercise.variaciones : [])]
    versions.forEach((version, index) => {
      if (index && !version.id) return // Legacy variants without stable IDs cannot be tracked safely.
      if (!trainingVersionPublished(exercise, index ? version.id : null)) return
      let segments
      try { segments = trainingSegments(version) } catch { return }
      const pdf = version.pdf?.statement || version.pdf?.enunciado
      const solved = version.pdf?.solved || version.pdf?.resuelto
      if (!segments.length || !pdf || !solved || !exerciseMatchesSelection(segments.map((segment) => segment.conceptIds), selected, nodes)) return
      const key = `${exercise.id}:${index ? version.id : 'original'}`
      if (reserved.has(key) || (!repeat && used.has(key))) return
      ;(index ? variants : original).push({ exerciseId: exercise.id, variationId: index ? version.id : null, key, segments })
    })
  }
  return original[0] || variants[0] || null
}

export function conceptProgress(attempts, nodes) {
  const evidence = new Map()
  const parentIds = new Set(nodes.map((node) => node.parentId).filter(Boolean))
  for (const attempt of attempts) {
    if (attempt.status !== 'completed') continue
    const totals = new Map()
    for (const part of attempt.segments || []) {
      const max = Number(part.maximum)
      const earned = Number(part.obtained)
      if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(earned) || earned < 0 || earned > max) continue
      const targets = new Set()
      for (const id of unique(part.conceptIds)) { targets.add(id); conceptAncestors(id, nodes).forEach((parent) => targets.add(parent)) }
      targets.forEach((id) => {
        const total = totals.get(id) || { obtained: 0, maximum: 0 }
        total.obtained += earned; total.maximum += max; totals.set(id, total)
      })
    }
    totals.forEach((total, id) => {
      if (!evidence.has(id)) evidence.set(id, [])
      evidence.get(id).push({ ...total, date: attempt.completedAt || '', id: attempt.id || '' })
    })
  }
  return Object.fromEntries([...evidence].map(([id, entries]) => {
    const latest = entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id))).slice(0, 5)
    const obtained = latest.reduce((sum, item) => sum + item.obtained, 0)
    const maximum = latest.reduce((sum, item) => sum + item.maximum, 0)
    const percentage = parentIds.has(id)
      ? (maximum ? obtained / maximum * 100 : null)
      : latest.reduce((sum, item) => sum + item.obtained / item.maximum, 0) / 5 * 100
    return [id, { obtained, maximum, count: latest.length, provisional: latest.length < 5, percentage }]
  }))
}
