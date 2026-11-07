import assert from 'node:assert/strict'
import { pdfStoragePath, studentTrainingHandlers } from '../functions/studentTraining.js'

const store = new Map([
  ['studentAccessCodes/ABC234', { active: true, authUid: 'user', groupIds: ['g1'] }],
  ['grupos/g1', { subjectId: 'subject', teacherId: 'teacher' }], ['grupos/g1/alumnos/ABC234', {}],
  ['especialidades/Matemáticas', { nodes: [{ id: 'a', title: 'A' }], asignaturas: { subject: ['a'] } }],
  ['ejercicios/ex1', { curriculum: { subjectId: 'subject' }, contenidos: ['a'], gradingCriteria: [{ id: 'criterion', description: 'Paso', points: 2 }], workedSolution: { latex: 'Solución', pdf: { storagePath: 'ejercicios/ex1/part.pdf' } }, pdf: { statement: { storagePath: 'ejercicios/ex1/statement.pdf' }, solved: { storagePath: 'ejercicios/ex1/solved.pdf' } } }],
])
let nextId = 0
function snapshot(path) { return { id: path.split('/').at(-1), ref: doc(path), exists: store.has(path), data: () => structuredClone(store.get(path)) } }
function doc(path) { return { path, id: path.split('/').at(-1), get: async () => snapshot(path), update: async (value) => store.set(path, { ...store.get(path), ...structuredClone(value) }) } }
function collection(path) {
  return { doc: (id = `attempt${++nextId}`) => doc(`${path}/${id}`), add: async (value) => { const ref = doc(`${path}/message${++nextId}`); store.set(ref.path, structuredClone(value)); return ref }, where: (field, _op, value) => ({ get: async () => ({ docs: [...store.keys()].filter((key) => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') < 0 && field.split('.').reduce((obj, part) => obj?.[part], store.get(key)) === value).map(snapshot) }) }) }
}
const db = { doc, collection, runTransaction: async (callback) => callback({ get: async (ref) => snapshot(ref.path), set: (ref, value) => store.set(ref.path, structuredClone(value)), update: (ref, value) => store.set(ref.path, { ...store.get(ref.path), ...structuredClone(value) }), delete: (ref) => store.delete(ref.path) }) }
const files = new Map()
const missingPaths = new Set()
const bucket = { name: 'bucket', file: (path) => ({ download: async () => { if (missingPaths.has(path)) throw Object.assign(new Error('missing'), { code: 404 }); return [files.get(path) || Buffer.from(path)] }, save: async (bytes) => { files.set(path, bytes) }, delete: async () => { files.delete(path) } }) }
const api = studentTrainingHandlers({ db, bucket })
assert.equal(pdfStoragePath({ storagePath: 'ejercicios/ex1/revision.pdf' }, 'ex1', 'bucket'), 'ejercicios/ex1/revision.pdf')
assert.equal(pdfStoragePath('https://evil.example/v0/b/bucket/o/ejercicios%2Fex1%2Ffile.pdf', 'ex1', 'bucket'), '')
assert.equal(pdfStoragePath({ storagePath: 'ejercicios/ex2/solution.pdf' }, 'ex1', 'bucket'), '')
const request = (data) => ({ auth: { uid: 'user', token: { role: 'student', studentCode: 'ABC234' } }, data: { groupId: 'g1', ...data } })
const session = await api.start(request({ selectedConceptIds: ['a'] }))
assert.equal(session.status, 'active')
assert.ok(files.has(`studentTraining/ABC234/${session.id}/statement.pdf`), 'An active attempt has independent PDF snapshots')
assert.equal('segments' in session, false)
await assert.rejects(() => api.start(request({ selectedConceptIds: ['a'] })), /Ya hay un ejercicio/)
const paused = await api.update(request({ sessionId: session.id, action: 'pause' }))
assert.equal(paused.session.timer.runningSince, null)
const resumed = await api.update(request({ sessionId: session.id, action: 'resume' }))
assert.ok(resumed.session.timer.runningSince)
const restarted = await api.update(request({ sessionId: session.id, action: 'reset' }))
assert.equal(restarted.session.timer.elapsedMs, 0)
await api.update(request({ sessionId: session.id, action: 'alerted' }))
assert.equal((await api.load(request({}))).session.timer.alerted, true, 'The one-time warning survives a reload')
await api.update(request({ sessionId: session.id, action: 'reset' }))
assert.equal((await api.load(request({}))).session.timer.alerted, false, 'Resetting permits one warning for the new cycle')
await assert.rejects(() => api.pdf(request({ sessionId: session.id, kind: 'solved' })), /Solicita primero/)
await assert.rejects(() => api.load({ auth: { uid: 'other', token: { role: 'student', studentCode: 'ABC234' } }, data: { groupId: 'g1' } }), /No tienes acceso/)
await assert.rejects(() => api.load(request({ groupId: 'other' })), /No tienes acceso/)
const revealed = await api.update(request({ sessionId: session.id, action: 'reveal' }))
assert.equal(revealed.session.segments[0].criteria[0].description, 'Paso')
assert.ok((await api.pdf(request({ sessionId: session.id, kind: 'solved' }))).data)
await assert.rejects(() => api.update(request({ sessionId: session.id, action: 'complete', criteriaIds: ['exercise:fake'] })), /criterios no válidos/)
await api.update(request({ sessionId: session.id, action: 'complete', criteriaIds: ['exercise:criterion'] }))
assert.equal(files.size, 0, 'Temporary PDF copies are removed after the attempt')
const loaded = await api.load(request({}))
assert.equal(loaded.progress.a.obtained, 2)
assert.equal(loaded.session, null)
await assert.rejects(() => api.start(request({ selectedConceptIds: ['a'] })), /No quedan ejercicios/)
const original = store.get('ejercicios/ex1')
store.set('ejercicios/ex2', { ...structuredClone(original), pdf: { statement: { storagePath: 'ejercicios/ex2/statement.pdf' }, solved: { storagePath: 'ejercicios/ex2/solved.pdf' } } })
store.set('ejercicios/ex3', { ...structuredClone(original), pdf: { statement: { storagePath: 'ejercicios/ex3/statement.pdf' }, solved: { storagePath: 'ejercicios/ex3/solved.pdf' } } })
missingPaths.add('ejercicios/ex2/solved.pdf')
const nextAvailable = await api.start(request({ selectedConceptIds: ['a'] }))
assert.equal(nextAvailable.exerciseId, 'ex3', 'An unavailable PDF does not prevent proposing another exercise')
await api.update(request({ sessionId: nextAvailable.id, action: 'abandon' }))
const sent = await api.studentMessages(request({ text: 'Tengo una duda' }))
assert.equal(sent.messages.length, 1)
const teacher = (data) => ({ auth: { uid: 'teacher', token: { role: 'teacher' } }, data: { groupId: 'g1', ...data } })
const teacherProgress = await api.teacherProgress(teacher({ studentId: 'ABC234' }))
assert.equal(teacherProgress.nodes[0].id, 'a')
assert.equal(teacherProgress.progress.a.obtained, 2)
assert.equal(teacherProgress.progress.a.provisional, true)
await assert.rejects(() => api.teacherProgress({ auth: { uid: 'other', token: { role: 'teacher' } }, data: { groupId: 'g1', studentId: 'ABC234' } }), /no pertenece/)
await assert.rejects(() => api.teacherProgress(teacher({ studentId: 'OTHER2' })), /no pertenece/)
await assert.rejects(() => api.teacherProgress(request({ studentId: 'ABC234' })), /profesor/)
await assert.rejects(() => api.teacherMessages({ auth: { uid: 'other', token: { role: 'teacher' } }, data: { groupId: 'g1' } }), /no pertenece/)
assert.equal((await api.readiness(teacher({}))).problems.length, 0)
await assert.rejects(() => api.readiness({ auth: { uid: 'other', token: { role: 'teacher' } }, data: { groupId: 'g1' } }), /no pertenece/)
await api.teacherMessages(teacher({ messageId: sent.messages[0].id, status: 'resolved', reply: 'Revisado' }))
assert.equal((await api.studentMessages(request({}))).messages[0].reply, 'Revisado')
await api.studentMessages(request({ markRead: true }))
assert.ok(store.get(`studentMessages/${sent.messages[0].id}`).studentSeenAt)
console.log('Entrenamiento: acceso, solución protegida, puntuación y no repetición verificados.')
