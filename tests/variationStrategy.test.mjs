import assert from 'node:assert/strict'
import { variationStrategyFromAnalysis } from '../functions/variationStrategy.js'

const valid = { core: 'Derivadas', skills: ['Justificar'], difficulty: 'Bachillerato', solutionOutline: 'Derivar y estudiar signos', transformationPlan: 'Cambiar la familia de funciones', invariants: ['Mismos apartados'] }
const parsed = variationStrategyFromAnalysis(JSON.stringify(valid))
assert.equal(parsed.usedFallback, false)
assert.match(parsed.strategy, /Cambiar la familia de funciones/)
for (const invalid of ['', '{"core":"Límites', JSON.stringify({ ...valid, skills: null }), JSON.stringify({ ...valid, transformationPlan: '' })]) {
  const result = variationStrategyFromAnalysis(invalid)
  assert.equal(result.usedFallback, true)
  assert.match(result.strategy, /realiza internamente un análisis/)
  assert.match(result.strategy, /respeta las indicaciones del profesor/)
}
console.log('Análisis experimental válido e incompleto: estrategias verificadas.')
