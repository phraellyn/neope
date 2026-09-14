import assert from 'node:assert/strict'
import {
  DOCUMENT_CONTENT_SCHEMA_VERSION,
  DOCUMENT_CONTENT_SOURCE_TYPES,
  createDocumentContent,
  createExerciseDocumentBlock,
  createToolDocumentBlock,
  documentContentFromRecord,
  replaceDocumentContentBlocks,
  replaceDocumentContentSource,
  replaceDocumentSurroundingLatex,
  serializeDocumentContent,
  touchDocumentContent,
} from '../src/utils/documentContent.js'

const legacy = documentContentFromRecord({
  bloques: [
    { exerciseId: 'exercise-a', version: 2, metrics: { puntuacion: '2,5', tiempo: '15' } },
    { toolId: 'optativos', args: { count: 1 } },
  ],
})

assert.equal(legacy.schemaVersion, DOCUMENT_CONTENT_SCHEMA_VERSION)
assert.equal(legacy.source.type, DOCUMENT_CONTENT_SOURCE_TYPES.EXERCISE_BANK)
assert.equal(legacy.blocks[0].type, 'exercise')
assert.equal(legacy.blocks[0].metrics.puntuacion, 2.5)
assert.equal(legacy.blocks[1].type, 'tool')
assert.equal(legacy.blocks[1].args.count, 1)
assert.ok(legacy.blocks.every((block) => block.blockId))

const exercise = createExerciseDocumentBlock('exercise-b', {
  metrics: { puntuacion: 1, tiempo: 8, apartados: [{ puntuacion: 1, tiempo: 8 }] },
  snapshot: { enunciado: '\\ej Ejercicio generado', curriculum: { subjectId: '2bto-matematicas-ii' } },
  generated: true,
  pageBreakBefore: true,
  sourcePage: 2,
})
assert.equal(exercise.snapshot.curriculum.subjectId, '2bto-matematicas-ii')
assert.equal(exercise.generated, true)
assert.equal(exercise.pageBreakBefore, true)
assert.equal(exercise.sourcePage, 2)
const tool = createToolDocumentBlock('salto-pagina')
const secondTool = createToolDocumentBlock('salto-pagina')
assert.notEqual(tool.blockId, secondTool.blockId)
const content = createDocumentContent({
  source: { type: DOCUMENT_CONTENT_SOURCE_TYPES.EXERCISE_BANK, revision: 3 },
  blocks: [exercise, tool],
  beforeExercisesLatex: '\\begin{tabular}{|l|l|}Pregunta&Respuesta\\\\\\hline\\end{tabular}',
})

assert.match(content.beforeExercisesLatex, /tabular/)
assert.equal(content.afterExercisesLatex, '')

const reordered = replaceDocumentContentBlocks(content, [tool, exercise], { touch: true })
assert.equal(reordered.source.revision, 4)
assert.equal(reordered.blocks[0].blockId, tool.blockId)
assert.equal(reordered.blocks[1].blockId, exercise.blockId)
assert.equal(reordered.beforeExercisesLatex, content.beforeExercisesLatex)

const surrounded = replaceDocumentSurroundingLatex(reordered, {
  beforeExercisesLatex: '\\noindent Datos previos',
  afterExercisesLatex: '\\vfill Fin',
})
assert.equal(surrounded.beforeExercisesLatex, '\\noindent Datos previos')
assert.equal(surrounded.afterExercisesLatex, '\\vfill Fin')

const touched = touchDocumentContent(reordered)
assert.equal(touched.source.revision, 5)

const latexSource = replaceDocumentContentSource(touched, {
  type: DOCUMENT_CONTENT_SOURCE_TYPES.LATEX,
  options: { code: '\\begin{ejercicios}\n\\ej Ejemplo\n\\end{ejercicios}' },
})
assert.equal(latexSource.source.type, DOCUMENT_CONTENT_SOURCE_TYPES.LATEX)
assert.equal(latexSource.source.revision, 6)
assert.match(latexSource.source.options.code, /Ejemplo/)
assert.equal(latexSource.blocks.length, 2)

const serialized = serializeDocumentContent(touched)
assert.deepEqual(serialized, touched)
serialized.blocks[0].args.changed = true
assert.equal(touched.blocks[0].args.changed, undefined)

const preferred = documentContentFromRecord({
  content,
  bloques: [{ exerciseId: 'ignored-legacy-exercise' }],
})
assert.equal(preferred.blocks[0].exerciseId, 'exercise-b')

console.log('documentContent: ok')
