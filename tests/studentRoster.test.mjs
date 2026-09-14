import assert from 'node:assert/strict'
import {
  nextSourceGroup,
  normalizedSourceGroup,
  shortStudentName,
  sourceGroupOptions,
} from '../src/utils/studentRoster.js'

assert.equal(shortStudentName('GARCÍA LÓPEZ, María'), 'María')
assert.equal(shortStudentName('GARCÍA LÓPEZ, María del Mar'), 'María del Mar')
assert.equal(shortStudentName('Sin coma'), '')
assert.deepEqual(sourceGroupOptions('2ºBTO A+C'), ['A', 'C'])
assert.deepEqual(sourceGroupOptions('1ºESO B'), [])
assert.equal(normalizedSourceGroup('', ['A', 'C']), 'A')
assert.equal(nextSourceGroup('A', ['A', 'C']), 'C')
assert.equal(nextSourceGroup('C', ['A', 'C']), 'A')

console.log('Student roster tests passed')
