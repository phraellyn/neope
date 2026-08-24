import assert from 'node:assert/strict'

import {
  curriculumProfiles,
  curriculumPromptContext,
} from '../functions/curriculumContext.js'

assert.deepEqual(Object.keys(curriculumProfiles).sort(), [
  '1bto-matematicas-ccss-i',
  '1bto-matematicas-i',
  '1eso-matematicas',
  '2bto-matematicas-ccss-ii',
  '2bto-matematicas-ii',
  '2eso-matematicas',
  '3eso-matematicas',
  '4eso-matematicas-a',
  '4eso-matematicas-b',
])

const secondEso = curriculumPromptContext({
  subjectId: '2eso-matematicas',
  conceptPaths: [['Álgebra', 'Ecuaciones de primer grado']],
})
assert.match(secondEso, /2ºESO — Matemáticas/)
assert.match(secondEso, /13-14 años/)
assert.match(secondEso, /Álgebra > Ecuaciones de primer grado/)
assert.match(secondEso, /No uses trigonometría avanzada/)

const mathematicsTwo = curriculumPromptContext({ subjectId: '2bto-matematicas-ii' })
assert.match(mathematicsTwo, /Matemáticas II/)
assert.match(mathematicsTwo, /integral definida/)
assert.match(mathematicsTwo, /No introduzcas teoría universitaria/)

assert.equal(curriculumPromptContext({ subjectId: 'materia-inventada' }), '')
assert.equal(curriculumPromptContext(null), '')

console.log('curriculum prompt context: ok')
