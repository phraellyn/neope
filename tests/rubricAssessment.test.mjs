import assert from 'node:assert/strict'
import {
  createRubricAssessment,
  rubricAssessmentTotal,
  rubricRangeValues,
  rubricSnapshot,
  setRubricCategoryScore,
} from '../src/utils/rubricAssessment.js'

const rubric = rubricSnapshot({
  id: 'rubric-1',
  title: 'Resolución de problemas',
  shortName: 'RP',
  course: '2ºBTO',
  subjectId: '2bto-matematicas-ii',
  subjectTitle: 'Matemáticas II',
  categories: [
    {
      id: 'argumentacion',
      title: 'Argumentación',
      type: 'levels',
      defaultLevelId: 'medio',
      levels: [
        { id: 'bajo', description: 'Incompleta', points: 0 },
        { id: 'medio', description: 'Correcta', points: 2 },
        { id: 'alto', description: 'Rigurosa', points: 4 },
      ],
    },
    {
      id: 'calculo',
      title: 'Cálculo',
      type: 'range',
      range: { description: 'Exactitud de los cálculos', min: 0, max: 3, default: 1 },
    },
  ],
})

assert.equal(rubric.shortName, 'RP')
assert.equal(rubric.categories[1].range.description, 'Exactitud de los cálculos')
assert.deepEqual(rubricRangeValues(rubric.categories[1]), [0, 1, 2, 3])

const assessment = createRubricAssessment(rubric)
assert.equal(assessment.categories.argumentacion.levelId, 'medio')
assert.equal(assessment.categories.argumentacion.points, 2)
assert.equal(assessment.categories.calculo.points, 1)
assert.equal(assessment.total, 3)

setRubricCategoryScore(assessment, rubric.categories[0], 'alto')
setRubricCategoryScore(assessment, rubric.categories[1], 3)
assert.equal(rubricAssessmentTotal(assessment), 7)
assert.equal(assessment.total, 7)

const restored = createRubricAssessment(rubric, assessment)
assert.deepEqual(restored, assessment)

console.log('rubricAssessment: ok')
