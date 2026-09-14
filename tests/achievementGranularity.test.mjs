import assert from 'node:assert/strict'
import {
  achievementGranularityInstructions,
  isLowerSecondaryCourse,
} from '../functions/achievementGranularity.js'

assert.equal(isLowerSecondaryCourse('1ºESO'), true)
assert.equal(isLowerSecondaryCourse('2.º ESO'), true)
assert.equal(isLowerSecondaryCourse('3ºESO B'), true)
assert.equal(isLowerSecondaryCourse('4ºESO'), false)
assert.equal(isLowerSecondaryCourse('2ºBTO'), false)

const lower = achievementGranularityInstructions('1ºESO')
assert.match(lower, /Reduce a común denominador/)
assert.match(lower, /0,25/)
assert.match(lower, /2 y 4 logros/)

const upper = achievementGranularityInstructions('2ºBTO')
assert.match(upper, /logros más integrados/)
assert.match(upper, /1 y 3 logros/)
assert.doesNotMatch(upper, /Reduce a común denominador/)

const unknown = achievementGranularityInstructions('')
assert.match(unknown, /Ajusta el desglose al nivel del curso/)

console.log('Achievement granularity tests passed')
