export function putExerciseFirst(exercises, exercise) {
  return [exercise, ...exercises.filter((item) => item.id !== exercise.id)]
}

export function mergeExercisePage(existing, incoming, { reset = false, protectedIds = new Set() } = {}) {
  const byId = new Map((reset ? existing.filter((item) => protectedIds.has(item.id)) : existing).map((item) => [item.id, item]))
  for (const exercise of incoming) {
    if (!protectedIds.has(exercise.id) || !byId.has(exercise.id)) byId.set(exercise.id, exercise)
  }
  return [...byId.values()]
}

// Los filtros se aplican sobre las páginas ya recibidas: se continúa buscando
// hasta reunir el número solicitado, incluso si hay páginas sin coincidencias.
export function shouldLoadNextExercisePage({ visible, hasMore, loading, matchCount, targetCount }) {
  if (!visible || !hasMore || loading) return false
  return matchCount < targetCount
}

export function nextExerciseResultTarget({ visible, loading, matchCount, targetCount, hasMore, distanceToBottom, batchSize = 20 }) {
  if (!visible || loading || distanceToBottom > 420 || matchCount < targetCount) return targetCount
  return matchCount > targetCount || hasMore ? targetCount + batchSize : targetCount
}
