import { doc, getDoc } from 'firebase/firestore'
import bundledLaw from '../data/lomloeMathLaw.json'
import { db } from './firebase'
import { loadGlobalLaw, loadSubjectLaw } from './rubricRepository'
import {
  aggregateExerciseStructure,
  exerciseStructureFromDocument,
  mergeExerciseStructure,
  parseExerciseLatex,
} from '../utils/exerciseStructure'
import { calculateCompetencyProgress } from '../utils/studentCompetencyProgress'

function clone(value, fallback = null) {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function flattenItems(nodes = []) {
  return (Array.isArray(nodes) ? nodes : []).flatMap((node) => (
    node?.type === 'group' ? flattenItems(node.children) : (node?.type === 'item' ? [node] : [])
  ))
}

function sourceStructure(source = {}) {
  if (Number(source.schemaVersion) >= 3 && source.statement) {
    return aggregateExerciseStructure(exerciseStructureFromDocument(source))
  }
  return mergeExerciseStructure(parseExerciseLatex(source.codigo || source.latex || source.enunciado || ''), source.structure || source)
}

function achievementsForExercise(exerciseId, version, source) {
  const structure = sourceStructure(source)
  if (!structure.apartados?.length && !structure.achievements?.length) {
    structure.achievements = clone(source.achievements || source.structure?.achievements, [])
  }
  const parts = structure.apartados?.length
    ? structure.apartados.map((part, index) => ({ key: part.id || `part-${index}`, achievements: part.achievements || [] }))
    : [{ key: 'general', achievements: structure.achievements || [] }]
  return parts.flatMap((part) => part.achievements.map((achievement) => ({
    ...achievement,
    key: `${exerciseId}:${version}:${part.key}:${achievement.id}`,
  })))
}

async function documentReferences(item) {
  if (Array.isArray(item.documentAssessment?.exercises) && item.documentAssessment.exercises.length) {
    return item.documentAssessment.exercises
  }
  const documentId = item.documentAssessment?.documentId
  if (!documentId) return []
  const snapshot = await getDoc(doc(db, 'documentos', documentId))
  return snapshot.exists() ? (snapshot.data()?.ejercicios || []) : []
}

async function loadDocumentAchievements(group) {
  const items = flattenItems(group?.evaluaciones?.estructura || group?.evaluation?.structure)
    .filter((item) => item.documentAssessment)
  const exerciseCache = new Map()
  const loadExercise = async (exerciseId) => {
    if (!exerciseCache.has(exerciseId)) {
      exerciseCache.set(exerciseId, getDoc(doc(db, 'ejercicios', exerciseId)).then((snapshot) => (
        snapshot.exists() ? snapshot.data() || {} : null
      )))
    }
    return exerciseCache.get(exerciseId)
  }

  const entries = await Promise.all(items.map(async (item) => {
    const references = await documentReferences(item)
    const lists = await Promise.all(references.map(async (reference) => {
      if (!reference.exerciseId) return []
      const exercise = await loadExercise(reference.exerciseId)
      if (!exercise) return []
      const version = Number(reference.version) || 0
      const source = version === 0 ? exercise : exercise.variaciones?.[version - 1] || exercise
      return achievementsForExercise(reference.exerciseId, version, source)
    }))
    return [item.id, lists.flat()]
  }))
  return new Map(entries)
}

export async function loadStudentCompetencyProgress(group, studentId) {
  const subjectId = group?.subjectId || group?.asignaturaId || ''
  const [globalLaw, subjectLaw, documentAchievements] = await Promise.all([
    loadGlobalLaw().catch(() => clone(bundledLaw.global, {})),
    loadSubjectLaw(subjectId).catch(() => clone(bundledLaw.subjects?.[subjectId], {})),
    loadDocumentAchievements(group),
  ])
  return calculateCompetencyProgress({ group, studentId, globalLaw, subjectLaw, documentAchievements })
}

