export function matrixScore(result, exercises) {
  const selected = new Set(result?.selectedAchievementIds || [])
  return (exercises || []).flatMap((exercise) => exercise.achievements || []).reduce((sum, item) => sum + (selected.has(item.key) ? Number(item.points) || 0 : 0), 0)
}

export function newDocumentAssessment(previous) {
  const result = { type: 'document', total: 0, selectedAchievementIds: [], updatedAt: new Date().toISOString() }
  if ((typeof previous === 'number' || (typeof previous === 'string' && previous.trim())) && Number.isFinite(Number(String(previous).replace(',', '.')))) {
    const value = Number(String(previous).replace(',', '.'))
    if (value >= 0) { result.total = value; result.manualTotal = value }
  }
  return result
}

export function toggleDocumentAchievement(result, achievement, exercises) {
  const selected = new Set(result.selectedAchievementIds || [])
  if (selected.has(achievement.key)) selected.delete(achievement.key)
  else selected.add(achievement.key)
  result.selectedAchievementIds = [...selected]
  if (!Number.isFinite(result.manualTotal)) result.total = matrixScore(result, exercises)
}

export function setManualDocumentScore(result, value) {
  if (!Number.isFinite(value) || value < 0) return false
  result.manualTotal = value
  result.total = value
  return true
}

export function resetDocumentScore(result, exercises) {
  delete result.manualTotal
  result.total = matrixScore(result, exercises)
}
