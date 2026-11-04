import assert from 'node:assert/strict'
import { documentMatchesGroupLevel } from '../src/utils/programmingDocuments.js'

const group = { id: 'group-a', curso: '2º ESO', nombre: '2º ESO A' }
assert.equal(documentMatchesGroupLevel({ curriculum: { course: '2ºESO' } }, group), true)
assert.equal(documentMatchesGroupLevel({ curriculum: { course: '1ºESO' } }, group), false)
assert.equal(documentMatchesGroupLevel({ campos: { nivel: '2 ESO' } }, group), true)
assert.equal(documentMatchesGroupLevel({ campos: { curso: '2º ESO B' } }, group), true)
assert.equal(documentMatchesGroupLevel({ curriculum: { subjectId: '2eso-matematicas' } }, group), true)
assert.equal(documentMatchesGroupLevel({ curriculum: { course: '1ºESO' }, groupContext: { id: group.id } }, group), false)
assert.equal(documentMatchesGroupLevel({ groupContext: { id: group.id } }, group), true)
assert.equal(documentMatchesGroupLevel({ campos: { curso: '2º ESO A' } }, group), true)
assert.equal(documentMatchesGroupLevel({ campos: { curso: '2º B' } }, group), false)
assert.equal(documentMatchesGroupLevel({}, group), false)
assert.equal(documentMatchesGroupLevel({ curriculum: { course: '2º Bachillerato' } }, { curso: '2ºBTO' }), true)
assert.equal(documentMatchesGroupLevel({ curriculum: { course: '1ºBTO' } }, { curso: '2ºBTO' }), false)
console.log('El selector limita los documentos al nivel del grupo y reconoce datos anteriores.')
