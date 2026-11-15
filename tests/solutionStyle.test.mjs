import assert from 'node:assert/strict'
import { applicableSolutionStyle, normalizeSolutionStyle, solutionStylePrompt, teacherStylePrompt } from '../functions/solutionStyle.js'

const style = { enabled: true, general: 'Alinear en dos columnas', rules: [
  { id: 'limits', title: 'Límites', enabled: true, conceptIds: ['limits'], instructions: 'Marcar indeterminaciones', example: 'Ejemplo autorizado' },
  { id: 'always', title: 'General', enabled: true, conceptIds: [], instructions: 'Justificar' },
  { id: 'disabled', title: 'No aplicar', enabled: false, conceptIds: [], instructions: 'No debe aparecer' },
  { id: 'algebra', title: 'Álgebra', enabled: true, conceptIds: ['algebra'], instructions: 'Otra pauta' },
] }
assert.equal(solutionStylePrompt({ ...style, enabled: false }, ['limits']), '')
const selected = applicableSolutionStyle(style, ['limits', 'analysis'])
assert.deepEqual(selected.rules.map(r => r.id), ['limits', 'always'])
const prompt = solutionStylePrompt(style, ['limits'])
assert.match(prompt, /Marcar indeterminaciones/)
assert.match(prompt, /Ejemplo autorizado/)
assert.doesNotMatch(prompt, /Otra pauta|No debe aparecer/)
assert.deepEqual(normalizeSolutionStyle(null), { enabled: false, general: '', rules: [] })
assert.equal(normalizeSolutionStyle({ enabled: true, rules: [null] }).rules.length, 0)
const full = 'INICIO\n' + 'Guía completa con $\\lim$ y teoremas.\n'.repeat(1000) + 'FIN'
const fullPrompt = teacherStylePrompt({ estiloCompleto: full, estiloSoluciones: style }, ['algebra'])
assert.ok(fullPrompt.includes(full), 'La guía completa se envía sin recortarla ni filtrar por conceptos')
assert.doesNotMatch(fullPrompt, /Otra pauta/, 'No se duplica el estilo anterior')
assert.equal(teacherStylePrompt({}, ['limits']), '', 'Otro profesor sin guía no recibe la guía de esta cuenta')
assert.match(teacherStylePrompt({ estiloSoluciones: style }, ['limits']), /Marcar indeterminaciones/)
console.log('Estilo: activación, selección por conceptos y ejemplos correctos.')
