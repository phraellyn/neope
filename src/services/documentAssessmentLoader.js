import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import {
  aggregateExerciseStructure,
  exerciseStructureFromDocument,
  mergeExerciseStructure,
  parseExerciseLatex,
} from '../utils/exerciseStructure'
import { assessmentExerciseModel as createAssessmentExerciseModel } from '../utils/documentAssessmentMatrix'
import { resolveDocumentAssessmentReferences } from '../utils/documentAssessmentReferences'

const clone = (value) => JSON.parse(JSON.stringify(value))

function exerciseSourceStructure(source = {}) {
  if (Number(source.schemaVersion) >= 3 && source.statement) return aggregateExerciseStructure(exerciseStructureFromDocument(source))
  return mergeExerciseStructure(parseExerciseLatex(source.codigo || source.latex || source.enunciado || ''), source.structure || source)
}

function assessmentExerciseModel(exerciseId, version, source, order) {
  const structure = exerciseSourceStructure(source)
  if (!structure.apartados?.length && !structure.achievements?.length) {
    structure.achievements = clone(source.achievements || source.structure?.achievements || [])
  }
  return createAssessmentExerciseModel({ exerciseId, version, structure, order })
}

export async function loadDocumentAssessmentExercises(item) {
  const documentId = item?.documentAssessment?.documentId
  if (!documentId) throw new Error('Este ítem no conserva la referencia al documento evaluable.')
  const documentSnapshot = await getDoc(doc(db, 'documentos', documentId))
  if (!documentSnapshot.exists()) throw new Error('El documento evaluable ya no existe.')
  const documentData = documentSnapshot.data() || {}
  const references = resolveDocumentAssessmentReferences(
    item.documentAssessment.exercises,
    documentData.ejercicios,
  )
  return Promise.all(references
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map(async (reference, order) => {
      let exercise = reference.snapshot || null
      if (!exercise) {
        const snapshot = await getDoc(doc(db, 'ejercicios', reference.exerciseId))
        if (!snapshot.exists()) return null
        exercise = snapshot.data() || {}
      }
      const version = Number(reference.version) || 0
      const source = version === 0 ? exercise : exercise.variaciones?.[version - 1] || exercise
      return assessmentExerciseModel(reference.exerciseId, version, source, order)
    }))
    .then((items) => items.filter(Boolean))
}
