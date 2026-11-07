// Solo funciona con los emuladores locales: nunca escribe en un proyecto real.
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const { resolve } = require('node:path')
const projectRequire = createRequire(resolve(__dirname, '../functions/index.js'))
const { initializeApp } = projectRequire('firebase-admin/app')
const { getAuth } = projectRequire('firebase-admin/auth')
const { getFirestore } = projectRequire('firebase-admin/firestore')
const { getStorage } = projectRequire('firebase-admin/storage')

const projectId = 'demo-neope-student'
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8089' || process.env.STORAGE_EMULATOR_HOST !== 'http://127.0.0.1:9199') {
  throw new Error('La demo solo puede cargarse en los emuladores locales de demo-neope-student.')
}
initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const auth = getAuth()
const bucket = getStorage().bucket()

function pdf(text) {
  const content = `BT /F1 17 Tf 60 750 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`]
  let document = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(document)
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(document)
}

async function user(uid, email, claims) {
  try { await auth.getUser(uid) } catch (error) { if (error.code !== 'auth/user-not-found') throw error; await auth.createUser({ uid, email, password: 'neopeprueba' }) }
  await auth.setCustomUserClaims(uid, claims)
}
async function main() {
  const studentCode = 'ABC234'
  const studentEmail = `student-${createHash('sha256').update(studentCode).digest('hex').slice(0, 32)}@students.neope.invalid`
  await Promise.all([user('demo-teacher', 'profesor@ejemplo.test', { role: 'teacher', admin: false }), user('demo-student', studentEmail, { role: 'student', studentCode })])
  const today = new Date(); const year = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1
  const subject = '1eso-matematicas'; const group = 'demo-group'
  const nodes = [{ id: 'matematicas', title: 'Matemáticas', parentId: null }, { id: 'numeros', title: 'Números', parentId: 'matematicas' }, { id: 'fracciones', title: 'Fracciones', parentId: 'numeros' }, { id: 'potencias', title: 'Potencias', parentId: 'numeros' }, { id: 'algebra', title: 'Álgebra', parentId: 'matematicas' }, { id: 'ecuaciones', title: 'Ecuaciones', parentId: 'algebra' }]
  const statementPath = 'ejercicios/demo-exercise/statement.pdf'; const solvedPath = 'ejercicios/demo-exercise/solved.pdf'
  const batch = db.batch()
  batch.set(db.doc(`grupos/${group}`), { teacherId: 'demo-teacher', academicYear: `${year}-${year + 1}`, type: 'teaching', level: '1ºESO', name: '1º ESO A · Prueba', subjectId: subject, subject: 'Matemáticas', studentCount: 1, evaluation: { structure: [], weights: {} }, schedule: [] })
  batch.set(db.doc(`grupos/${group}/alumnos/${studentCode}`), { results: {} })
  batch.set(db.doc(`studentAccessCodes/${studentCode}`), { active: true, authUid: 'demo-student', groupId: group, groupIds: [group], teacherId: 'demo-teacher' })
  batch.set(db.doc('especialidades/Matemáticas'), { nodes, asignaturas: { [subject]: nodes.map((node) => node.id) } })
  batch.set(db.doc('ejercicios/demo-exercise'), { titulo: 'Suma de fracciones', curriculum: { subjectId: subject }, contenidos: ['fracciones'], gradingCriteria: [{ id: 'calculo', description: 'Calcula el denominador común y la suma', points: 2 }], workedSolution: { latex: '1/2 + 1/4 = 3/4' }, pdf: { statement: { storagePath: statementPath }, solved: { storagePath: solvedPath } } })
  ;[{ id: 'one', concept: 'fracciones', obtained: 1 }, { id: 'two', concept: 'fracciones', obtained: 2 }, { id: 'three', concept: 'ecuaciones', obtained: 0.5 }].forEach((item, index) => batch.set(db.doc(`studentTraining/${studentCode}/attempts/demo-${item.id}`), { subjectId: subject, groupId: group, status: 'completed', key: `sample:${item.id}`, completedAt: new Date(Date.now() - (index + 1) * 86400000).toISOString(), segments: [{ conceptIds: [item.concept], maximum: 2, obtained: item.obtained }] }))
  await Promise.all([batch.commit(), bucket.file(statementPath).save(pdf('Ejercicio: calcula 1/2 + 1/4'), { resumable: false }), bucket.file(solvedPath).save(pdf('Solucion: 1/2 + 1/4 = 3/4'), { resumable: false })])
  console.log('Demo lista. Profesor: profesor@ejemplo.test / neopeprueba. Alumno: ABC234 / neopeprueba.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
