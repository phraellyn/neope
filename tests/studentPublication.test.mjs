import assert from 'node:assert/strict'
import { publishedStudentData } from '../functions/studentPublication.js'

const group = { evaluation: { structure: [{ type: 'group', children: [{ type: 'item', id: 'public', nombre: 'Examen' }, { type: 'item', id: 'private', nombre: 'Sin publicar' }] }] } }
const results = { public: 8, private: 5, other: 9 }
const dates = [{ id: 'd1', programming: { date: '2026-11-12' }, campos: { title: 'Examen' } }, { id: 'd2', programming: { date: '2026-11-14' } }]
assert.deepEqual(publishedStudentData(group, results, [], dates).results, {})
const visible = publishedStudentData(group, results, [{ id: 'result-public', visible: true }, { id: 'result-private', visible: false }, { id: 'date-d1', visible: true }], dates)
assert.deepEqual(visible.results, { public: 8 })
assert.equal(visible.resultLabels.public, 'Examen')
assert.deepEqual(visible.upcoming.map((item) => item.id), ['d1'])
console.log('Solo se entregan fechas y resultados publicados.')
