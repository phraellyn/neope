const unique = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value))]

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

export function selectTrainingCandidate(exercises, selected, nodes, completed = [], { repeat = false, active = [] } = {}) {
  const used = new Set(completed)
  const reserved = new Set(active)
  const original = []
  const variants = []
  for (const exercise of exercises || []) {
    const versions = [exercise, ...(Array.isArray(exercise.variaciones) ? exercise.variaciones : [])]
    versions.forEach((version, index) => {
      if (index && !version.id) return // Legacy variants without stable IDs cannot be tracked safely.
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
