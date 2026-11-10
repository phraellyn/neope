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
