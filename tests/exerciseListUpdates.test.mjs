import assert from 'node:assert/strict'
import { mergeExercisePage, nextExerciseResultTarget, putExerciseFirst, shouldLoadNextExercisePage } from '../src/utils/exerciseListUpdates.js'

const existing = [{ id: 'a', value: 'previous' }, { id: 'new', value: 'saved' }]
assert.deepEqual(putExerciseFirst(existing, { id: 'new', value: 'saved' }).map((item) => item.id), ['new', 'a'])
assert.deepEqual(putExerciseFirst(existing, { id: 'b' }).map((item) => item.id), ['b', 'a', 'new'])

const stalePage = [{ id: 'a', value: 'refreshed' }, { id: 'new', value: 'stale' }, { id: 'b' }]
const protectedIds = new Set(['new'])
assert.deepEqual(mergeExercisePage(existing, stalePage, { protectedIds }), [
  { id: 'a', value: 'refreshed' }, { id: 'new', value: 'saved' }, { id: 'b' },
])
assert.deepEqual(mergeExercisePage(existing, stalePage, { reset: true, protectedIds }), [
  { id: 'new', value: 'saved' }, { id: 'a', value: 'refreshed' }, { id: 'b' },
])
assert.equal(mergeExercisePage(existing, stalePage)[1].value, 'stale', 'Las lecturas posteriores pueden actualizar el ejercicio')
const state = { visible: true, hasMore: true, loading: false, matchCount: 1, targetCount: 20 }
assert.equal(shouldLoadNextExercisePage(state), true, 'Continúa buscando hasta reunir las primeras 20 coincidencias')
assert.equal(shouldLoadNextExercisePage({ ...state, loading: true }), false, 'No se solapan cargas')
assert.equal(shouldLoadNextExercisePage({ ...state, hasMore: false }), false, 'La búsqueda termina al agotar las páginas')
assert.equal(shouldLoadNextExercisePage({ ...state, visible: false }), false, 'Se detiene al abandonar la búsqueda')
assert.equal(shouldLoadNextExercisePage({ ...state, matchCount: 20 }), false, 'No se consultan más páginas tras reunir las primeras 20 coincidencias')
assert.equal(nextExerciseResultTarget({ ...state, matchCount: 20, distanceToBottom: 100 }), 40, 'El scroll cerca del final solicita el siguiente bloque')
assert.equal(nextExerciseResultTarget({ ...state, matchCount: 20, distanceToBottom: 900 }), 20, 'El scroll lejos del final no solicita más')
assert.equal(nextExerciseResultTarget({ ...state, matchCount: 25, hasMore: false, distanceToBottom: 100 }), 40, 'También se muestran resultados ya guardados en memoria')
assert.equal(nextExerciseResultTarget({ ...state, matchCount: 20, hasMore: false, distanceToBottom: 100 }), 20, 'No se solicita nada cuando no quedan resultados')
const pages = [
  [{ id: '1', course: '4ºESO' }, { id: '2', course: '3ºESO' }],
  [{ id: '3', course: '3ºESO' }, { id: '4', course: '2ºBTO' }],
  [{ id: '5', course: '4ºESO' }],
]
let loaded = [], page = 0
while (shouldLoadNextExercisePage({ ...state, matchCount: loaded.filter(item => item.course === '4ºESO').length, targetCount: 2, hasMore: page < pages.length })) {
  loaded = mergeExercisePage(loaded, pages[page++])
}
assert.deepEqual(loaded.filter(item => item.course === '4ºESO').map(item => item.id), ['1', '5'], 'Se encuentran coincidencias después de páginas sin resultados')
console.log('Listado: guardado inmediato y carga concurrente verificados.')
