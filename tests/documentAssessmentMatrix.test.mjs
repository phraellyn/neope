import assert from 'node:assert/strict'
import { assessmentExerciseModel } from '../src/utils/documentAssessmentMatrix.js'
import { resolveDocumentAssessmentReferences } from '../src/utils/documentAssessmentReferences.js'
import { normalizedAssessmentSections } from '../src/utils/documentAssessmentEditor.js'
import { documentAssessmentLabels } from '../functions/documentAssessmentLabels.js'
import { setDocumentFeedback } from '../src/utils/documentAssessmentScore.js'
import { documentAssessmentNavigation } from '../src/utils/documentAssessmentNavigation.js'

const corrected = { total: 7.5, manualTotal: 7.5, selectedAchievementIds: ['one'] }
setDocumentFeedback(corrected, { text: 'Cuida la notación' })
setDocumentFeedback(corrected, { key: 'p3a', text: 'Explica el paso', exerciseLabel: 'Pregunta 3', sectionLabel: 'Apartado a', exerciseOrder: 2, sectionOrder: 1 })
assert.equal(corrected.feedback.general, 'Cuida la notación')
assert.equal(corrected.feedback.sections[0].text, 'Explica el paso')
assert.equal(corrected.total, 7.5)
assert.equal(corrected.manualTotal, 7.5)
assert.deepEqual(corrected.selectedAchievementIds, ['one'])
setDocumentFeedback(corrected, { key: 'p3a', text: '' })
assert.deepEqual(corrected.feedback.sections, [])

const selectionBlocks = [
  ...['1', '2', '3'].map((id) => ({ blockId: id, exerciseId: id })),
  { type: 'tool', toolId: 'selectividad-pregunta-4', children: ['4a', '4b'].map((id) => ({ blockId: id, exerciseId: id })) },
  { type: 'tool', toolId: 'selectividad-pregunta-5', children: ['5a', '5b'].map((id) => ({ blockId: id, exerciseId: id })) },
]
const selectionReferences = ['1', '2', '3', '4a', '4b', '5a', '5b'].map((id) => ({ blockId: id, exerciseId: id }))
const selectionLabels = documentAssessmentLabels({ plantillas: [{ archivo: 'selectividad-enunciado.tex' }], content: { blocks: selectionBlocks } }, selectionReferences)
assert.deepEqual(selectionLabels.map((item) => item.label), ['Pregunta 1', 'Pregunta 2', 'Pregunta 3', 'Pregunta 4.1', 'Pregunta 4.2', 'Pregunta 5.1', 'Pregunta 5.2'])
const third = assessmentExerciseModel({ exerciseId: '3', structure: { apartados: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, ...selectionLabels[2] })
assert.deepEqual(third.rows.slice(1).map((row) => row.label), ['Apartado a', 'Apartado b1', 'Apartado b2'])
assert.deepEqual(documentAssessmentNavigation([third]).map((item) => [item.label, item.exerciseIndex, item.rowKey]), [['3', 0, null], ['3A', 0, 'a'], ['3B1', 0, 'b'], ['3B2', 0, 'c']])
assert.deepEqual(documentAssessmentNavigation([{ label: 'Pregunta 4.1', rows: [{ kind: 'part', key: 'p', label: 'Apartado a' }] }]).map((item) => item.label), ['4.1', '4.1A'])
const repeatedA = assessmentExerciseModel({ exerciseId: 'same', sourceBlockId: 'first', structure: { apartados: [{ id: 'a' }] } })
const repeatedB = assessmentExerciseModel({ exerciseId: 'same', sourceBlockId: 'second', structure: { apartados: [{ id: 'a' }] } })
assert.notEqual(repeatedA.rows[1].feedbackKey, repeatedB.rows[1].feedbackKey)
const other = assessmentExerciseModel({ exerciseId: '4', structure: { apartados: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, ...selectionLabels[3] })
assert.deepEqual(other.rows.slice(1).map((row) => row.label), ['Apartado a', 'Apartado b', 'Apartado c'])
assert.deepEqual(documentAssessmentLabels({ plantillas: [{ archivo: 'examen-resuelto.tex' }], content: { blocks: selectionBlocks } }, selectionReferences).map((item) => item.label), selectionReferences.map((_, index) => `Ejercicio ${index + 1}`))

const editedSections = [{ maximum: 1, achievements: [{ id: 'a', description: ' Primer logro ', points: '0,25' }, { id: 'b', description: 'Segundo logro', points: 0.75 }] }]
assert.deepEqual(normalizedAssessmentSections(editedSections)[0].achievements.map(({ id, description, points }) => ({ id, description, points })), [
  { id: 'a', description: 'Primer logro', points: 0.25 }, { id: 'b', description: 'Segundo logro', points: 0.75 },
])
assert.equal(normalizedAssessmentSections([{ maximum: 1, achievements: [{ description: 'Logro', points: 0.3 }] }]), null)
assert.equal(normalizedAssessmentSections([{ maximum: 1, achievements: [{ description: 'Logro', points: 0.5 }] }]), null)
assert.equal(normalizedAssessmentSections([]), null)

const simple = assessmentExerciseModel({
  exerciseId: 'simple',
  version: 0,
  order: 0,
  structure: {
    pdfenunciadocompleto: 'statement.pdf',
    pdfsolucioncompleto: 'solved.pdf',
    gradingCriteria: [{ id: 'a1', description: 'Resuelve el problema', points: 2 }],
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
    gradingCriteria: [{ id: 'root', description: 'No debe mezclarse', points: 5 }],
    apartados: [
      { id: 'part-a', pdfsolucion: 'a-solved.pdf', gradingCriteria: [{ id: 'a', description: 'Primer logro', points: 1 }] },
      { id: 'part-b', pdfsolucion: 'b-solved.pdf', gradingCriteria: [{ id: 'b', description: 'Segundo logro', points: 1.5 }] },
    ],
  },
})

assert.deepEqual(segmented.rows.map((row) => row.kind), ['statement', 'part', 'part'])
assert.deepEqual(segmented.rows.map((row) => row.pdf), ['root-statement.pdf', 'a-solved.pdf', 'b-solved.pdf'])
assert.equal(segmented.rows[0].achievements.length, 0)
assert.deepEqual(segmented.rows[1].achievements.map((item) => item.key), ['segmented:2:part-a:a'])
assert.deepEqual(segmented.achievements.map((item) => item.id), ['a', 'b'])

const adjusted = assessmentExerciseModel({
  exerciseId: 'adjusted',
  structure: { apartados: [
    { id: 'a', gradingCriteria: [{ id: 'one', points: 0.25 }, { id: 'two', points: 0.25 }] },
    { id: 'b', gradingCriteria: [{ id: 'three', points: 0.75 }] },
    { id: 'c', gradingCriteria: [{ id: 'four', points: 0.75 }] },
  ] },
  metrics: { apartados: [{ puntuacion: 1 }, { puntuacion: 1 }, { puntuacion: 1 }] },
})
assert.deepEqual(adjusted.rows.slice(1).map((row) => row.achievements.map((item) => item.points)), [[0.5, 0.5], [1], [1]])
assert.deepEqual(adjusted.achievements.map((item) => item.id), ['one', 'two', 'three', 'four'])

const aligned = assessmentExerciseModel({
  exerciseId: 'aligned', structure: { apartados: [] },
  metrics: { puntuacion: 1 },
  assessment: { segments: { exercise: [{ id: 'a', points: 1 }, { id: 'b', points: 2 }] } },
})
assert.deepEqual(aligned.achievements.map((item) => item.points), [0.25, 0.75])

const equalShares = assessmentExerciseModel({
  exerciseId: 'equal', structure: { apartados: [] }, metrics: { puntuacion: 1 },
  assessment: { segments: { exercise: [{ id: 'a', points: 1 }, { id: 'b', points: 1 }, { id: 'c', points: 1 }] } },
})
assert.deepEqual(equalShares.achievements.map((item) => item.points), [0.5, 0.25, 0.25])
assert.equal(equalShares.achievements.reduce((sum, item) => sum + item.points, 0), 1)

const quantized = assessmentExerciseModel({
  exerciseId: 'quantized', structure: { apartados: [] }, metrics: { puntuacion: 1 },
  assessment: { segments: { exercise: [{ id: 'a', points: 0.4 }, { id: 'b', points: 0.6 }] } },
})
assert.deepEqual(quantized.achievements.map((item) => item.points), [0.5, 0.5])

const embeddedSnapshot = { id: 'generated', structure: { achievements: [{ id: 'achievement' }] } }
const resolvedReferences = resolveDocumentAssessmentReferences(
  [{ exerciseId: 'generated', version: 0, order: 0 }],
  [{ exerciseId: 'generated', version: 0, order: 0, blockId: 'block-1', snapshot: embeddedSnapshot }],
)
assert.equal(resolvedReferences.length, 1)
assert.equal(resolvedReferences[0].blockId, 'block-1')
assert.deepEqual(resolvedReferences[0].snapshot, embeddedSnapshot)
assert.deepEqual(resolveDocumentAssessmentReferences(
  [{ exerciseId: 'generated', metrics: { puntuacion: 2 } }],
  [{ exerciseId: 'generated', metrics: { puntuacion: 3 } }],
)[0].metrics, { puntuacion: 3 })

const directSnapshot = { id: 'newer' }
assert.deepEqual(
  resolveDocumentAssessmentReferences(
    [{ exerciseId: 'generated', version: 0, order: 0, snapshot: directSnapshot }],
    [{ exerciseId: 'generated', version: 0, order: 0, snapshot: embeddedSnapshot }],
  )[0].snapshot,
  directSnapshot,
)

console.log('documentAssessmentMatrix: ok')
