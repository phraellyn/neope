const states = {
  completeness: ['all', 'complete', 'incomplete'],
  publication: ['all', 'published', 'unpublished'],
  solution: ['all', 'ai', 'human'],
}

export function nextExerciseFilterState(group, current) {
  const options = states[group] || []
  return options.length ? options[(options.indexOf(current) + 1) % options.length] : 'all'
}

export function hasPublishedExerciseVersion(exercise = {}) {
  if (exercise.studentTrainingPublished === true) return true
  return Array.isArray(exercise.variaciones) && exercise.variaciones.some((version) => version?.studentTrainingPublished === true)
}

export function matchesExerciseStatusFilters({ complete, published, solutionOrigin }, { completeness = 'all', publication = 'all', solution = 'all' } = {}) {
  if (completeness === 'complete' && !complete) return false
  if (completeness === 'incomplete' && complete) return false
  if (publication === 'published' && !published) return false
  if (publication === 'unpublished' && published) return false
  if (solution !== 'all' && solutionOrigin !== solution) return false
  return true
}
