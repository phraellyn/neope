import assert from 'node:assert/strict'
import { calculateCompetencyProgress } from '../src/utils/studentCompetencyProgress.js'
import { criterionStrength } from '../src/utils/criterionEvidence.js'

assert.equal(criterionStrength({ criterionEvidence: [{ criterionId: 'c', strength: 'weak' }], descriptorEvidence: [{ descriptorId: 'd', strength: 'strong' }] }, 'c', ['d']), 'weak')
assert.equal(criterionStrength({ descriptorEvidence: [{ descriptorId: 'd', strength: 'strong' }] }, 'c', ['d']), 'strong')

const globalLaw = {
  keyCompetencies: [{ id: 'stem', code: 'STEM' }, { id: 'ccl', code: 'CCL' }],
  operationalDescriptors: [
    { id: 'stem1', keyCompetencyId: 'stem' },
    { id: 'ccl1', keyCompetencyId: 'ccl' },
  ],
}

const empty = calculateCompetencyProgress({
  group: { alumnos: [{ id: 'a' }], evaluaciones: { estructura: [], resultados: {} } },
  studentId: 'a', globalLaw, subjectLaw: {},
})
assert.deepEqual(empty.map((item) => [item.studentPercent, item.groupPercent]), [[0, 0], [0, 0]])

const rubric = {
  categories: [{
    id: 'cat', type: 'range', range: { min: 0, max: 4 },
    alignment: { descriptorEvidence: [{ descriptorId: 'stem1', strength: 'strong' }] },
  }],
}
const documentAchievements = new Map([['exam', [{
  key: 'ex:0:general:one', points: 2,
  alignment: { descriptorEvidence: [{ descriptorId: 'ccl1', strength: 'medium' }] },
}]]])
const group = {
  alumnos: [{ id: 'a' }, { id: 'b' }],
  evaluaciones: {
    estructura: [
      { type: 'item', id: 'rubric', rubric },
      { type: 'item', id: 'exam', documentAssessment: {} },
    ],
    resultados: {
      a: {
        rubric: { type: 'rubric', categories: { cat: { points: 3 } } },
        exam: { type: 'document', selectedAchievementIds: ['ex:0:general:one'] },
      },
      b: {
        rubric: { type: 'rubric', categories: { cat: { points: 1 } } },
        exam: { type: 'document', selectedAchievementIds: [] },
      },
    },
  },
}
const result = calculateCompetencyProgress({ group, studentId: 'a', globalLaw, subjectLaw: {}, documentAchievements })
assert.equal(result.find((item) => item.id === 'stem').studentPercent, 75)
assert.equal(result.find((item) => item.id === 'stem').groupPercent, 50)
assert.equal(result.find((item) => item.id === 'ccl').studentPercent, 100)
assert.equal(result.find((item) => item.id === 'ccl').groupPercent, 50)

const subjectLaw = { evaluationCriteria: [
  { id: 'criterion-stem', descriptorIds: ['stem1'] },
  { id: 'criterion-ccl', descriptorIds: ['ccl1'] },
] }
const weighted = new Map([['exam', [{ key: 'a', points: 4, alignment: {
  criterionIds: ['criterion-stem', 'criterion-ccl'],
  criterionEvidence: [{ criterionId: 'criterion-stem', strength: 'strong' }, { criterionId: 'criterion-ccl', strength: 'weak' }],
  descriptorEvidence: [{ descriptorId: 'stem1', strength: 'weak' }, { descriptorId: 'ccl1', strength: 'strong' }],
} }]]])
const weightedResult = calculateCompetencyProgress({ group, studentId: 'a', globalLaw, subjectLaw, documentAchievements: weighted })
assert.equal(weightedResult.find((item) => item.id === 'stem').maximum, 7)
assert.equal(weightedResult.find((item) => item.id === 'ccl').maximum, 1)

console.log('studentCompetencyProgress tests passed')
