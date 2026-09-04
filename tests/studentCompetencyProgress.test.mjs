import assert from 'node:assert/strict'
import { calculateCompetencyProgress } from '../src/utils/studentCompetencyProgress.js'

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

console.log('studentCompetencyProgress tests passed')
