// Un duplicado debe recuperar siempre la misma identidad al volver a analizar
// el código, y nunca ocupar la identidad de otro apartado existente.
export function normalizeExercisePartIds(parts = []) {
  const reserved = new Set(parts.map((part) => part.id).filter(Boolean))
  const counts = new Map()
  parts.forEach((part) => counts.set(part.id, (counts.get(part.id) || 0) + 1))
  const used = new Set()
  return parts.map((part, index) => {
    let id = part.id || `part_${index + 1}`
    if (!part.id || used.has(id)) {
      const base = id
      let suffix = index + 1
      do { id = `${base}_recovered_${suffix++}` } while (reserved.has(id) || used.has(id))
    }
    used.add(id)
    const result = { ...part, id }
    // Los PDF de una identidad duplicada pueden haber sido sobrescritos por
    // otro apartado. Se regeneran; el texto y el resto de los datos se conservan.
    if (counts.get(part.id) > 1) {
      for (const field of ['statement', 'answer', 'workedSolution']) {
        if (result[field]) result[field] = { ...result[field], pdf: null }
      }
      for (const field of ['pdfenunciado', 'pdfsolucion', 'previewPdfEnunciado', 'previewPdfSolucion']) {
        if (field in result) result[field] = null
      }
    }
    return result
  })
}

export function assertUniqueExercisePartIds(parts = []) {
  const ids = parts.map((part) => part.id)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error('Hay apartados sin identificador o con identificadores repetidos. Abre el ejercicio y vuelve a compilar para reparar sus identidades.')
  }
}
