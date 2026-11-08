import assert from 'node:assert/strict'
import { conceptProgressLabel } from '../src/utils/conceptProgressLabel.js'
assert.equal(conceptProgressLabel({ worked: false, percentage: 0 }), 'No trabajado')
assert.match(conceptProgressLabel({ worked: true, percentage: 0, count: 1, provisional: true }), /^0 % · 1\/5 intentos/)
assert.match(conceptProgressLabel({ worked: true, percentage: 25, childCount: 4, workedChildCount: 1 }), /^25 % · 1\/4 contenidos trabajados/)
console.log('Distinción entre contenidos no trabajados y calificaciones cero: correcta.')
