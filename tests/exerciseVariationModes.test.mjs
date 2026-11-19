import assert from 'node:assert/strict'
import { applyReferenceCriterionPoints, exerciseVariationMode, validReferenceCriteria, validateConceptVariation } from '../functions/exerciseVariationModes.js'

assert.equal(exerciseVariationMode('original'), 'original')
assert.equal(exerciseVariationMode('concepts'), 'concepts')
assert.equal(exerciseVariationMode(undefined), 'legacy', 'Los clientes anteriores mantienen su comportamiento')
const valid = String.raw`\ej \M{2}
\begin{apartados}
\ap \p{0,75} Primera pregunta. \begin{solucion}Primera resolución.\end{solucion}
\ap \p{1,25} Segunda pregunta. \begin{solucion}Segunda resolución.\end{solucion}
\end{apartados}`
assert.deepEqual(validateConceptVariation(valid), [])
assert.deepEqual(validateConceptVariation(String.raw`\ej \M{1} Una cuestión nueva. \begin{solucion}Una resolución.\end{solucion}`), [], 'El modo por contenidos admite un ejercicio sin apartados')
assert.ok(validateConceptVariation(valid.replace('\\p{1,25}', '\\p{1}')).some((item) => item.includes('suma')))
assert.ok(validateConceptVariation(valid.replace('\\p{0,75}', '')).some((item) => item.includes('puntuación positiva')))
assert.ok(validateConceptVariation(valid.replace('\\begin{solucion}Segunda resolución.\\end{solucion}', '')).some((item) => item.includes('solución')))
assert.ok(validateConceptVariation(valid + '\n\\ej Otro ejercicio').some((item) => item.includes('exactamente un')))
assert.ok(validateConceptVariation(valid.replace('\\ap \\p{0,75}', '% neope:part id=dup\n\\ap \\p{0,75}').replace('\\ap \\p{1,25}', '% neope:part id=dup\n\\ap \\p{1,25}')).some((item) => item.includes('repetirse')))
const reference = [{ description: 'Primera habilidad', points: 0.75 }, { description: 'Segunda habilidad', points: 1.25 }]
assert.equal(validReferenceCriteria(reference, 2), true)
assert.equal(validReferenceCriteria(reference, 3), false)
assert.equal(validReferenceCriteria([{ description: '', points: 2 }], 2), false)
assert.deepEqual(applyReferenceCriterionPoints([{ description: 'Adaptación A', points: 1 }, { description: 'Adaptación B', points: 1 }], reference).map((criterion) => criterion.points), [0.75, 1.25])
assert.equal(applyReferenceCriterionPoints([{ description: 'Solo uno' }], reference), null)
console.log('Modos de variantes y estructura de ejercicios por contenidos verificados.')
