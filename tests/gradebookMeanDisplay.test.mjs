import assert from 'node:assert/strict'
import { formatGradebookMean, normalizeMeanDisplay } from '../src/utils/gradebookMeanDisplay.js'

assert.deepEqual(formatGradebookMean(6), { primary: '6,00', precise: '' })
assert.deepEqual(formatGradebookMean(7.25), { primary: '7,25', precise: '' })
assert.deepEqual(formatGradebookMean(null), { primary: '', precise: '' })
assert.deepEqual(formatGradebookMean(6.5, { mode: 'nearest', showBoth: true }), { primary: '7', precise: '6,50' })
assert.deepEqual(formatGradebookMean(6.99, { mode: 'truncate', showBoth: true }), { primary: '6', precise: '6,99' })
assert.deepEqual(formatGradebookMean(6, { mode: 'up', showBoth: true }), { primary: '6', precise: '6,00' })
assert.deepEqual(formatGradebookMean(6.01, { mode: 'up' }), { primary: '7', precise: '' })
assert.deepEqual(normalizeMeanDisplay({ mode: 'invalid', showBoth: true }), { mode: 'decimal', showBoth: true })
console.log('Opciones de presentación de medias verificadas.')
