const EVIDENCE_WEIGHT = { weak: 1, medium: 2, strong: 3 }

function finiteNonNegative(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

function flattenItems(nodes = []) {
  return (Array.isArray(nodes) ? nodes : []).flatMap((node) => (
    node?.type === 'group' ? flattenItems(node.children) : (node?.type === 'item' ? [node] : [])
  ))
}

function categoryMaximum(category = {}) {
  if (category.type === 'range') return finiteNonNegative(category.range?.max)
  return Math.max(0, ...(category.levels || []).map((level) => finiteNonNegative(level.points)))
}

function criterionDescriptorIds(subjectLaw = {}, criterionIds = []) {
  const selected = new Set(criterionIds)
  const competencies = new Map((subjectLaw.specificCompetencies || []).map((item) => [item.id, item]))
  const topLevel = Array.isArray(subjectLaw.evaluationCriteria) ? subjectLaw.evaluationCriteria : []
  const nested = (subjectLaw.specificCompetencies || []).flatMap((competency) => (
    (competency.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competency.id }))
  ))
  return [...new Set([...topLevel, ...nested]
    .filter((criterion) => selected.has(criterion.id))
    .flatMap((criterion) => [
      ...(criterion.descriptorIds || []),
      ...(competencies.get(criterion.competenceId)?.descriptorIds || []),
    ]))]
}

function competencyShares(alignment = {}, descriptorToCompetency, subjectLaw) {
  let evidence = (alignment.descriptorEvidence || []).filter((item) => descriptorToCompetency.has(item?.descriptorId))
  if (!evidence.length) {
    evidence = criterionDescriptorIds(subjectLaw, alignment.criterionIds)
      .filter((descriptorId) => descriptorToCompetency.has(descriptorId))
      .map((descriptorId) => ({ descriptorId, strength: 'medium' }))
  }
  const weights = new Map()
  evidence.forEach(({ descriptorId, strength }) => {
    const competencyId = descriptorToCompetency.get(descriptorId)
    const weight = EVIDENCE_WEIGHT[strength] || EVIDENCE_WEIGHT.medium
    weights.set(competencyId, (weights.get(competencyId) || 0) + weight)
  })
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0)
  return total > 0
    ? [...weights].map(([competencyId, weight]) => ({ competencyId, share: weight / total }))
    : []
}

function addAlignedScore(totals, alignment, obtained, maximum, context) {
  if (maximum <= 0) return
  competencyShares(alignment, context.descriptorToCompetency, context.subjectLaw).forEach(({ competencyId, share }) => {
    const target = totals.get(competencyId)
    if (!target) return
    target.obtained += Math.min(maximum, Math.max(0, obtained)) * share
    target.maximum += maximum * share
  })
}

function studentTotals(studentId, items, documentAchievements, context) {
  const totals = new Map(context.competencies.map((competency) => [competency.id, { obtained: 0, maximum: 0 }]))
  const results = context.results?.[studentId] || {}

  items.forEach((item) => {
    const result = results[item.id]
    if (!result || typeof result !== 'object') return

    if (item.rubric && result.type === 'rubric') {
      ;(item.rubric.categories || []).forEach((category) => {
        const categoryResult = result.categories?.[category.id]
        // Un nivel neutro equivale a «no observado / no aplicable»: conserva
        // la elección en la rúbrica, pero no crea evidencia ni puntos máximos.
        if (categoryResult?.points === null || categoryResult?.points === undefined) return
        addAlignedScore(
          totals,
          category.alignment,
          finiteNonNegative(categoryResult.points),
          categoryMaximum(category),
          context,
        )
      })
    }

    if (item.documentAssessment && result.type === 'document') {
      const selected = new Set(result.selectedAchievementIds || [])
      ;(documentAchievements.get(item.id) || []).forEach((achievement) => {
        const points = finiteNonNegative(achievement.points)
        addAlignedScore(totals, achievement.alignment, selected.has(achievement.key) ? points : 0, points, context)
      })
    }
  })
  return totals
}

/**
 * Calcula el porcentaje competencial de un alumno y la media de los alumnos
 * que ya tienen evidencias evaluadas. Una competencia sin puntos posibles se
 * mantiene en 0 %, evitando divisiones por cero.
 */
export function calculateCompetencyProgress({
  group,
  studentId,
  globalLaw,
  subjectLaw,
  documentAchievements = new Map(),
}) {
  const competencies = Array.isArray(globalLaw?.keyCompetencies) ? globalLaw.keyCompetencies : []
  const descriptorToCompetency = new Map((globalLaw?.operationalDescriptors || [])
    .filter((descriptor) => descriptor?.id && descriptor?.keyCompetencyId)
    .map((descriptor) => [descriptor.id, descriptor.keyCompetencyId]))
  const items = flattenItems(group?.evaluaciones?.estructura || group?.evaluation?.structure)
  const results = group?.evaluaciones?.resultados || group?.evaluation?.results || {}
  const context = { competencies, descriptorToCompetency, subjectLaw: subjectLaw || {}, results }
  const targetTotals = studentTotals(studentId, items, documentAchievements, context)
  const studentIds = (group?.alumnos || group?.students || [])
    .map((student) => typeof student === 'string' ? student : (student?.id || student?.codigo))
    .filter(Boolean)
  const allTotals = studentIds.map((id) => studentTotals(id, items, documentAchievements, context))

  return competencies.map((competency) => {
    const target = targetTotals.get(competency.id) || { obtained: 0, maximum: 0 }
    const assessedPercentages = allTotals
      .map((totals) => totals.get(competency.id) || { obtained: 0, maximum: 0 })
      .filter((total) => total.maximum > 0)
      .map((total) => (total.obtained / total.maximum) * 100)
    const studentPercent = target.maximum > 0 ? (target.obtained / target.maximum) * 100 : 0
    const groupPercent = assessedPercentages.length
      ? assessedPercentages.reduce((sum, value) => sum + value, 0) / assessedPercentages.length
      : 0
    return {
      ...competency,
      obtained: target.obtained,
      maximum: target.maximum,
      studentPercent: Math.max(0, Math.min(100, studentPercent)),
      groupPercent: Math.max(0, Math.min(100, groupPercent)),
      assessedStudents: assessedPercentages.length,
    }
  })
}
