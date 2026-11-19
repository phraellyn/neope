import assert from 'node:assert/strict'
import { cleanGenerationInstructions, documentGenerationInstructions, solutionGenerationInstruction } from '../functions/generationInstructions.js'

assert.equal(cleanGenerationInstructions('  Evita los radicales.  '), 'Evita los radicales.')
assert.equal(cleanGenerationInstructions(undefined), '')
assert.equal(cleanGenerationInstructions('x'.repeat(4000)).length, 3000)
assert.equal(documentGenerationInstructions('generate', 'curriculum', ' Evita radicales '), 'Evita radicales')
assert.equal(documentGenerationInstructions('align', 'curriculum', 'No alterar'), '')
assert.equal(documentGenerationInstructions('exercise', 'exercise-image', 'No alterar'), '')
assert.equal(documentGenerationInstructions('generate', 'image', 'No alterar'), '')
assert.equal(solutionGenerationInstruction(''), '')
assert.match(solutionGenerationInstruction('  Utiliza Rolle.  '), /sin cambiar el enunciado/)
assert.match(solutionGenerationInstruction('  Utiliza Rolle.  '), /Utiliza Rolle\.$/)
console.log('Indicaciones opcionales: limpieza, límites y ámbito verificados.')
