import assert from 'node:assert/strict'
import { madridDay, validTrainingDateRange, completedInTrainingDateRange } from '../functions/trainingDateRange.js'

assert.equal(validTrainingDateRange({ from: '', to: '' }), true)
assert.equal(validTrainingDateRange({ from: '2026-02-29', to: '' }), false)
assert.equal(validTrainingDateRange({ from: '2026-11-23', to: '2026-11-22' }), false)
const range = { from: '2026-11-23', to: '2026-11-23' }
assert.equal(completedInTrainingDateRange({ status: 'completed', completedAt: '2026-11-22T23:00:00Z' }, range), true)
assert.equal(completedInTrainingDateRange({ status: 'completed', completedAt: '2026-11-23T22:59:59Z' }, range), true)
assert.equal(completedInTrainingDateRange({ status: 'completed', completedAt: '2026-11-23T23:00:00Z' }, range), false)
assert.equal(completedInTrainingDateRange({ status: 'completed', completedAt: '2026-11-22T22:59:59Z' }, range), false)
assert.equal(completedInTrainingDateRange({ status: 'in_progress', completedAt: '2026-11-23T12:00:00Z' }, range), false)
assert.equal(completedInTrainingDateRange({ status: 'completed' }, range), false)
assert.equal(completedInTrainingDateRange({ status: 'completed' }, {}), true)
assert.equal(completedInTrainingDateRange({ status: 'completed', completedAt: '2026-07-01T22:30:00Z' }, { from: '2026-07-02', to: '2026-07-02' }), true)
assert.equal(madridDay(new Date('2026-11-22T23:30:00Z')), '2026-11-23')
console.log('Intervalo de ejercicios y límites horarios verificados.')
