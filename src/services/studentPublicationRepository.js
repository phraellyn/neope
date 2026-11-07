import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from './firebase'

export async function loadStudentPublications(groupId) {
  const snapshot = await getDocs(collection(db, 'grupos', groupId, 'studentPublications'))
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, item.data()?.visible === true]))
}

export async function setStudentPublication(groupId, type, id, visible) {
  await setDoc(doc(db, 'grupos', groupId, 'studentPublications', `${type}-${id}`), { visible: Boolean(visible), updatedAt: new Date().toISOString() }, { merge: true })
}
