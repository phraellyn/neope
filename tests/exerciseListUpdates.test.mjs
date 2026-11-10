import assert from 'node:assert/strict'
import { mergeExercisePage, putExerciseFirst } from '../src/utils/exerciseListUpdates.js'

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
console.log('Listado: guardado inmediato y carga concurrente verificados.')
