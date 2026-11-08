import assert from 'node:assert/strict'
import { examPdfCandidates, examResultItem, safeExamAssessment, safeExamExercise } from '../functions/studentExam.js'
import { aggregateExerciseStructure, exerciseStructureFromDocument } from '../src/utils/exerciseStructure.js'
import { assessmentExerciseModel } from '../src/utils/documentAssessmentMatrix.js'

const doc = { plantillas: [{ key: 'statement', nombre: 'Examen - Enunciado' }, { key: 'solved', nombre: 'Examen - Resuelto' }], pdfs: [{ templateKey: 'statement', path: 'documentos/doc/statement.pdf' }, { templateKey: 'solved', path: 'documentos/doc/solved.pdf' }] }
assert.deepEqual(examPdfCandidates(doc, 'doc', 'bucket').map((item) => item.path), ['documentos/doc/solved.pdf', 'documentos/doc/statement.pdf'])
assert.deepEqual(examPdfCandidates({ pdf: { path: 'documentos/other/file.pdf' } }, 'doc', 'bucket'), [])
const group = { evaluation: { structure: [{ type: 'group', children: [{ type: 'item', id: 'exam', documentAssessment: { documentId: 'doc' } }] }] } }
assert.equal(examResultItem(group, 'exam').documentAssessment.documentId, 'doc')
assert.equal(examResultItem(group, 'missing'), null)
const safe = safeExamExercise({ schemaVersion: 3, secret: 'private', statement: { latex: 'private', pdf: { url: 'secret' } }, parts: [{ id: 'a', gradingCriteria: [{ id: 'c', description: 'Paso', points: 2, secret: 'private' }], workedSolution: { pdf: 'secret' } }] })
assert.equal(JSON.stringify(safe).includes('secret'), false)
assert.equal(safe.parts[0].gradingCriteria[0].description, 'Paso')
const model = assessmentExerciseModel({ exerciseId: 'ex', version: 0, structure: aggregateExerciseStructure(exerciseStructureFromDocument(safe)) })
assert.equal(model.achievements[0].key, 'ex:0:a:c')
assert.deepEqual(safeExamAssessment({ segments: { a: [{ id: 'x', description: 'Logro', points: 1, secret: 'private' }] } }).segments.a[0], { id: 'x', description: 'Logro', points: 1 })
console.log('PDF preferido y datos limitados de examen verificados.')
