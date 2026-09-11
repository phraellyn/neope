import assert from 'node:assert/strict'
import {
  programmingDatesForGroup,
  programmingSessionsForGroup,
} from '../src/utils/programmingSchedule.js'

const calendar = {
  types: [
    { id: 'start', eventKey: 'inicio-curso', cursos: ['legacy-group'], lectivo: true },
    { id: 'end', eventKey: 'fin-curso', cursos: ['legacy-group'], lectivo: true },
    { id: 'holiday', eventKey: 'festivo', cursos: [], lectivo: false },
  ],
  days: {
    '2026-09-07': 'start',
    '2026-09-09': 'holiday',
    '2026-09-11': 'end',
  },
}

const group = {
  id: 'primary-group',
  relatedGroupIds: ['primary-group', 'legacy-group'],
  subjectId: '2bto-matematicas-ii',
  asignatura: 'Matemáticas II',
  color: '#557FB4',
  horario: [
    { dia: 0, tramo: 0, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II' },
    { dia: 0, tramo: 4, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II', tutorType: 'tutoria-grupo' },
    { dia: 2, tramo: 1, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II' },
    { dia: 4, tramo: 2, subjectId: 'otra-asignatura', subject: 'Otra asignatura' },
  ],
}

const sessions = programmingSessionsForGroup(calendar, group)
assert.equal(sessions.length, 2, 'El lunes debe generar una clase y una tutoría; el miércoles es festivo y la otra asignatura se ignora.')
assert.equal(new Set(sessions.map((session) => session.id)).size, 2, 'Cada sesión de una misma fecha debe tener identidad propia.')
assert.deepEqual(sessions.map((session) => session.sessionType), ['teaching', 'tutoring'])
assert.equal(sessions[0].primaryForDate, true)
assert.equal(sessions[1].primaryForDate, false)
assert.equal(sessions[1].title, 'Tutoría con grupo')
assert.notEqual(sessions[0].color, sessions[1].color)
assert.deepEqual(programmingDatesForGroup(calendar, group), ['2026-09-07'], 'La navegación del aula conserva fechas únicas de clase ordinaria.')

console.log('Programming schedule tests passed')
