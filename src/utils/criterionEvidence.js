const rank = { weak: 1, medium: 2, strong: 3 }

export function criterionStrength(alignment = {}, criterionId, descriptorIds = []) {
  const direct = (alignment.criterionEvidence || []).find((item) => item.criterionId === criterionId && rank[item.strength])
  if (direct) return direct.strength
  const relevant = new Set(descriptorIds)
  return (alignment.descriptorEvidence || []).filter((item) => relevant.has(item.descriptorId))
    .reduce((best, item) => (rank[item.strength] || 0) > (rank[best] || 0) ? item.strength : best, '')
}

export function criterionDescriptorIds(subjectLaw = {}, criterionId) {
  const competencies = subjectLaw.specificCompetencies || []
  const criteria = [...(subjectLaw.evaluationCriteria || []), ...competencies.flatMap((competency) => (competency.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competency.id })))]
  const criterion = criteria.find((item) => item.id === criterionId)
  const competency = competencies.find((item) => item.id === criterion?.competenceId)
  return [...new Set([...(criterion?.descriptorIds || []), ...(competency?.descriptorIds || [])])]
}
