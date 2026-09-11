import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from './firebase'
import { rubricSnapshot } from '../utils/rubricAssessment'
import { programmingSessionsForGroup } from '../utils/programmingSchedule'

export { programmingDatesForGroup, programmingSessionsForGroup } from '../utils/programmingSchedule'

const clone = (value, fallback = null) => {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function removeEvaluationItems(nodes = [], predicate) {
  const removedIds = []
  const visit = (items) => (Array.isArray(items) ? items : []).flatMap((node) => {
    if (node?.type === 'item' && predicate(node)) {
      removedIds.push(node.id)
      return []
    }
    if (node?.type === 'group') return [{ ...node, children: visit(node.children) }]
    return [node]
  })
  return { structure: visit(nodes), removedIds }
}

function normalizeDay(snapshot, groupId) {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    date: data.date || snapshot.id,
    groupId,
    notes: String(data.notes || ''),
    rubricInstruments: Array.isArray(data.rubricInstruments) ? clone(data.rubricInstruments, []) : [],
    resources: Array.isArray(data.resources) ? clone(data.resources, []) : [],
    contents: Array.isArray(data.contents) ? clone(data.contents, []) : [],
    sessionKey: data.sessionKey || null,
    sessionType: data.sessionType || null,
    title: String(data.title || ''),
    color: data.color || null,
    tutorType: data.tutorType || null,
    subjectId: data.subjectId || null,
    subject: String(data.subject || ''),
    dayIndex: Number.isInteger(Number(data.dayIndex)) ? Number(data.dayIndex) : null,
    moduleIndex: Number.isInteger(Number(data.moduleIndex)) ? Number(data.moduleIndex) : null,
    primaryForDate: Boolean(data.primaryForDate),
    schemaVersion: Number(data.schemaVersion) || 2,
  }
}

export async function loadAndSynchronizeProgrammingDays({ group, calendar, teacherId }) {
  const sessions = programmingSessionsForGroup(calendar, group)
  if (!sessions.length) return []
  const daysCollection = collection(db, 'grupos', group.id, 'programmingDays')
  const snapshot = await getDocs(daysCollection)
  const existing = new Map(snapshot.docs.map((item) => [item.id, normalizeDay(item, group.id)]))
  const resolved = new Map()
  const claimedLegacyDates = new Set()
  sessions.forEach((session) => {
    const exact = existing.get(session.id)
    if (exact) {
      resolved.set(session.id, { ...exact, ...session, id: exact.id })
      return
    }
    const legacy = session.primaryForDate && !claimedLegacyDates.has(session.date)
      ? existing.get(session.date)
      : null
    if (legacy) {
      claimedLegacyDates.add(session.date)
      resolved.set(session.id, { ...legacy, ...session, id: legacy.id })
    }
  })
  const missing = sessions.filter((session) => !resolved.has(session.id))
  for (let offset = 0; offset < missing.length; offset += 450) {
    const batch = writeBatch(db)
    missing.slice(offset, offset + 450).forEach((session) => {
      batch.set(doc(daysCollection, session.id), {
        ...session,
        groupId: group.id,
        teacherId,
        academicYear: group.academicYear || '',
        notes: '',
        rubricInstruments: [],
        resources: [],
        contents: [],
        schemaVersion: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    })
    await batch.commit()
  }
  return sessions.map((session) => resolved.get(session.id) || {
    ...session,
    groupId: group.id,
    notes: '',
    rubricInstruments: [],
    resources: [],
    contents: [],
    schemaVersion: 3,
  })
}

export async function loadProgrammingDay(groupId, date) {
  const daysCollection = collection(db, 'grupos', groupId, 'programmingDays')
  const snapshot = await getDocs(query(daysCollection, where('date', '==', date)))
  const matching = snapshot.docs.map((item) => normalizeDay(item, groupId))
  if (!matching.length) {
    const legacy = await getDoc(doc(daysCollection, date))
    return legacy.exists() ? normalizeDay(legacy, groupId) : null
  }
  const primary = matching.find((day) => day.primaryForDate)
    || matching.find((day) => day.sessionType === 'teaching')
    || matching[0]
  const uniqueById = (items) => [...new Map(items.filter(Boolean).map((item) => [item.id, item])).values()]
  return {
    ...primary,
    rubricInstruments: uniqueById(matching.flatMap((day) => day.rubricInstruments || [])),
    resources: uniqueById(matching.flatMap((day) => day.resources || [])),
    contents: uniqueById(matching.flatMap((day) => day.contents || [])),
  }
}

export async function saveProgrammingDay(groupId, day, teacherId) {
  const payload = {
    date: day.date,
    groupId,
    teacherId,
    notes: String(day.notes || ''),
    rubricInstruments: clone(day.rubricInstruments, []) || [],
    resources: clone(day.resources, []) || [],
    contents: clone(day.contents, []) || [],
    sessionKey: day.sessionKey || null,
    sessionType: day.sessionType || null,
    title: String(day.title || ''),
    color: day.color || null,
    tutorType: day.tutorType || null,
    subjectId: day.subjectId || null,
    subject: String(day.subject || ''),
    dayIndex: Number.isInteger(Number(day.dayIndex)) ? Number(day.dayIndex) : null,
    moduleIndex: Number.isInteger(Number(day.moduleIndex)) ? Number(day.moduleIndex) : null,
    primaryForDate: Boolean(day.primaryForDate),
    schemaVersion: 3,
    updatedAt: new Date().toISOString(),
  }
  await setDoc(doc(db, 'grupos', groupId, 'programmingDays', day.id || day.date), payload, { merge: true })
  return payload
}

export async function addRubricToProgrammingDay({ groupId, date, programmingDayId = date, session = {}, rubric, teacherId }) {
  const snapshot = rubricSnapshot(rubric)
  if (!snapshot) throw new Error('La rúbrica seleccionada no es válida.')
  const instrumentId = globalThis.crypto?.randomUUID?.() || `rubrica-${Date.now()}`
  const itemId = globalThis.crypto?.randomUUID?.() || `item-${Date.now()}`
  const instrument = {
    id: instrumentId,
    type: 'rubric',
    rubricId: rubric.id,
    gradebookItemId: itemId,
    title: rubric.title,
    shortName: rubric.shortName || rubric.title,
    date,
    sessionKey: session.sessionKey || null,
    rubric: snapshot,
    createdAt: new Date().toISOString(),
  }
  const item = {
    type: 'item',
    id: itemId,
    nombre: rubric.title,
    nombreCorto: rubric.shortName || rubric.title,
    rubric: snapshot,
    programming: { date, programmingDayId, sessionKey: session.sessionKey || null, instrumentId },
  }

  await runTransaction(db, async (transaction) => {
    const groupReference = doc(db, 'grupos', groupId)
    const dayReference = doc(db, 'grupos', groupId, 'programmingDays', programmingDayId)
    const [groupDocument, dayDocument] = await Promise.all([
      transaction.get(groupReference),
      transaction.get(dayReference),
    ])
    if (!groupDocument.exists()) throw new Error('El grupo ya no está disponible.')
    const dayData = dayDocument.exists() ? dayDocument.data() : {}
    transaction.set(dayReference, {
      date,
      groupId,
      teacherId,
      sessionKey: session.sessionKey || null,
      sessionType: session.sessionType || null,
      title: String(session.title || ''),
      color: session.color || null,
      tutorType: session.tutorType || null,
      subjectId: session.subjectId || null,
      subject: String(session.subject || ''),
      dayIndex: Number.isInteger(Number(session.dayIndex)) ? Number(session.dayIndex) : null,
      moduleIndex: Number.isInteger(Number(session.moduleIndex)) ? Number(session.moduleIndex) : null,
      primaryForDate: Boolean(session.primaryForDate),
      rubricInstruments: [...(dayData.rubricInstruments || []), instrument],
      resources: dayData.resources || [],
      notes: dayData.notes || '',
      schemaVersion: 3,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
  })
  return { instrument, item }
}

export async function removeRubricFromProgrammingDay({
  groupId,
  date,
  programmingDayId = date,
  instrument,
  evaluationStructure = [],
  dayRubricInstruments = [],
  studentIds = [],
}) {
  if (!groupId || !date || !instrument?.id) return { removedIds: [] }
  const groupReference = doc(db, 'grupos', groupId)
  const dayReference = doc(db, 'grupos', groupId, 'programmingDays', programmingDayId)
  const removed = removeEvaluationItems(evaluationStructure, (item) => item.id === instrument.gradebookItemId)
  const removedIds = removed.removedIds
  const batch = writeBatch(db)
  batch.update(groupReference, {
    'evaluation.structure': removed.structure,
    updatedAt: new Date().toISOString(),
  })
  batch.set(dayReference, {
    rubricInstruments: dayRubricInstruments.filter((item) => item.id !== instrument.id),
    updatedAt: new Date().toISOString(),
  }, { merge: true })
  if (removedIds.length) studentIds.filter(Boolean).forEach((studentId) => {
    const updates = { updatedAt: new Date().toISOString() }
    removedIds.forEach((itemId) => { updates[`results.${itemId}`] = deleteField() })
    batch.update(doc(groupReference, 'alumnos', studentId), updates)
  })
  await batch.commit()
  return { removedIds }
}

export async function removeDocumentFromProgramming(documentData = {}, { evaluationStructure = [], studentIds = [] } = {}) {
  const documentId = documentData.id
  const groupId = documentData.assessment?.groupId || documentData.programming?.groupId || documentData.groupContext?.id
  if (!documentId) return { groupId, removedIds: [] }
  const documentReference = doc(db, 'documentos', documentId)
  const groupReference = groupId ? doc(db, 'grupos', groupId) : null
  let removedIds = []
  const batch = writeBatch(db)
  if (groupReference) {
    const removed = removeEvaluationItems(evaluationStructure, (item) => item.documentAssessment?.documentId === documentId)
    removedIds = removed.removedIds
    batch.update(groupReference, {
      'evaluation.structure': removed.structure,
      updatedAt: new Date().toISOString(),
    })
  }
  batch.update(documentReference, {
    assessment: {
      ...(documentData.assessment || {}),
      evaluable: false,
      groupId: null,
      gradebookItemId: null,
    },
    programming: { hidden: true },
    updatedAt: new Date().toISOString(),
  })
  if (removedIds.length) studentIds.filter(Boolean).forEach((studentId) => {
    const updates = { updatedAt: new Date().toISOString() }
    removedIds.forEach((itemId) => { updates[`results.${itemId}`] = deleteField() })
    batch.update(doc(groupReference, 'alumnos', studentId), updates)
  })
  await batch.commit()
  return { groupId, removedIds }
}

export async function loadProgrammingDocuments(groupId) {
  const lookups = [
    ['programming.groupId', groupId],
    ['assessment.groupId', groupId],
    ['groupContext.id', groupId],
  ]
  const snapshots = await Promise.all(lookups.map(async ([field, value]) => {
    try {
      return await getDocs(query(collection(db, 'documentos'), where(field, '==', value)))
    } catch {
      return { docs: [] }
    }
  }))
  const result = new Map()
  snapshots.flatMap((snapshot) => snapshot.docs).forEach((item) => result.set(item.id, { id: item.id, ...item.data() }))
  return [...result.values()]
}

export function programmingDocumentDate(documentData = {}) {
  if (documentData.programming?.hidden) return ''
  const direct = String(documentData.programming?.date || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct
  const values = documentData.campos || {}
  const raw = String(values.date || values.fecha || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const match = raw.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!match) return ''
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function safeProgrammingFileName(value) {
  return String(value || 'archivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'archivo'
}

function imageCompilerName(file, existingResources = []) {
  if (!String(file?.type || '').startsWith('image/')) return safeProgrammingFileName(file?.name)
  const extension = safeProgrammingFileName(file?.name).match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase()
    || (file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/png' ? '.png' : '')
  const usedIndexes = new Set(existingResources
    .map((resource) => String(resource?.compilerName || '').match(/^imagen(\d+)/i)?.[1])
    .filter(Boolean)
    .map(Number))
  let index = 1
  while (usedIndexes.has(index)) index += 1
  return `imagen${index}${extension}`
}

export async function uploadProgrammingResource({ teacherId, groupId, date, file, existingResources = [] }) {
  const resourceId = globalThis.crypto?.randomUUID?.() || `archivo-${Date.now()}`
  const safeName = safeProgrammingFileName(file.name)
  const compilerName = imageCompilerName(file, existingResources)
  const path = `teachers/${teacherId}/programacion/${groupId}/${date}/${resourceId}-${safeName}`
  const reference = storageRef(storage, path)
  await uploadBytes(reference, file, { contentType: file.type || 'application/octet-stream' })
  return {
    id: resourceId,
    type: 'file',
    title: file.name,
    url: await getDownloadURL(reference),
    path,
    size: file.size,
    contentType: file.type || '',
    compilerName,
  }
}

export async function deleteProgrammingResource(resource) {
  if (resource?.type === 'file' && resource.path) await deleteObject(storageRef(storage, resource.path))
}

function programmingContentBasePath({ teacherId, groupId, date, contentId }) {
  return `teachers/${teacherId}/programacion/${groupId}/${date}/contenidos/${contentId}`
}

export function programmingContentSourceHash(code) {
  let hash = 2166136261
  const value = String(code || '')
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export async function uploadProgrammingContentSource({ teacherId, groupId, date, content }) {
  const code = String(content?.code || '')
  const hash = programmingContentSourceHash(code)
  if (content?.source?.hash === hash && content.source.path && content.source.url) return content.source
  const path = `${programmingContentBasePath({ teacherId, groupId, date, contentId: content.id })}.tex`
  const reference = storageRef(storage, path)
  await uploadBytes(reference, new Blob([code], { type: 'application/x-tex;charset=utf-8' }), { contentType: 'application/x-tex' })
  return { path, url: await getDownloadURL(reference), hash, updatedAt: new Date().toISOString() }
}

export async function uploadProgrammingContentPdf({ teacherId, groupId, date, contentId, blob, previousPdf = null }) {
  const revision = Date.now()
  const path = `${programmingContentBasePath({ teacherId, groupId, date, contentId })}-${revision}.pdf`
  const reference = storageRef(storage, path)
  await uploadBytes(reference, blob, { contentType: 'application/pdf' })
  const pdf = { path, url: await getDownloadURL(reference), revision, updatedAt: new Date().toISOString() }
  if (previousPdf?.path && previousPdf.path !== path) {
    try { await deleteObject(storageRef(storage, previousPdf.path)) } catch { /* El PDF anterior puede no existir. */ }
  }
  return pdf
}

export async function deleteProgrammingContentFiles(content) {
  const paths = [content?.source?.path, content?.pdf?.path].filter(Boolean)
  await Promise.allSettled(paths.map((path) => deleteObject(storageRef(storage, path))))
}
