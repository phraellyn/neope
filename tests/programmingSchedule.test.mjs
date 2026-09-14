import assert from 'node:assert/strict'
import {
  programmingDatesForGroup,
  programmingSessionsForGroup,
  reconcileProgrammingSessions,
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
assert.equal(sessions[0].sequenceIndex, 0)
assert.equal(sessions[0].id.includes('2026-09-07'), false, 'La fecha no debe formar parte de la identidad estable.')
assert.deepEqual(programmingDatesForGroup(calendar, group), ['2026-09-07'], 'La navegación del aula conserva fechas únicas de clase ordinaria.')

const originalCalendar = {
  ...calendar,
  days: { ...calendar.days, '2026-09-09': undefined },
}
delete originalCalendar.days['2026-09-09']
const originalSessions = programmingSessionsForGroup(originalCalendar, group)
const persisted = originalSessions.map((session, index) => ({
  ...session,
  id: `2026-legacy-${index}`,
  notes: `Contenido ${index + 1}`,
}))
const shifted = reconcileProgrammingSessions(sessions, persisted, group)
assert.equal(shifted[0].id, persisted[0].id, 'Una sesión migrada conserva su ID aunque cambie su fecha.')
assert.equal(shifted[0].notes, 'Contenido 1', 'El contenido acompaña a la posición lectiva, no a la fecha antigua.')
assert.equal(shifted[0].date, sessions[0].date)

const shiftGroup = {
  ...group,
  horario: [
    { dia: 0, tramo: 0, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II' },
    { dia: 2, tramo: 0, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II' },
    { dia: 4, tramo: 0, subjectId: '2bto-matematicas-ii', subject: 'Matemáticas II' },
  ],
}
const shiftCalendar = {
  types: calendar.types,
  days: { '2026-09-07': 'start', '2026-09-18': 'end' },
}
const beforeHoliday = programmingSessionsForGroup(shiftCalendar, shiftGroup)
  .map((session) => ({ ...session, notes: `Sesión ${session.sequenceIndex + 1}` }))
const withHoliday = programmingSessionsForGroup({
  ...shiftCalendar,
  days: { ...shiftCalendar.days, '2026-09-09': 'holiday' },
}, shiftGroup)
const shiftedAfterHoliday = reconcileProgrammingSessions(withHoliday, beforeHoliday, shiftGroup)
assert.equal(shiftedAfterHoliday[1].notes, 'Sesión 2')
assert.equal(shiftedAfterHoliday[1].date, '2026-09-11', 'La segunda sesión se desplaza al siguiente día lectivo disponible.')
assert.equal(shiftedAfterHoliday[1].id, beforeHoliday[1].id, 'La referencia estable sobrevive al desplazamiento de fecha.')

console.log('Programming schedule tests passed')
