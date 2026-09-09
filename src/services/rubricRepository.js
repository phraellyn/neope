import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import lomloeMathLaw from '../data/lomloeMathLaw.json'

export const rubricSchemaVersion = 3

function rubricShortName(value, title = '') {
  return Array.from(String(value || title || '').trim()).slice(0, 2).join('')
}

function mergeAlignments(alignments = []) {
  const criterionIds = [...new Set(alignments.flatMap((alignment) => alignment?.criterionIds || []))]
  const strengthRank = { weak: 1, medium: 2, strong: 3 }
  const evidenceByDescriptor = new Map()
  alignments.flatMap((alignment) => alignment?.descriptorEvidence || []).forEach((evidence) => {
    if (!evidence?.descriptorId || !strengthRank[evidence.strength]) return
    const previous = evidenceByDescriptor.get(evidence.descriptorId)
    if (!previous || strengthRank[evidence.strength] > strengthRank[previous.strength]) {
      evidenceByDescriptor.set(evidence.descriptorId, evidence)
    }
  })
  return {
    criterionIds,
    descriptorEvidence: [...evidenceByDescriptor.values()],
    source: alignments.some((alignment) => alignment?.source === 'ai') ? 'ai' : 'manual',
  }
}

function normalizeCategory(category = {}) {
  const levels = Array.isArray(category.levels) ? category.levels : []
  const type = category.type === 'range' || (!category.type && levels.length === 1 && levels[0]?.score?.mode === 'range')
    ? 'range'
    : 'levels'
  const normalizedLevels = levels.map((level, index) => ({
    id: level.id || `legacy-level-${index}`,
    description: String(level.description || ''),
    points: Number.isInteger(Number(level.points))
      ? Number(level.points)
      : Number.isInteger(Number(level.score?.max)) ? Number(level.score.max) : 0,
  }))
  const alignment = category.alignment?.criterionIds || category.alignment?.descriptorEvidence
    ? category.alignment
    : mergeAlignments(levels.map((level) => level.alignment))
  const legacyRange = levels.find((level) => level.score?.mode === 'range')?.score
  const range = category.range || legacyRange || { min: 0, max: 3, default: 1 }
  return {
    id: category.id,
    title: String(category.title || ''),
    type,
    levels: type === 'levels' ? normalizedLevels : [],
    defaultLevelId: category.defaultLevelId || normalizedLevels[0]?.id || null,
    range: {
      description: String(range.description || category.description || ''),
      min: Number.isInteger(Number(range.min)) ? Number(range.min) : 0,
      max: Number.isInteger(Number(range.max)) ? Number(range.max) : 3,
      default: Number.isInteger(Number(range.default)) ? Number(range.default) : 1,
    },
    alignment: {
      criterionIds: Array.isArray(alignment?.criterionIds) ? alignment.criterionIds : [],
      descriptorEvidence: Array.isArray(alignment?.descriptorEvidence) ? alignment.descriptorEvidence : [],
      source: alignment?.source || 'manual',
      ...(alignment?.model ? { model: alignment.model } : {}),
    },
  }
}

function plainTimestamp(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  return value instanceof Date ? value : null
}

export function emptyRubric(ownerId = '') {
  return {
    id: null,
    schemaVersion: rubricSchemaVersion,
    ownerId,
    course: '',
    subjectId: '',
    subjectTitle: '',
    title: '',
    shortName: '',
    categories: [],
    createdAt: null,
    updatedAt: null,
    sourceRubricId: null,
  }
}

export function normalizeRubric(snapshotOrData, explicitId = null) {
  const data = typeof snapshotOrData?.data === 'function' ? snapshotOrData.data() : snapshotOrData || {}
  const id = explicitId || snapshotOrData?.id || data.id || null
  return {
    ...emptyRubric(data.ownerId || ''),
    ...data,
    id,
    shortName: rubricShortName(data.shortName, data.title),
    categories: Array.isArray(data.categories) ? data.categories.map(normalizeCategory) : [],
    createdAt: plainTimestamp(data.createdAt),
    updatedAt: plainTimestamp(data.updatedAt),
  }
}

function payloadForRubric(rubric, ownerId) {
  const categories = (rubric.categories || []).map(normalizeCategory).map((category) => ({
    ...category,
    levels: category.levels.map((level) => ({
      id: level.id,
      description: level.description.trim(),
      points: Number(level.points),
    })),
    range: {
      description: category.range.description.trim(),
      min: Number(category.range.min),
      max: Number(category.range.max),
      default: Number(category.range.default),
    },
  }))
  return {
    schemaVersion: rubricSchemaVersion,
    ownerId,
    course: String(rubric.course || '').trim(),
    subjectId: String(rubric.subjectId || '').trim(),
    subjectTitle: String(rubric.subjectTitle || '').trim(),
    title: String(rubric.title || '').trim(),
    shortName: rubricShortName(rubric.shortName),
    normalizedTitle: String(rubric.title || '').trim().toLocaleLowerCase('es-ES'),
    categories,
    sourceRubricId: rubric.sourceRubricId || null,
    updatedAt: serverTimestamp(),
  }
}

export async function loadRubrics(ownerId) {
  if (!ownerId) return []
  const snapshot = await getDocs(query(collection(db, 'rubricas'), where('ownerId', '==', ownerId)))
  return snapshot.docs
    .map((documentSnapshot) => normalizeRubric(documentSnapshot))
    .sort((left, right) => (
      (right.updatedAt?.getTime?.() || 0) - (left.updatedAt?.getTime?.() || 0)
      || left.title.localeCompare(right.title, 'es')
    ))
}

export async function saveRubric(rubric, ownerId) {
  if (!ownerId) throw new Error('No hay una cuenta de profesor activa.')
  const payload = payloadForRubric(rubric, ownerId)
  if (rubric.id) {
    const reference = doc(db, 'rubricas', rubric.id)
    await setDoc(reference, payload, { merge: true })
    return normalizeRubric({ ...rubric, ...payload, ownerId, updatedAt: new Date() }, rubric.id)
  }
  const reference = await addDoc(collection(db, 'rubricas'), {
    ...payload,
    createdAt: serverTimestamp(),
  })
  return normalizeRubric({ ...rubric, ...payload, ownerId, createdAt: new Date(), updatedAt: new Date() }, reference.id)
}

export async function deleteRubric(rubricId) {
  if (!rubricId) return
  await deleteDoc(doc(db, 'rubricas', rubricId))
}

export async function loadGlobalLaw() {
  const snapshot = await getDoc(doc(db, 'law', 'lomloe'))
  return snapshot.exists()
    ? { id: snapshot.id, ...snapshot.data() }
    : { ...structuredClone(lomloeMathLaw.global), catalogOrigin: 'bundled' }
}

export async function loadSubjectLaw(subjectId) {
  if (!subjectId) return { schemaVersion: 1, specificCompetencies: [], evaluationCriteria: [], sources: [] }
  const snapshot = await getDoc(doc(db, 'especialidades', 'Matemáticas', 'asignaturas', subjectId, 'law', 'lomloe'))
  return snapshot.exists()
    ? { id: snapshot.id, ...snapshot.data() }
    : lomloeMathLaw.subjects[subjectId]
      ? { ...structuredClone(lomloeMathLaw.subjects[subjectId]), catalogOrigin: 'bundled' }
      : { schemaVersion: 1, subjectId, specificCompetencies: [], evaluationCriteria: [], sources: [] }
}
