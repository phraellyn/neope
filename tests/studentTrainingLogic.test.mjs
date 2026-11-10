import assert from 'node:assert/strict'
import { conceptProgress, exerciseMatchesSelection, selectTrainingCandidate, trainingReadiness, trainingSegments } from '../functions/studentTrainingLogic.js'
import { calculateConceptProgress } from '../src/utils/conceptProgressLabel.js'
import { pauseTimer, resetTimer, resumeTimer, timerElapsed, timerWarning } from '../src/utils/studentTrainingTimer.js'

const nodes = [{ id: 'root' }, { id: 'a', parentId: 'root' }, { id: 'b', parentId: 'root' }, { id: 'a1', parentId: 'a' }, { id: 'a2', parentId: 'a' }]
assert.equal(exerciseMatchesSelection([['a1']], ['a'], nodes), true)
assert.equal(exerciseMatchesSelection([['a1'], ['b']], ['a'], nodes), false)
assert.equal(exerciseMatchesSelection([['a2']], ['a1'], nodes), false)
const result = calculateConceptProgress(nodes, conceptProgress([{ id: '1', status: 'completed', segments: [{ conceptIds: ['a1', 'a2'], maximum: 2, obtained: 1 }] }], nodes))
assert.equal(result.a.percentage, 10, 'Un intento al 50 % ocupa una de las cinco posiciones')
assert.equal(result.root.percentage, 5, 'Los hijos no trabajados cuentan como cero')
assert.equal(result.root.workedChildCount, 1)
assert.equal(result.a.provisional, true)
assert.equal(result.b.worked, false)
const unequalAttempts = conceptProgress([
  { id: 'one', status: 'completed', segments: [{ conceptIds: ['a1'], maximum: 2, obtained: 2 }] },
  { id: 'two', status: 'completed', segments: [{ conceptIds: ['a1'], maximum: 10, obtained: 5 }] },
], nodes)
assert.equal(unequalAttempts.a1.percentage, 30, 'Cada intento aporta su porcentaje y los tres restantes cuentan como cero')
const perfectAttempts = Array.from({ length: 5 }, (_, index) => ({ id: `perfect-${index}`, status: 'completed', completedAt: `2026-01-0${index + 1}`, segments: [{ conceptIds: ['a1'], maximum: 3, obtained: 3 }] }))
for (let count = 1; count <= 5; count++) assert.equal(conceptProgress(perfectAttempts.slice(0, count), nodes).a1.percentage, count * 20)
const rolling = [...perfectAttempts, { id: 'new', status: 'completed', completedAt: '2026-01-06', segments: [{ conceptIds: ['a1'], maximum: 3, obtained: 0 }] }]
assert.equal(conceptProgress(rolling, nodes).a1.percentage, 80, 'El sexto intento sustituye al más antiguo')
const history = Array.from({ length: 6 }, (_, index) => ({
  id: String(index), status: 'completed', completedAt: `2026-01-0${index + 1}`,
  segments: [{ conceptIds: ['a1'], maximum: 1, obtained: index === 0 ? 0 : 1 }],
}))
history.push({ id: 'zero', status: 'completed', completedAt: '2026-02-01', segments: [{ conceptIds: ['a2'], maximum: 1, obtained: 0 }] })
history.push({ id: 'parent', status: 'completed', segments: [{ conceptIds: ['a'], maximum: 1, obtained: 1 }] })
const detailed = calculateConceptProgress(nodes, conceptProgress(history, nodes))
assert.equal(detailed.a1.count, 5)
assert.equal(detailed.a1.percentage, 100, 'Solo se usan los cinco intentos más recientes')
assert.equal(detailed.a2.percentage, 0)
assert.equal(detailed.a2.worked, true, 'Un cero obtenido no es un concepto sin trabajar')
assert.equal(detailed.a.percentage, 50)
assert.equal(detailed.root.percentage, 25, 'Cada hijo inmediato pesa lo mismo, incluso con ramas de distinta profundidad')
assert.equal(detailed.b.worked, false)
const parentOnly = calculateConceptProgress(nodes, conceptProgress([{ status: 'completed', segments: [{ conceptIds: ['a'], maximum: 1, obtained: 1 }] }], nodes))
assert.equal(parentOnly.a.worked, false, 'Un concepto padre no se atribuye a hijos desconocidos')
const exercise = { parts: [{ id: 'p1', contentIds: ['a1'], gradingCriteria: [{ id: 'c1', description: 'Calcula', points: 2 }], workedSolution: { latex: 'Solución', pdf: { storagePath: 'ejercicios/x/sol.pdf' } } }] }
assert.equal(trainingSegments(exercise)[0].maximum, 2)
assert.deepEqual(trainingSegments({ ...exercise, contenidosGenerales: ['b'] })[0].conceptIds, ['a1'])
assert.deepEqual(trainingSegments({ parts: [{ ...exercise.parts[0], contentIds: [] }] }), [])
assert.deepEqual(trainingSegments({ parts: [{ ...exercise.parts[0], workedSolution: null }] }), [])
assert.deepEqual(trainingSegments({ parts: [exercise.parts[0], exercise.parts[0]] }), [])
assert.equal(trainingSegments({ contenidosGenerales: [], contenidos: ['a1'], gradingCriteria: [{ id: 'c', description: 'Paso', points: 1 }], workedSolution: { latex: 'Solución' } })[0].conceptIds[0], 'a1')
const bank = [{ id: 'x', ...exercise, studentTrainingPublished: true, pdf: { statement: 'statement.pdf', solved: 'solved.pdf' }, variaciones: [{ ...exercise, id: 'v1', pdf: { statement: 's.pdf', solved: 'r.pdf' } }] }]
assert.equal(selectTrainingCandidate(bank, ['a'], nodes).key, 'x:original')
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original']).key, 'x:v1')
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original', 'x:v1']), null)
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original'], { repeat: true }).key, 'x:original')
assert.equal(selectTrainingCandidate([{ ...bank[0], studentTrainingPublished: false }], ['a'], nodes), null)
assert.equal(selectTrainingCandidate([{ ...bank[0], studentTrainingPublished: undefined }], ['a'], nodes), null, 'Los ejercicios existentes no se publican por defecto')
const separate = { ...bank[0], studentTrainingPublished: false, variaciones: [{ ...bank[0].variaciones[0], studentTrainingPublished: true }] }
assert.equal(selectTrainingCandidate([separate], ['a'], nodes).key, 'x:v1', 'Una variante publicada funciona aunque el original esté oculto')
assert.equal(selectTrainingCandidate([{ ...separate, studentTrainingPublished: true, variaciones: [{ ...separate.variaciones[0], studentTrainingPublished: false }] }], ['a'], nodes, ['x:original']), null, 'Una variante oculta no se propone aunque el original esté publicado')
const ready = { ...exercise, parts: [{ ...exercise.parts[0], points: 2, statement: { latex: 'Calcula el apartado', pdf: { storagePath: 'ejercicios/x/part-statement.pdf' } } }], statement: { latex: 'Calcula' }, pdf: { statement: { storagePath: 'ejercicios/x/statement.pdf' }, solved: { storagePath: 'ejercicios/x/solved.pdf' } } }
assert.equal(trainingReadiness(ready, { exerciseId: 'x', bucketName: 'bucket' }).complete, true)
assert.equal(trainingReadiness({ ...ready, parts: [{ ...ready.parts[0], contentIds: [] }] }, { exerciseId: 'x', bucketName: 'bucket' }).complete, false)
assert.equal(trainingReadiness({ ...ready, pdf: {} }, { exerciseId: 'x', bucketName: 'bucket' }).complete, false)
assert.equal(trainingReadiness(ready, { exerciseId: 'x', bucketName: 'bucket', variant: true }).complete, false)
const noPartPdf = { ...ready, parts: [{ ...ready.parts[0], statement: { latex: 'Calcula el apartado' } }] }
assert.equal(trainingReadiness(noPartPdf, { exerciseId: 'x', bucketName: 'bucket' }).complete, false, 'Sin PDF de apartado no se marca completo')
assert.equal(trainingReadiness(noPartPdf, { exerciseId: 'x', bucketName: 'bucket' }).usable, true, 'Los PDF completos bastan para el entrenamiento')
assert.equal(trainingReadiness({ ...ready, parts: [{ ...ready.parts[0], workedSolution: { latex: 'Solución' } }] }, { exerciseId: 'x', bucketName: 'bucket' }).complete, false, 'Se comprueba también el PDF de solución del apartado')
const missingStatement = trainingReadiness({ ...ready, parts: [{ ...ready.parts[0], statement: { pdf: ready.parts[0].statement.pdf } }] }, { exerciseId: 'x', bucketName: 'bucket' })
assert.ok(missingStatement.reasons.some((reason) => reason.includes('Apartado a: falta el enunciado')))
const missingScore = trainingReadiness({ ...ready, parts: [{ ...ready.parts[0], points: 0 }] }, { exerciseId: 'x', bucketName: 'bucket' })
assert.equal(missingScore.complete, false)
assert.equal(missingScore.usable, true, 'La comprobación de integridad no cambia la publicación')
assert.ok(missingScore.reasons.some((reason) => reason.includes('Apartado a: falta la puntuación')))
const wholeExercise = { statement: { latex: 'Calcula' }, points: 2, contenidos: ['a1'], gradingCriteria: [{ id: 'c', description: 'Resultado', points: 2 }], workedSolution: { latex: 'Dos' }, pdf: ready.pdf }
assert.equal(trainingReadiness(wholeExercise, { exerciseId: 'x', bucketName: 'bucket' }).complete, true)
assert.ok(trainingReadiness({ ...wholeExercise, points: 0 }, { exerciseId: 'x', bucketName: 'bucket' }).reasons.includes('Falta la puntuación del ejercicio.'))
assert.equal(trainingReadiness({ ...wholeExercise, points: '1,25' }, { exerciseId: 'x', bucketName: 'bucket' }).complete, true)
const secondPart = { ...ready.parts[0], id: 'p2', points: undefined, puntuacion: '1,5' }
assert.equal(trainingReadiness({ ...ready, parts: [ready.parts[0], secondPart] }, { exerciseId: 'x', bucketName: 'bucket' }).complete, true)
assert.ok(trainingReadiness({ ...ready, parts: [ready.parts[0], { ...secondPart, puntuacion: '' }] }, { exerciseId: 'x', bucketName: 'bucket' }).reasons.includes('Apartado b: falta la puntuación.'))
const noStructuredParts = trainingReadiness({ ...ready, parts: [], codigo: '\\begin{apartados}\\ap Calcula\\end{apartados}' }, { exerciseId: 'x', bucketName: 'bucket' })
assert.ok(noStructuredParts.reasons.some((reason) => reason.includes('datos estructurados de los apartados')))
let timer = { elapsedMs: 0, runningSince: 1000, alerted: false }
timer = pauseTimer(timer, 6000)
assert.equal(timerElapsed(timer, 9000), 5000)
timer = resumeTimer(timer, 9000)
assert.equal(timerWarning(timer, 6000, 10000), true)
timer.alerted = true
assert.equal(timerWarning(timer, 6000, 11000), false)
timer = resetTimer(timer, 12000)
assert.equal(timerElapsed(timer, 13000), 1000)
assert.equal(timer.alerted, false)
console.log('Selección de conceptos, agregación y cronómetro del alumno: correctos.')
