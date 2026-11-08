import assert from 'node:assert/strict'
import { matrixScore, newDocumentAssessment, resetDocumentScore, setManualDocumentScore, toggleDocumentAchievement } from '../src/utils/documentAssessmentScore.js'

const exercises = [{ achievements: [{ key: 'a', points: 2 }, { key: 'b', points: 3 }] }]
const result = { type: 'document', selectedAchievementIds: [], total: 0 }
toggleDocumentAchievement(result, { key: 'a' }, exercises)
assert.equal(result.total, 2)
assert.equal(setManualDocumentScore(result, 4.5), true)
toggleDocumentAchievement(result, { key: 'b' }, exercises)
assert.equal(result.total, 4.5, 'The manual grade remains authoritative as achievements change')
assert.deepEqual(result.selectedAchievementIds, ['a', 'b'])
assert.equal(matrixScore(result, exercises), 5)
const restored = JSON.parse(JSON.stringify(result))
assert.equal(restored.total, 4.5, 'The manual grade survives storage')
resetDocumentScore(restored, exercises)
assert.equal(restored.total, 5)
assert.equal('manualTotal' in restored, false)
assert.deepEqual(restored.selectedAchievementIds, ['a', 'b'])
assert.equal(setManualDocumentScore(restored, 0), true)
toggleDocumentAchievement(restored, { key: 'a' }, exercises)
assert.equal(restored.total, 0)
assert.equal(setManualDocumentScore(restored, -1), false)
assert.equal(newDocumentAssessment('7,5').manualTotal, 7.5)
assert.equal(newDocumentAssessment('').manualTotal, undefined)
console.log('Nota manual, selección conservada y restablecimiento: correctos.')
