import assert from 'node:assert/strict'
import { formatStudentResultDate, orderedStudentResults } from '../src/utils/studentResultDates.js'

const sorted = orderedStudentResults({ missing: 1, first: 2, last: 3, tied: 4 }, { first: '2026-01-10', last: '2026-11-02', tied: '2026-11-02' })
assert.deepEqual(sorted.map((item) => item.id), ['last', 'tied', 'first', 'missing'])
assert.equal(formatStudentResultDate('2026-11-02'), '2 de noviembre de 2026')
assert.equal(formatStudentResultDate(''), '')
assert.equal(formatStudentResultDate('2026-02-30'), '')
console.log('Fechas y orden de resultados verificados.')
