export function assessmentPoints(value) {
  return Number(String(value ?? '').replace(',', '.'))
}

export function assessmentSectionTotal(section) {
  return (section.achievements || []).reduce((sum, item) => {
    const value = assessmentPoints(item.points)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
}

export function isValidAssessmentSection(section) {
  return (section.achievements || []).every((item) => {
    const value = assessmentPoints(item.points)
    return Boolean(String(item.description || '').trim()) && String(item.points ?? '').trim() !== ''
      && Number.isFinite(value) && value >= 0 && Math.abs(value * 4 - Math.round(value * 4)) < 1e-8
  }) && Math.abs(assessmentSectionTotal(section) - section.maximum) < 1e-8
}

export function normalizedAssessmentSections(sections) {
  if (!Array.isArray(sections) || !sections.length || !sections.every(isValidAssessmentSection)) return null
  return sections.map((section) => ({ ...section, achievements: section.achievements.map((item) => ({
    ...item, description: item.description.trim(), points: assessmentPoints(item.points),
  })) }))
}
