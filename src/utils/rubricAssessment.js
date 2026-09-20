function clone(value, fallback = null) {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function integer(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : fallback
}

function nullableInteger(value, fallback = null) {
  if (value === '-' || value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  return Number.isInteger(numeric) ? numeric : fallback
}

export function rubricSnapshot(rubric) {
  if (!rubric?.id) return null
  return {
    schemaVersion: Number(rubric.schemaVersion) || 1,
    id: rubric.id,
    title: String(rubric.title || 'Rúbrica'),
    shortName: Array.from(String(rubric.shortName || rubric.title || 'R').trim()).slice(0, 2).join(''),
    course: String(rubric.course || ''),
    subjectId: String(rubric.subjectId || ''),
    subjectTitle: String(rubric.subjectTitle || ''),
    categories: clone(rubric.categories, []).map((category) => ({
      id: category.id,
      title: String(category.title || 'Categoría'),
      type: category.type === 'range' ? 'range' : 'levels',
      defaultLevelId: category.defaultLevelId || null,
      levels: clone(category.levels, []).map((level) => ({
        id: level.id,
        description: String(level.description || ''),
        points: nullableInteger(level.points),
      })),
      range: {
        description: String(category.range?.description || ''),
        min: integer(category.range?.min),
        max: integer(category.range?.max, 3),
        default: integer(category.range?.default, 1),
      },
      alignment: clone(category.alignment, { criterionIds: [], descriptorEvidence: [], source: 'manual' }),
    })),
  }
}

function defaultCategoryScore(category) {
  if (category.type === 'range') {
    const min = Math.min(integer(category.range?.min), integer(category.range?.max, 3))
    const max = Math.max(integer(category.range?.min), integer(category.range?.max, 3))
    const preferred = integer(category.range?.default, min)
    return { type: 'range', points: Math.min(max, Math.max(min, preferred)) }
  }
  const selected = category.levels.find((level) => level.id === category.defaultLevelId)
    || category.levels[0]
  return {
    type: 'level',
    levelId: selected?.id || null,
    points: nullableInteger(selected?.points),
  }
}

function normalizeCategoryScore(category, score) {
  if (category.type === 'range') {
    const min = Math.min(integer(category.range?.min), integer(category.range?.max, 3))
    const max = Math.max(integer(category.range?.min), integer(category.range?.max, 3))
    const fallback = defaultCategoryScore(category).points
    return {
      type: 'range',
      points: Math.min(max, Math.max(min, integer(score?.points, fallback))),
    }
  }
  const selected = category.levels.find((level) => level.id === score?.levelId)
    || category.levels.find((level) => level.id === category.defaultLevelId)
    || category.levels[0]
  return {
    type: 'level',
    levelId: selected?.id || null,
    points: nullableInteger(selected?.points),
  }
}

export function rubricAssessmentTotal(assessment) {
  return Object.values(assessment?.categories || {}).reduce((total, score) => total + (Number(score?.points) || 0), 0)
}

export function createRubricAssessment(rubric, previous = null) {
  if (!rubric?.id) return null
  const categories = Object.fromEntries((rubric.categories || []).map((category) => [
    category.id,
    normalizeCategoryScore(category, previous?.categories?.[category.id]),
  ]))
  const assessment = {
    type: 'rubric',
    schemaVersion: 1,
    rubricId: rubric.id,
    categories,
  }
  assessment.total = rubricAssessmentTotal(assessment)
  return assessment
}

export function setRubricCategoryScore(assessment, category, value) {
  if (!assessment || !category?.id) return assessment
  if (category.type === 'range') {
    assessment.categories[category.id] = normalizeCategoryScore(category, { points: value })
  } else {
    assessment.categories[category.id] = normalizeCategoryScore(category, { levelId: value })
  }
  assessment.total = rubricAssessmentTotal(assessment)
  return assessment
}

export function rubricRangeValues(category) {
  const min = Math.min(integer(category?.range?.min), integer(category?.range?.max, 3))
  const max = Math.max(integer(category?.range?.min), integer(category?.range?.max, 3))
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}
