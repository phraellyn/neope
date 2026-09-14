const TUTOR_TITLES = Object.freeze({
  'tutoria-individual': 'Tutoría individual',
  'tutoria-grupo': 'Tutoría con grupo',
})

function dateFromIso(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
}

function isoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizedToken(value, fallback = 'segmento') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
}

export function programmingStreamKey(session = {}, group = {}) {
  const tutorType = session.tutorType || null
  if (tutorType) return `tutoring:${normalizedToken(tutorType)}`
  const subject = session.subjectId || group.subjectId || session.subject || group.asignatura || group.subject || 'clase'
  return `teaching:${normalizedToken(subject)}`
}

function stableSessionId(streamKey, sequenceIndex) {
  return `${normalizedToken(streamKey, 'sesion')}--${String(sequenceIndex + 1).padStart(4, '0')}`
}

function darkenColor(color, factor = 0.48) {
  const value = String(color || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/iu.test(value)) return '#294568'
  const channels = [0, 2, 4].map((offset) => (
    Math.max(0, Math.min(255, Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * factor)))
  ))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function calendarEntryAppliesToGroup(type, group) {
  const courses = Array.isArray(type?.cursos) ? type.cursos.filter(Boolean) : []
  if (!courses.length) return true
  const identities = new Set([
    group?.id,
    group?.nombre,
    group?.name,
    ...(Array.isArray(group?.relatedGroupIds) ? group.relatedGroupIds : []),
    ...(Array.isArray(group?.legacyIds) ? group.legacyIds : []),
  ].filter(Boolean))
  return courses.some((course) => identities.has(course))
}

function relevantScheduleSegments(group = {}) {
  const schedule = Array.isArray(group.horario) ? group.horario : []
  return schedule
    .filter((segment) => {
      const day = Number(segment?.dia)
      if (!Number.isInteger(day) || day < 0 || day > 4) return false
      if (segment?.tutorType) return true
      if (segment?.subjectId && group.subjectId && segment.subjectId !== group.subjectId) return false
      return true
    })
    .map((segment, order) => ({ ...segment, order }))
    .sort((left, right) => Number(left.dia) - Number(right.dia)
      || Number(left.tramo) - Number(right.tramo)
      || left.order - right.order)
}

function sessionFor(date, segment, group, ordinaryColor) {
  const tutorType = segment.tutorType || null
  const kind = tutorType ? 'tutoring' : 'teaching'
  const subjectId = segment.subjectId || group.subjectId || null
  const subject = segment.subject || group.asignatura || group.subject || ''
  const segmentKey = [
    `d${Number(segment.dia)}`,
    `m${Number(segment.tramo)}`,
    tutorType || subjectId || normalizedToken(subject),
  ].join('-')
  const baseColor = segment.color || ordinaryColor || group.color || '#E8F0FB'
  const streamKey = programmingStreamKey({ tutorType, subjectId, subject }, group)
  return {
    id: '',
    date,
    sessionKey: segmentKey,
    streamKey,
    sequenceIndex: null,
    sessionType: kind,
    title: tutorType ? (TUTOR_TITLES[tutorType] || 'Tutoría') : (subject || 'Clase'),
    color: tutorType ? (segment.color || darkenColor(ordinaryColor || group.color)) : baseColor,
    tutorType,
    subjectId,
    subject,
    dayIndex: Number(segment.dia),
    moduleIndex: Number(segment.tramo),
    primaryForDate: false,
  }
}

function compareProgrammingDays(left, right) {
  return String(left.date || '').localeCompare(String(right.date || ''))
    || Number(left.dayIndex ?? 99) - Number(right.dayIndex ?? 99)
    || Number(left.moduleIndex ?? 99) - Number(right.moduleIndex ?? 99)
    || String(left.id || '').localeCompare(String(right.id || ''))
}

/**
 * Asocia las sesiones calculadas con registros persistidos sin utilizar la
 * fecha como identidad. Los documentos antiguos conservan su ID para no
 * romper referencias; su posición dentro del flujo lectivo pasa a ser la
 * identidad lógica.
 */
export function reconcileProgrammingSessions(sessions = [], existingDays = [], group = {}) {
  const targets = sessions.map((session) => ({
    ...session,
    streamKey: session.streamKey || programmingStreamKey(session, group),
  }))
  const existing = existingDays.map((day) => ({
    ...day,
    streamKey: day.streamKey || programmingStreamKey(day, group),
  }))
  const claimedIds = new Set()
  const resolved = new Map()

  const claim = (session, day) => {
    if (!day || claimedIds.has(day.id)) return false
    claimedIds.add(day.id)
    resolved.set(session.id, { ...day, ...session, id: day.id })
    return true
  }

  targets.forEach((session) => {
    const exact = existing.find((day) => day.id === session.id && day.streamKey === session.streamKey)
    claim(session, exact)
  })

  targets.filter((session) => !resolved.has(session.id)).forEach((session) => {
    const indexed = existing.find((day) => (
      !claimedIds.has(day.id)
      && day.streamKey === session.streamKey
      && Number.isInteger(day.sequenceIndex)
      && day.sequenceIndex === session.sequenceIndex
    ))
    claim(session, indexed)
  })

  const streamKeys = [...new Set(targets.map((session) => session.streamKey))]
  streamKeys.forEach((streamKey) => {
    const pendingSessions = targets
      .filter((session) => session.streamKey === streamKey && !resolved.has(session.id))
      .sort((left, right) => left.sequenceIndex - right.sequenceIndex)
    const candidates = existing
      .filter((day) => day.streamKey === streamKey && !claimedIds.has(day.id))
      .sort(compareProgrammingDays)
    pendingSessions.forEach((session, index) => claim(session, candidates[index]))
  })

  return targets.map((session) => resolved.get(session.id) || session)
}

export function programmingSessionsForGroup(calendar = {}, group = {}) {
  const types = new Map((calendar.types || []).map((type) => [type.id, type]))
  const assignments = Object.entries(calendar.days || {})
    .map(([date, typeId]) => ({ date, type: types.get(typeId) }))
    .filter((entry) => entry.type && calendarEntryAppliesToGroup(entry.type, group))
  const starts = assignments.filter((entry) => entry.type.eventKey === 'inicio-curso').map((entry) => entry.date).sort()
  const ends = assignments.filter((entry) => entry.type.eventKey === 'fin-curso').map((entry) => entry.date).sort()
  if (!starts.length || !ends.length) return []

  const start = dateFromIso(starts[0])
  const end = dateFromIso(ends.at(-1))
  if (!start || !end || start > end) return []

  const segments = relevantScheduleSegments(group)
  if (!segments.length) return []
  const ordinaryColor = segments.find((segment) => !segment.tutorType)?.color || group.color || '#E8F0FB'
  const sessions = []

  for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    const weekday = current.getDay()
    if (weekday === 0 || weekday === 6) continue
    const date = isoDate(current)
    const assignedType = types.get(calendar.days?.[date])
    if (assignedType && calendarEntryAppliesToGroup(assignedType, group) && assignedType.lectivo === false) continue
    const sessionsForDate = segments
      .filter((segment) => Number(segment.dia) === weekday - 1)
      .map((segment) => sessionFor(date, segment, group, ordinaryColor))
    if (!sessionsForDate.length) continue
    const primary = sessionsForDate.find((session) => session.sessionType === 'teaching') || sessionsForDate[0]
    primary.primaryForDate = true
    sessions.push(...sessionsForDate)
  }
  const streamCounts = new Map()
  sessions.forEach((session) => {
    const sequenceIndex = streamCounts.get(session.streamKey) || 0
    session.sequenceIndex = sequenceIndex
    session.id = stableSessionId(session.streamKey, sequenceIndex)
    streamCounts.set(session.streamKey, sequenceIndex + 1)
  })
  return sessions
}

export function programmingDatesForGroup(calendar = {}, group = {}) {
  return [...new Set(programmingSessionsForGroup(calendar, group)
    .filter((session) => session.sessionType === 'teaching')
    .map((session) => session.date))]
}
