// Pure planning shared by the callable and the document preview.
export function uniqueConceptIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
}

export function terminalVariationConcepts(ids, concepts = []) {
  const parents = new Map(concepts.map((node) => [node.id, node.parentId]))
  const ancestors = (id) => {
    const seen = new Set()
    let current = parents.get(id)
    while (current && !seen.has(current)) { seen.add(current); current = parents.get(current) }
    return seen
  }
  const unique = uniqueConceptIds(ids)
  return unique.filter((id) => !unique.some((other) => other !== id && ancestors(other).has(id)))
}

export function planDocumentVariation({ slots, conceptIds = [], candidates = [], mode = 'cloned', excludedIds = [], concepts = [] }) {
  const required = terminalVariationConcepts([...conceptIds, ...slots.flatMap((slot) => slot.conceptIds || [])], concepts)
  const requiredSet = new Set(required)
  const targets = slots.map((slot) => terminalVariationConcepts(slot.conceptIds, concepts).filter((id) => requiredSet.has(id)))
  const assigned = new Set(targets.flat())
  for (const id of required.filter((concept) => !assigned.has(concept))) {
    const index = targets.reduce((best, ids, at) => ids.length < targets[best].length ? at : best, 0)
    targets[index].push(id)
  }
  if (required.length) targets.forEach((ids, index) => { if (!ids.length) ids.push(required[index % required.length]) })
  const excluded = new Set([...excludedIds, ...slots.map((slot) => slot.sourceExerciseId).filter(Boolean)])
  const used = new Set()
  const remaining = new Set(required)
  const parents = new Map(concepts.map((node) => [node.id, node.parentId]))
  const pool = candidates.map((candidate) => {
    const coverage = new Set(candidate.conceptIds)
    candidate.conceptIds.forEach((id) => {
      let parent = parents.get(id)
      const seen = new Set()
      while (parent && !seen.has(parent)) { seen.add(parent); coverage.add(parent); parent = parents.get(parent) }
    })
    return { ...candidate, coverage: required.filter((id) => coverage.has(id)) }
  })
  const plans = slots.map((slot, index) => {
    let ids = targets[index]
    const eligible = mode === 'variant' ? pool.filter((candidate) => !excluded.has(candidate.exerciseId) && !used.has(candidate.exerciseId)
      && candidate.coverage.length && (!remaining.size || candidate.coverage.some((id) => remaining.has(id)))) : []
    eligible.sort((left, right) => {
      const score = (candidate) => candidate.coverage.filter((id) => remaining.has(id)).length * 1000
        + candidate.coverage.filter((id) => targets[index].includes(id)).length * 10
        - Math.abs((candidate.partCount || 0) - (slot.partCount || 0)) * 2
        - candidate.conceptIds.filter((id) => !requiredSet.has(id)).length
      return score(right) - score(left) || left.exerciseId.localeCompare(right.exerciseId)
    })
    let chosen = eligible[0]
    // Variant mode covers the document globally; topics may move between slots.
    if (mode === 'variant') {
      if (index === slots.length - 1 && chosen && [...remaining].some((id) => !chosen.coverage.includes(id))) chosen = null
      ids = chosen ? chosen.coverage : remaining.size ? [...remaining].slice(0, Math.ceil(remaining.size / (slots.length - index))) : targets[index]
      ids.forEach((id) => remaining.delete(id))
    }
    if (chosen) used.add(chosen.exerciseId)
    return {
      slotId: slot.slotId, requiredConceptIds: ids,
      origin: mode === 'cloned' ? 'cloned' : chosen ? 'bank' : 'new',
      exerciseId: chosen?.exerciseId || null, version: chosen?.version || 0,
      variationId: chosen?.variationId || null,
      label: chosen?.label || (mode === 'cloned' ? 'Ejercicio original' : 'Ejercicio nuevo para cubrir los conceptos'),
    }
  })
  return { mode, conceptIds: required, slots: plans, bankCount: plans.filter((slot) => slot.origin === 'bank').length, newCount: plans.filter((slot) => slot.origin === 'new').length }
}
