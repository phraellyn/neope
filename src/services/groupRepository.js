import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase.js'

export const DEVELOPMENT_TEACHER_ID = 'test'

export function currentAcademicYear(date = new Date()) {
  const startYear = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1
  return `${startYear}-${startYear + 1}`
}

function clone(value, fallback) {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function legacyCompositeId(group = {}) {
  return [group.nombre, group.asignatura, typeof group.aula === 'string' ? group.aula : '', group.color].join('|')
}

function migratedGroupId(academicYear, group = {}) {
  const legacyId = group.id || legacyCompositeId(group)
  return `legacy-${encodeURIComponent(`${academicYear}::${legacyId}`)}`
}

function inferLevel(name = '') {
  const normalized = String(name).trim()
  const match = normalized.match(/^(.+?)\s+[A-Z]$/u)
  return match?.[1] || normalized
}

function attendanceItems(nodes = []) {
  return nodes.flatMap((node) => {
    if (node?.type === 'group') return attendanceItems(node.children || [])
    return node?.attendance?.date ? [node] : []
  })
}

function stripAttendanceItems(nodes = []) {
  return nodes.flatMap((node) => {
    if (node?.attendance?.date) return []
    if (node?.type !== 'group') return [node]
    const children = stripAttendanceItems(node.children || [])
    return children.length ? [{ ...node, children }] : []
  })
}

function normalizeAttendance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([date, entry]) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    const rawRecords = source.records && typeof source.records === 'object' ? source.records : source
    const records = Object.fromEntries(Object.entries(rawRecords).filter(([, status]) => ['F', 'FJ', 'R', 'RJ'].includes(status)))
    return [date, { records, ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}) }]
  }))
}

function normalizeEvaluation(group = {}) {
  const source = group.evaluation || group.evaluaciones || {}
  const legacyColumns = Array.isArray(source.columnas)
    ? source.columnas.map((column) => ({
        type: 'item',
        id: column.id,
        nombre: column.title || column.nombre || 'Resultado',
        nombreCorto: column.nombreCorto || column.title || column.nombre || 'Resultado',
      }))
    : []
  const structure = clone(source.structure || source.estructura, legacyColumns) || []
  const removedAttendanceIds = new Set(attendanceItems(structure).map((item) => item.id).filter(Boolean))
  const weights = clone(source.weights || source.pesos, {}) || {}
  removedAttendanceIds.forEach((itemId) => delete weights[itemId])
  return {
    structure: stripAttendanceItems(structure),
    weights,
  }
}

function normalizeClassroomLayout(group = {}) {
  const source = group.classroomLayout
    || group.disposicion
    || (group.aula && typeof group.aula === 'object' ? group.aula : null)
  if (!source || typeof source !== 'object') return { rows: 4, cols: 5, aisles: [], asientos: [] }
  return {
    rows: Math.max(1, Number(source.rows) || 4),
    cols: Math.max(1, Number(source.cols) || 5),
    aisles: Array.isArray(source.aisles) ? [...source.aisles] : [],
    asientos: Array.isArray(source.asientos) ? [...source.asientos] : [],
  }
}

function studentIdsAndResults(group = {}) {
  const listedIds = (Array.isArray(group.alumnos) ? group.alumnos : [])
    .map((student) => typeof student === 'string' ? student : student?.id || student?.code)
    .filter(Boolean)
  const resultSource = group.evaluation?.results
    || group.evaluaciones?.resultados
    || {}
  const ids = [...new Set([...listedIds, ...Object.keys(resultSource)])]
  return ids.map((code) => ({ code, results: clone(resultSource[code], {}) || {} }))
}

function legacyGroupDocument(academicYear, group, teacherId) {
  const evaluation = normalizeEvaluation(group)
  const legacyIds = [...new Set([group.id, legacyCompositeId(group), ...(group.legacyIds || [])].filter(Boolean))]
  const subject = String(group.subject || group.asignatura || '').trim()
  const name = String(group.name || group.nombre || '').trim()
  const classroom = typeof group.classroom === 'string'
    ? group.classroom
    : (typeof group.aula === 'string' ? group.aula : '')
  return {
    academicYear,
    teacherId,
    type: 'teaching',
    level: String(group.level || group.curso || inferLevel(name)).trim(),
    name,
    subjectId: group.subjectId || null,
    subject,
    classroom,
    color: group.color || '#DCEBFF',
    schedule: clone(group.schedule || group.horario, []) || [],
    evaluation,
    attendance: normalizeAttendance(group.attendance || group.asistencia),
    classroomLayout: normalizeClassroomLayout(group),
    studentCount: studentIdsAndResults(group).length,
    tutor: Boolean(group.tutor),
    tutorType: group.tutorType || null,
    legacyIds,
    schemaVersion: 3,
    updatedAt: new Date().toISOString(),
  }
}

function groupDocumentFromView(group, teacherId = DEVELOPMENT_TEACHER_ID) {
  return {
    academicYear: group.academicYear || currentAcademicYear(),
    teacherId,
    type: 'teaching',
    level: String(group.level || group.curso || inferLevel(group.name || group.nombre)).trim(),
    name: String(group.name || group.nombre || '').trim(),
    subjectId: group.subjectId || null,
    subject: String(group.subject || group.asignatura || '').trim(),
    classroom: typeof group.classroom === 'string'
      ? group.classroom
      : (typeof group.aula === 'string' ? group.aula : ''),
    color: group.color || '#DCEBFF',
    schedule: clone(group.schedule || group.horario, []) || [],
    evaluation: normalizeEvaluation(group),
    attendance: normalizeAttendance(group.attendance || group.asistencia),
    classroomLayout: normalizeClassroomLayout(group),
    studentCount: group.studentsLoaded && Array.isArray(group.alumnos)
      ? group.alumnos.length
      : Number(group.studentCount) || 0,
    tutor: Boolean(group.tutor),
    tutorType: group.tutorType || null,
    legacyIds: [...new Set(Array.isArray(group.legacyIds) ? group.legacyIds.filter(Boolean) : [])],
    schemaVersion: 3,
    updatedAt: new Date().toISOString(),
  }
}

function groupView(id, data, students = null) {
  const loadedStudents = Array.isArray(students) ? students : []
  const rawStructure = clone(data.evaluation?.structure, []) || []
  const legacyAttendanceItems = attendanceItems(rawStructure)
  const legacyAttendanceIds = new Set(legacyAttendanceItems.map((item) => item.id).filter(Boolean))
  const attendance = normalizeAttendance(data.attendance)
  const results = Object.fromEntries(loadedStudents.map((student) => {
    const studentResults = clone(student.results, {}) || {}
    legacyAttendanceItems.forEach((item) => {
      const status = studentResults[item.id]
      if (['F', 'FJ', 'R', 'RJ'].includes(status)) {
        attendance[item.attendance.date] ||= { records: {} }
        attendance[item.attendance.date].records[student.id] = status
      }
      delete studentResults[item.id]
    })
    return [student.id, studentResults]
  }))
  return {
    id,
    academicYear: data.academicYear,
    teacherId: data.teacherId,
    curso: data.level || inferLevel(data.name),
    nombre: data.name || '',
    subjectId: data.subjectId || null,
    asignatura: data.subject || '',
    aula: data.classroom || '',
    color: data.color || '#DCEBFF',
    horario: clone(data.schedule, []) || [],
    evaluaciones: {
      estructura: stripAttendanceItems(rawStructure),
      resultados: results,
      pesos: Object.fromEntries(Object.entries(clone(data.evaluation?.weights, {}) || {})
        .filter(([itemId]) => !legacyAttendanceIds.has(itemId))),
    },
    attendance,
    alumnos: loadedStudents.map((student) => ({ id: student.id })),
    disposicion: normalizeClassroomLayout({ classroomLayout: data.classroomLayout }),
    studentCount: Number(data.studentCount) || loadedStudents.length,
    tutor: Boolean(data.tutor),
    tutorType: data.tutorType || null,
    legacyIds: Array.isArray(data.legacyIds) ? [...data.legacyIds] : [],
    studentsLoaded: Array.isArray(students),
  }
}

function legacyNonTeachingBlocks(group = {}) {
  return (group.horario || []).map((segment, index) => ({
    id: `${group.id || legacyCompositeId(group)}::${segment.dia}-${segment.tramo}-${index}`,
    type: 'nonTeaching',
    nonTeachingKind: group.nonTeachingKind || null,
    course: group.nombre || '',
    subject: group.asignatura || '',
    classroom: typeof group.aula === 'string' ? group.aula : '',
    color: group.color || '#E6EAF0',
    dayIndex: segment.dia,
    moduleIndex: segment.tramo,
  }))
}

export async function migrateLegacyGroups(teacherSnapshot, teacherId = DEVELOPMENT_TEACHER_ID) {
  const teacherData = teacherSnapshot?.exists?.() ? teacherSnapshot.data() || {} : {}
  const courses = Array.isArray(teacherData?.carrera?.cursos) ? teacherData.carrera.cursos : []
  if (!courses.length) return false

  const nonTeachingByYear = new Map()
  const groupIdsByYear = new Map()
  for (const course of courses) {
    const academicYear = course.year || currentAcademicYear()
    for (const legacyGroup of course.grupos || []) {
      const isNonTeaching = legacyGroup.tipoHorario === 'nonTeaching'
        || (!String(legacyGroup.asignatura || '').trim() && !legacyGroup.subjectId)
      if (isNonTeaching) {
        const blocks = nonTeachingByYear.get(academicYear) || []
        blocks.push(...legacyNonTeachingBlocks(legacyGroup))
        nonTeachingByYear.set(academicYear, blocks)
        continue
      }

      const groupId = migratedGroupId(academicYear, legacyGroup)
      const idMap = groupIdsByYear.get(academicYear) || new Map()
      const legacyIds = [legacyGroup.id, legacyCompositeId(legacyGroup)].filter(Boolean)
      legacyIds.forEach((legacyId) => idMap.set(legacyId, groupId))
      groupIdsByYear.set(academicYear, idMap)
      const groupReference = doc(db, 'grupos', groupId)
      const batch = writeBatch(db)
      batch.set(groupReference, legacyGroupDocument(academicYear, legacyGroup, teacherId), { merge: true })
      studentIdsAndResults(legacyGroup).forEach((student) => {
        batch.set(doc(groupReference, 'alumnos', student.code), {
          code: student.code,
          results: student.results,
          updatedAt: new Date().toISOString(),
        }, { merge: true })
      })
      await batch.commit()
    }
  }

  for (const [academicYear, nonTeachingSchedule] of nonTeachingByYear) {
    await setDoc(doc(db, 'teachers', teacherId, 'academicYears', academicYear), {
      academicYear,
      nonTeachingSchedule,
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
  }

  const migratedCalendars = clone(teacherData.calendariosEscolares, {}) || {}
  Object.entries(migratedCalendars).forEach(([academicYear, calendar]) => {
    const idMap = groupIdsByYear.get(academicYear)
    if (!idMap || !Array.isArray(calendar?.types)) return
    calendar.types = calendar.types.map((type) => ({
      ...type,
      cursos: Array.isArray(type.cursos)
        ? type.cursos.map((groupId) => idMap.get(groupId) || groupId)
        : [],
    }))
  })

  await setDoc(doc(db, 'teachers', teacherId), {
    carrera: deleteField(),
    calendariosEscolares: migratedCalendars,
    groupMigration: {
      schemaVersion: 2,
      completedAt: new Date().toISOString(),
    },
  }, { merge: true })
  return true
}

export async function loadGroupsForTeacher(teacherId = DEVELOPMENT_TEACHER_ID, academicYear = currentAcademicYear()) {
  const groupsQuery = query(
    collection(db, 'grupos'),
    where('teacherId', '==', teacherId),
    where('academicYear', '==', academicYear),
  )
  let snapshot
  try {
    snapshot = await getDocsFromServer(groupsQuery)
  } catch {
    snapshot = await getDocs(groupsQuery)
  }
  return snapshot.docs
    .map((groupSnapshot) => groupView(groupSnapshot.id, groupSnapshot.data()))
    .filter((group) => group.asignatura)
    .sort((left, right) => left.nombre.localeCompare(right.nombre, 'es', { numeric: true }))
}

export async function loadNonTeachingSchedule(teacherId = DEVELOPMENT_TEACHER_ID, academicYear = currentAcademicYear()) {
  const snapshot = await getDoc(doc(db, 'teachers', teacherId, 'academicYears', academicYear))
  return snapshot.exists() && Array.isArray(snapshot.data()?.nonTeachingSchedule)
    ? clone(snapshot.data().nonTeachingSchedule, [])
    : []
}

export async function loadScheduleTimePoints(teacherId = DEVELOPMENT_TEACHER_ID, academicYear = currentAcademicYear()) {
  const snapshot = await getDoc(doc(db, 'teachers', teacherId, 'academicYears', academicYear))
  return snapshot.exists() && Array.isArray(snapshot.data()?.scheduleTimePoints)
    ? clone(snapshot.data().scheduleTimePoints, [])
    : []
}

export async function loadStudentsForGroup(group) {
  const groupReference = doc(db, 'grupos', group.id)
  const studentsCollection = collection(db, 'grupos', group.id, 'alumnos')
  let snapshot
  let groupSnapshot
  try {
    ;[snapshot, groupSnapshot] = await Promise.all([
      getDocsFromServer(studentsCollection),
      getDoc(groupReference),
    ])
  } catch {
    ;[snapshot, groupSnapshot] = await Promise.all([
      getDocs(studentsCollection),
      getDoc(groupReference),
    ])
  }
  const students = snapshot.docs.map((studentSnapshot) => ({
    id: studentSnapshot.id,
    results: clone(studentSnapshot.data()?.results, {}) || {},
  }))
  const groupData = groupSnapshot?.exists() ? groupSnapshot.data() : groupDocumentFromView(group, group.teacherId)
  return groupView(group.id, groupData, students)
}

export async function saveGroup(group, previousStudentIds = [], teacherId = DEVELOPMENT_TEACHER_ID) {
  const groupReference = doc(db, 'grupos', group.id)
  const groupData = groupDocumentFromView(group, teacherId)
  const students = Array.isArray(group.alumnos) ? group.alumnos : []
  const currentStudentIds = new Set(students.map((student) => student.id).filter(Boolean))
  groupData.studentCount = currentStudentIds.size

  const batch = writeBatch(db)
  batch.set(groupReference, groupData)
  students.forEach((student) => {
    batch.set(doc(groupReference, 'alumnos', student.id), {
      code: student.id,
      results: clone(group.evaluaciones?.resultados?.[student.id], {}) || {},
      updatedAt: new Date().toISOString(),
    })
  })
  previousStudentIds.filter((id) => !currentStudentIds.has(id)).forEach((id) => {
    batch.delete(doc(groupReference, 'alumnos', id))
  })
  await batch.commit()
  return groupView(group.id, groupData, students.map((student) => ({
    id: student.id,
    results: group.evaluaciones?.resultados?.[student.id] || {},
  })))
}

export async function saveGroupMetadata(groups, teacherId = DEVELOPMENT_TEACHER_ID) {
  const batch = writeBatch(db)
  groups.forEach((group) => {
    batch.set(doc(db, 'grupos', group.id), groupDocumentFromView(group, teacherId))
  })
  await batch.commit()
}

export async function saveNonTeachingSchedule(blocks, teacherId = DEVELOPMENT_TEACHER_ID, academicYear = currentAcademicYear()) {
  await setDoc(doc(db, 'teachers', teacherId, 'academicYears', academicYear), {
    academicYear,
    nonTeachingSchedule: clone(blocks, []) || [],
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
  }, { merge: true })
}

export async function saveScheduleTimePoints(timePoints, teacherId = DEVELOPMENT_TEACHER_ID, academicYear = currentAcademicYear()) {
  await setDoc(doc(db, 'teachers', teacherId, 'academicYears', academicYear), {
    academicYear,
    scheduleTimePoints: clone(timePoints, []) || [],
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
  }, { merge: true })
}
