import assert from 'node:assert/strict'
import { conceptProgress, exerciseMatchesSelection, selectTrainingCandidate, trainingSegments } from '../functions/studentTrainingLogic.js'
import { calculateConceptProgress } from '../src/utils/conceptProgressLabel.js'
import { pauseTimer, resetTimer, resumeTimer, timerElapsed, timerWarning } from '../src/utils/studentTrainingTimer.js'

const nodes = [{ id: 'root' }, { id: 'a', parentId: 'root' }, { id: 'b', parentId: 'root' }, { id: 'a1', parentId: 'a' }, { id: 'a2', parentId: 'a' }]
assert.equal(exerciseMatchesSelection([['a1']], ['a'], nodes), true)
assert.equal(exerciseMatchesSelection([['a1'], ['b']], ['a'], nodes), false)
assert.equal(exerciseMatchesSelection([['a2']], ['a1'], nodes), false)
const result = calculateConceptProgress(nodes, conceptProgress([{ id: '1', status: 'completed', segments: [{ conceptIds: ['a1', 'a2'], maximum: 2, obtained: 1 }] }], nodes))
assert.equal(result.a.percentage, 50)
assert.equal(result.root.percentage, 25, 'Los hijos no trabajados cuentan como cero')
assert.equal(result.root.workedChildCount, 1)
assert.equal(result.a.provisional, true)
assert.equal(result.b.worked, false)
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
const bank = [{ id: 'x', ...exercise, pdf: { statement: 'statement.pdf', solved: 'solved.pdf' }, variaciones: [{ ...exercise, id: 'v1', pdf: { statement: 's.pdf', solved: 'r.pdf' } }] }]
assert.equal(selectTrainingCandidate(bank, ['a'], nodes).key, 'x:original')
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original']).key, 'x:v1')
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original', 'x:v1']), null)
assert.equal(selectTrainingCandidate(bank, ['a'], nodes, ['x:original'], { repeat: true }).key, 'x:original')
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
