function referenceKey(reference = {}) {
  return `${reference.exerciseId || ''}:${Number(reference.version) || 0}`
}

/**
 * Completa las referencias ligeras guardadas en el cuaderno con las copias
 * estructuradas que conserva el propio documento. Los ejercicios creados por
 * IA para un documento no tienen por qué existir en la colección `ejercicios`.
 */
export function resolveDocumentAssessmentReferences(itemReferences = [], documentReferences = []) {
  const stored = (Array.isArray(documentReferences) ? documentReferences : [])
    .map((reference, order) => ({ ...reference, order: reference?.order ?? order }))
  const requested = Array.isArray(itemReferences) && itemReferences.length
    ? itemReferences.map((reference, order) => ({ ...reference, order: reference?.order ?? order }))
    : stored

  const byBlockId = new Map(stored.filter((reference) => reference?.blockId).map((reference) => [reference.blockId, reference]))
  const byKey = new Map(stored.map((reference) => [referenceKey(reference), reference]))

  return requested.map((reference, order) => {
    const embedded = (reference.blockId && byBlockId.get(reference.blockId))
      || stored.find((candidate) => (
        candidate.order === reference.order
        && referenceKey(candidate) === referenceKey(reference)
      ))
      || byKey.get(referenceKey(reference))
      || null
    return {
      ...(embedded || {}),
      ...reference,
      order: reference.order ?? embedded?.order ?? order,
      snapshot: reference.snapshot || embedded?.snapshot || null,
    }
  })
}
