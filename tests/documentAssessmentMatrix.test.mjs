import assert from 'node:assert/strict'
import { assessmentExerciseModel } from '../src/utils/documentAssessmentMatrix.js'

const simple = assessmentExerciseModel({
  exerciseId: 'simple',
  version: 0,
  order: 0,
  structure: {
    pdfenunciadocompleto: 'statement.pdf',
    pdfsolucioncompleto: 'solved.pdf',
    achievements: [{ id: 'a1', description: 'Resuelve el problema', points: 2 }],
    apartados: [],
  },
})

assert.equal(simple.rows.length, 1)
assert.equal(simple.rows[0].kind, 'exercise')
assert.equal(simple.rows[0].pdf, 'solved.pdf')
assert.equal(simple.rows[0].achievements[0].key, 'simple:0:general:a1')

const segmented = assessmentExerciseModel({
  exerciseId: 'segmented',
  version: 2,
  order: 1,
  structure: {
    pdfenunciado: 'root-statement.pdf',
    pdfenunciadocompleto: 'complete-statement.pdf',
    pdfsolucioncompleto: 'complete-solved.pdf',
    achievements: [{ id: 'root', description: 'No debe mezclarse', points: 5 }],
    apartados: [
      { id: 'part-a', pdfsolucion: 'a-solved.pdf', achievements: [{ id: 'a', description: 'Primer logro', points: 1 }] },
      { id: 'part-b', pdfsolucion: 'b-solved.pdf', achievements: [{ id: 'b', description: 'Segundo logro', points: 1.5 }] },
    ],
  },
})

assert.deepEqual(segmented.rows.map((row) => row.kind), ['statement', 'part', 'part'])
assert.deepEqual(segmented.rows.map((row) => row.pdf), ['root-statement.pdf', 'a-solved.pdf', 'b-solved.pdf'])
assert.equal(segmented.rows[0].achievements.length, 0)
assert.deepEqual(segmented.rows[1].achievements.map((item) => item.key), ['segmented:2:part-a:a'])
assert.deepEqual(segmented.achievements.map((item) => item.id), ['a', 'b'])

console.log('documentAssessmentMatrix: ok')
