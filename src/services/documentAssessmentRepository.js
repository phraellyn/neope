import {
  collection,
  deleteField,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase.js'

function clone(value, fallback = null) {
  if (value === undefined || value === null) return fallback
  return JSON.parse(JSON.stringify(value))
}

function removeDocumentItem(nodes = [], documentId) {
  const removedIds = []
  const visit = (items) => items.flatMap((node) => {
    if (node?.type === 'item' && node.documentAssessment?.documentId === documentId) {
      removedIds.push(node.id)
      return []
    }
    if (node?.type === 'group') return [{ ...node, children: visit(Array.isArray(node.children) ? node.children : []) }]
    return [node]
  })
  return { structure: visit(Array.isArray(nodes) ? nodes : []), removedIds }
}

async function clearStudentResults(groupId, itemIds = []) {
  if (!groupId || !itemIds.length) return
  const snapshot = await getDocs(collection(db, 'grupos', groupId, 'alumnos'))
  if (snapshot.empty) return
  const batch = writeBatch(db)
  snapshot.docs.forEach((student) => {
    const updates = { updatedAt: new Date().toISOString() }
    itemIds.forEach((itemId) => { updates[`results.${itemId}`] = deleteField() })
    batch.update(student.ref, updates)
  })
  await batch.commit()
}

async function updateGroupAssessment(groupId, documentId, item = null) {
  if (!groupId || !documentId) return { item: null, removedIds: [] }
  let savedItem = null
  let removedIds = []
  await runTransaction(db, async (transaction) => {
    const reference = doc(db, 'grupos', groupId)
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('El grupo elegido para evaluar ya no existe.')
    const data = snapshot.data() || {}
    const evaluation = clone(data.evaluation, {}) || {}
    const removed = removeDocumentItem(evaluation.structure, documentId)
    removedIds = removed.removedIds
    const structure = removed.structure
    // Los documentos programados no ocupan una columna hasta que se evalúa
    // por primera vez a un alumno. Si la columna ya existe, una edición del
    // documento sí debe mantenerla actualizada.
    if (item && removedIds.length) {
      const previousId = removedIds[0]
      savedItem = { ...clone(item, {}), id: previousId || item.id }
      structure.push(savedItem)
      removedIds = removedIds.filter((id) => id !== savedItem.id)
    }
    transaction.update(reference, {
      evaluation: { ...evaluation, structure },
      updatedAt: new Date().toISOString(),
    })
  })
  await clearStudentResults(groupId, removedIds)
  return { item: savedItem, removedIds }
}

/** Actualiza el ítem si ya fue evaluado; los documentos pendientes no crean columnas. */
export async function syncDocumentAssessment({ documentId, previousGroupId = null, groupId = null, item = null }) {
  if (previousGroupId && previousGroupId !== groupId) await updateGroupAssessment(previousGroupId, documentId, null)
  if (!groupId || !item) {
    if (previousGroupId === groupId && groupId) await updateGroupAssessment(groupId, documentId, null)
    return null
  }
  const result = await updateGroupAssessment(groupId, documentId, item)
  return result.item
}
