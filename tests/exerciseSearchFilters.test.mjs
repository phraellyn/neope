import assert from 'node:assert/strict'
import { matchesExerciseStatusFilters as matches, nextExerciseFilterState } from '../src/utils/exerciseSearchFilters.js'
import { exerciseSolutionOrigin } from '../src/utils/exerciseCardMetadata.js'

for (const [group, options] of Object.entries({ completeness: ['all', 'complete', 'incomplete'], publication: ['all', 'published', 'unpublished'], solution: ['all', 'ai', 'human'] })) {
  options.forEach((state, index) => assert.equal(nextExerciseFilterState(group, state), options[(index + 1) % options.length]))
}
for (const complete of [false, true]) for (const published of [false, true]) for (const solutionOrigin of ['ai', 'human', 'unsolved']) {
  const item = { complete, published, solutionOrigin }
  assert.equal(matches(item), true)
  assert.equal(matches(item, { completeness: 'complete' }), complete)
  assert.equal(matches(item, { completeness: 'incomplete' }), !complete)
  assert.equal(matches(item, { publication: 'published' }), published)
  assert.equal(matches(item, { publication: 'unpublished' }), !published)
  assert.equal(matches(item, { solution: 'ai' }), solutionOrigin === 'ai')
  assert.equal(matches(item, { solution: 'human' }), solutionOrigin === 'human')
  assert.equal(matches(item, { completeness: 'complete', publication: 'published', solution: 'ai' }), complete && published && solutionOrigin === 'ai')
}
const human = { enunciado: '\\ej Enunciado\\begin{solucion}Resolución\\end{solucion}' }
assert.equal(exerciseSolutionOrigin(human), 'human')
assert.equal(exerciseSolutionOrigin({ ...human, solucionIA: true }), 'ai')
assert.equal(exerciseSolutionOrigin({ ...human, info: 'Generado por GPT-6' }), 'ai')
assert.equal(exerciseSolutionOrigin({ enunciado: '\\ej Sin solución' }), 'unsolved')
assert.equal(exerciseSolutionOrigin({ ...human, variaciones: [{ ...human }] }, 1), 'ai')
console.log('Filtros de tres estados y autoría verificados.')
