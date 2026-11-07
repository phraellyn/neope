import { HttpsError } from 'firebase-functions/v2/https'
import { createHash } from 'node:crypto'
import { conceptProgress, selectTrainingCandidate, trainingSegments } from './studentTrainingLogic.js'

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500 && value !== '.' && value !== '..' && !value.includes('/')
const unique = (values) => [...new Set(Array.isArray(values) ? values.filter(validId) : [])]

export function pdfStoragePath(reference, exerciseId, bucketName) {
  let path = typeof reference === 'object' && reference ? reference.storagePath || reference.path : ''
  const url = typeof reference === 'string' ? reference : reference?.downloadUrl || reference?.url
  if (!path && url) {
    try {
      const parsed = new URL(url)
      const prefix = `/v0/b/${bucketName}/o/`
      if (parsed.hostname === 'firebasestorage.googleapis.com' && parsed.pathname.startsWith(prefix)) path = decodeURIComponent(parsed.pathname.slice(prefix.length))
    } catch { return '' }
  }
  return typeof path === 'string' && path.startsWith(`ejercicios/${exerciseId}/`) && !path.includes('..') ? path : ''
}

export function studentTrainingHandlers({ db, bucket }) {
  async function identity(request, groupId) {
    const code = request.auth?.token?.studentCode
    if (request.auth?.token?.role !== 'student' || !/^[A-HJ-NP-Za-km-z1-9]{6}$/.test(code || '') || !validId(groupId)) throw new HttpsError('permission-denied', 'Acceso de alumno no válido.')
    const access = await db.doc(`studentAccessCodes/${code}`).get()
    const data = access.data() || {}
    const groups = unique([...(data.groupIds || []), data.groupId])
    if (!access.exists || data.active !== true || data.authUid !== request.auth.uid || !groups.includes(groupId)) throw new HttpsError('permission-denied', 'No tienes acceso a esta asignatura.')
    const [group, student] = await Promise.all([db.doc(`grupos/${groupId}`).get(), db.doc(`grupos/${groupId}/alumnos/${code}`).get()])
    if (!group.exists || !student.exists || !group.data()?.subjectId) throw new HttpsError('failed-precondition', 'La asignatura no está disponible.')
    return { code, group: group.data(), session: db.doc(`studentTraining/${code}/sessions/${groupId}`), attempts: db.collection(`studentTraining/${code}/attempts`) }
  }

  async function catalog(subjectId) {
    const snapshot = await db.doc('especialidades/Matemáticas').get()
    const data = snapshot.data() || {}
    const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter((node) => validId(node.id)).map((node) => ({ id: node.id, title: String(node.title || ''), parentId: validId(node.parentId) ? node.parentId : null }))
    const selection = data.asignaturas?.[subjectId]
    const allowed = new Set(unique(Array.isArray(selection) ? selection : selection?.nodos))
    return nodes.filter((node) => allowed.has(node.id))
  }

  function publicSession(session) {
    if (!session || !['active', 'review'].includes(session.status)) return null
    return { id: session.id, status: session.status, exerciseId: session.exerciseId, durationMinutes: session.durationMinutes,
      timer: session.timer, selectedConceptIds: session.selectedConceptIds,
      ...(session.status === 'review' ? { segments: session.segments } : {}) }
  }

  async function load(request) {
    const context = await identity(request, request.data?.groupId)
    const [nodes, session, attempts] = await Promise.all([catalog(context.group.subjectId), context.session.get(), context.attempts.where('subjectId', '==', context.group.subjectId).get()])
    const history = attempts.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    return { nodes, session: publicSession(session.data()), progress: conceptProgress(history, nodes), completedCount: history.filter((item) => item.status === 'completed').length }
  }

  async function start(request) {
    const data = request.data || {}
    const context = await identity(request, data.groupId)
    const nodes = await catalog(context.group.subjectId)
    const allowed = new Set(nodes.map((node) => node.id))
    const selected = unique(data.selectedConceptIds)
    if (!selected.length || selected.some((id) => !allowed.has(id))) throw new HttpsError('invalid-argument', 'Selecciona contenidos de esta asignatura.')
    const [bank, attempts, sessions] = await Promise.all([
      db.collection('ejercicios').where('curriculum.subjectId', '==', context.group.subjectId).get(),
      context.attempts.where('subjectId', '==', context.group.subjectId).get(),
      db.collection(`studentTraining/${context.code}/sessions`).where('subjectId', '==', context.group.subjectId).get(),
    ])
    const exercises = bank.docs.map((doc) => {
      const exercise = { ...doc.data(), id: doc.id }
      const usable = (version) => {
        const statement = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, doc.id, bucket.name)
        const solution = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, doc.id, bucket.name)
        return Boolean(statement && solution && statement !== solution)
      }
      exercise.variaciones = (exercise.variaciones || []).filter(usable)
      return usable(exercise) ? exercise : { ...exercise, pdf: null }
    })
    const completed = attempts.docs.map((doc) => doc.data()).filter((item) => item.status === 'completed').map((item) => item.key)
    const active = sessions.docs.map((doc) => doc.data()).filter((item) => ['active', 'review'].includes(item.status)).map((item) => item.key)
    if (sessions.docs.some((doc) => doc.id === data.groupId && ['active', 'review'].includes(doc.data().status))) throw new HttpsError('failed-precondition', 'Ya hay un ejercicio en curso.')
    let candidate, version, statement, solution
    const unavailable = []
    while (true) {
      candidate = selectTrainingCandidate(exercises, selected, nodes, completed, { repeat: data.repeat === true, active: [...active, ...unavailable] })
      if (!candidate) throw new HttpsError('not-found', unavailable.length ? 'No quedan ejercicios disponibles. Algunos necesitan volver a compilarse.' : 'No quedan ejercicios disponibles para estos contenidos.')
      const root = exercises.find((exercise) => exercise.id === candidate.exerciseId)
      version = candidate.variationId ? root.variaciones.find((item) => item.id === candidate.variationId) : root
      const statementPath = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, root.id, bucket.name)
      const solutionPath = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, root.id, bucket.name)
      try {
        ;[statement, solution] = await Promise.all([bucket.file(statementPath).download(), bucket.file(solutionPath).download()])
        break
      } catch (error) {
        if (Number(error?.code) !== 404) throw error
        unavailable.push(candidate.key)
      }
    }
    const id = context.attempts.doc().id
    const privateStatement = `studentTraining/${context.code}/${id}/statement.pdf`
    const privateSolution = `studentTraining/${context.code}/${id}/solution.pdf`
    if (statement[0].length > 7_000_000 || solution[0].length > 7_000_000) throw new HttpsError('resource-exhausted', 'El PDF es demasiado grande para la vista de práctica.')
    try {
      await Promise.all([bucket.file(privateStatement).save(statement[0], { resumable: false, contentType: 'application/pdf' }), bucket.file(privateSolution).save(solution[0], { resumable: false, contentType: 'application/pdf' })])
    } catch (error) {
      await Promise.allSettled([bucket.file(privateStatement).delete({ ignoreNotFound: true }), bucket.file(privateSolution).delete({ ignoreNotFound: true })])
      throw error
    }
    const rawDuration = Number(version.durationMinutes || version.structure?.tiempo)
    const durationMinutes = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 15
    const session = { id, groupId: data.groupId, subjectId: context.group.subjectId, status: 'active', key: candidate.key, exerciseId: candidate.exerciseId, variationId: candidate.variationId, selectedConceptIds: selected,
      segments: candidate.segments, statementPath: privateStatement, solutionPath: privateSolution, durationMinutes, timer: { elapsedMs: 0, runningSince: Date.now(), alerted: false } }
    try { await db.runTransaction(async (tx) => {
      const current = await tx.get(context.session)
      if (['active', 'review'].includes(current.data()?.status)) throw new HttpsError('failed-precondition', 'Ya hay un ejercicio en curso.')
      const used = await tx.get(db.doc(`studentTraining/${context.code}/used/${createHash('sha256').update(`${context.group.subjectId}:${candidate.key}`).digest('hex')}`))
      if (used.exists && (used.data()?.status === 'active' || data.repeat !== true)) throw new HttpsError('aborted', 'Este ejercicio ya está en uso o acaba de completarse. Vuelve a proponer otro.')
      tx.set(used.ref || db.doc(`studentTraining/${context.code}/used/${createHash('sha256').update(`${context.group.subjectId}:${candidate.key}`).digest('hex')}`), { status: 'active', sessionId: id, subjectId: context.group.subjectId, key: candidate.key })
      tx.set(context.session, session)
    }) } catch (error) {
      await Promise.allSettled([bucket.file(privateStatement).delete({ ignoreNotFound: true }), bucket.file(privateSolution).delete({ ignoreNotFound: true })])
      throw error
    }
    return publicSession(session)
  }

  async function pdf(request) {
    const context = await identity(request, request.data?.groupId)
    const session = (await context.session.get()).data()
    if (!session || session.id !== request.data?.sessionId || !['active', 'review'].includes(session.status)) throw new HttpsError('not-found', 'El intento ya no está disponible.')
    const solved = request.data?.kind === 'solved'
    if (solved && session.status !== 'review') throw new HttpsError('permission-denied', 'Solicita primero la solución.')
    const path = solved ? session.solutionPath : session.statementPath
    if (path !== `studentTraining/${context.code}/${session.id}/${solved ? 'solution' : 'statement'}.pdf`) throw new HttpsError('failed-precondition', 'El PDF no está disponible.')
    const [bytes] = await bucket.file(path).download()
    if (bytes.length > 7_000_000) throw new HttpsError('resource-exhausted', 'El PDF es demasiado grande para la vista de práctica.')
    return { data: bytes.toString('base64') }
  }

  async function update(request) {
    const data = request.data || {}
    const context = await identity(request, data.groupId)
    let result
    let cleanup = []
    await db.runTransaction(async (tx) => {
      const current = await tx.get(context.session)
      const session = current.data()
      if (!session || session.id !== data.sessionId || !['active', 'review'].includes(session.status)) throw new HttpsError('not-found', 'El intento ya no está disponible.')
      const usedRef = db.doc(`studentTraining/${context.code}/used/${createHash('sha256').update(`${session.subjectId}:${session.key}`).digest('hex')}`)
      const reservation = await tx.get(usedRef)
      const now = Date.now()
      const timer = session.timer || { elapsedMs: 0, runningSince: now, alerted: false }
      const elapsed = Math.max(0, Number(timer.elapsedMs) || 0) + (timer.runningSince ? Math.max(0, now - timer.runningSince) : 0)
      if (data.action === 'pause' && session.status === 'active') session.timer = { ...timer, elapsedMs: elapsed, runningSince: null }
      else if (data.action === 'resume' && session.status === 'active') session.timer = { ...timer, runningSince: timer.runningSince || now }
      else if (data.action === 'reset' && session.status === 'active') session.timer = { elapsedMs: 0, runningSince: timer.runningSince ? now : null, alerted: false }
      else if (data.action === 'alerted' && session.status === 'active') session.timer = { ...timer, alerted: true }
      else if (data.action === 'reveal' && session.status === 'active') { session.timer = { ...timer, elapsedMs: elapsed, runningSince: null }; session.status = 'review' }
      else if (data.action === 'abandon') { session.status = 'abandoned'; cleanup = [session.statementPath, session.solutionPath]; if (reservation.data()?.sessionId === session.id) tx.delete(usedRef) }
      else if (data.action === 'complete' && session.status === 'review') {
        const selected = new Set(Array.isArray(data.criteriaIds) ? data.criteriaIds.filter((id) => typeof id === 'string' && id.length <= 330) : [])
        const all = session.segments.flatMap((segment) => segment.criteria.map((criterion) => `${segment.id}:${criterion.id}`))
        if ([...selected].some((id) => !all.includes(id))) throw new HttpsError('invalid-argument', 'Hay criterios no válidos.')
        const segments = session.segments.map((segment) => ({ conceptIds: segment.conceptIds, maximum: segment.maximum, obtained: segment.criteria.reduce((sum, criterion) => sum + (selected.has(`${segment.id}:${criterion.id}`) ? criterion.points : 0), 0) }))
        tx.set(context.attempts.doc(session.id), { groupId: session.groupId, subjectId: session.subjectId, key: session.key, exerciseId: session.exerciseId, variationId: session.variationId, status: 'completed', segments, completedAt: new Date(now).toISOString() })
        tx.set(usedRef, { key: session.key, subjectId: session.subjectId, status: 'completed', completedAt: new Date(now).toISOString() })
        session.status = 'completed'
        cleanup = [session.statementPath, session.solutionPath]
      } else throw new HttpsError('failed-precondition', 'La operación no está disponible en este momento.')
      tx.set(context.session, session)
      result = publicSession(session)
    })
    await Promise.allSettled(cleanup.filter((path) => path?.startsWith(`studentTraining/${context.code}/${data.sessionId}/`)).map((path) => bucket.file(path).delete({ ignoreNotFound: true })))
    return { session: result }
  }

  async function studentMessages(request) {
    const data = request.data || {}
    const context = await identity(request, data.groupId)
    const messages = db.collection('studentMessages')
    if (data.text !== undefined) {
      const text = String(data.text || '').trim()
      if (!text || text.length > 2000) throw new HttpsError('invalid-argument', 'Escribe un mensaje de hasta 2000 caracteres.')
      const limit = db.doc(`studentTraining/${context.code}/messageLimits/${data.groupId}`)
      const message = messages.doc()
      await db.runTransaction(async (tx) => {
        const previous = await tx.get(limit)
        const now = Date.now()
        if (now - (Number(previous.data()?.lastSentAt) || 0) < 10000) throw new HttpsError('resource-exhausted', 'Espera unos segundos antes de enviar otro mensaje.')
        tx.set(limit, { lastSentAt: now })
        tx.set(message, { groupId: data.groupId, studentCode: context.code, subjectId: context.group.subjectId, text, status: 'pending', reply: '', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
      })
    }
    const snapshot = await messages.where('studentCode', '==', context.code).get()
    const own = snapshot.docs.filter((doc) => doc.data().groupId === data.groupId)
    if (data.markRead === true) await Promise.all(own.filter((doc) => doc.data().replyAt && doc.data().replyAt > (doc.data().studentSeenAt || '')).map((doc) => doc.ref.update({ studentSeenAt: doc.data().replyAt })))
    return { messages: own.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  }

  async function teacherMessages(request) {
    const data = request.data || {}
    if (request.auth?.token?.role !== 'teacher' || !validId(data.groupId)) throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
    const group = await db.doc(`grupos/${data.groupId}`).get()
    if (!group.exists || group.data()?.teacherId !== request.auth.uid) throw new HttpsError('permission-denied', 'Este grupo no pertenece al profesor.')
    const messages = db.collection('studentMessages')
    if (data.messageId !== undefined) {
      if (!validId(data.messageId) || !['pending', 'waiting', 'resolved', 'dismissed'].includes(data.status)) throw new HttpsError('invalid-argument', 'Estado o mensaje no válido.')
      const reply = String(data.reply || '').trim()
      if (reply.length > 2000) throw new HttpsError('invalid-argument', 'La respuesta es demasiado larga.')
      const reference = messages.doc(data.messageId)
      await db.runTransaction(async (tx) => {
        const message = await tx.get(reference)
        if (!message.exists || message.data().groupId !== data.groupId) throw new HttpsError('not-found', 'No se ha encontrado el mensaje.')
        const now = new Date().toISOString()
        tx.update(reference, { status: data.status, reply, updatedAt: now, ...(reply && reply !== message.data().reply ? { replyAt: now } : {}) })
      })
    }
    const snapshot = await messages.where('groupId', '==', data.groupId).get()
    return { messages: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  }
  async function teacherProgress(request) {
    const { groupId, studentId } = request.data || {}
    if (request.auth?.token?.role !== 'teacher' || !validId(groupId) || !validId(studentId)) throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
    const group = await db.doc(`grupos/${groupId}`).get()
    if (!group.exists || group.data()?.teacherId !== request.auth.uid) throw new HttpsError('permission-denied', 'Este grupo no pertenece al profesor.')
    if (!group.data()?.subjectId) throw new HttpsError('failed-precondition', 'La asignatura del grupo no está configurada.')
    const student = await db.doc(`grupos/${groupId}/alumnos/${studentId}`).get()
    if (!student.exists) throw new HttpsError('not-found', 'El alumno no pertenece a este grupo.')
    const subjectId = group.data().subjectId
    const [nodes, attempts] = await Promise.all([
      catalog(subjectId),
      db.collection(`studentTraining/${studentId}/attempts`).where('subjectId', '==', subjectId).get(),
    ])
    return { nodes, progress: conceptProgress(attempts.docs.map((doc) => ({ id: doc.id, ...doc.data() })), nodes) }
  }
  async function readiness(request) {
    const groupId = request.data?.groupId
    if (request.auth?.token?.role !== 'teacher' || !validId(groupId)) throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
    const group = await db.doc(`grupos/${groupId}`).get()
    if (!group.exists || group.data()?.teacherId !== request.auth.uid) throw new HttpsError('permission-denied', 'Este grupo no pertenece al profesor.')
    if (!group.data()?.subjectId) throw new HttpsError('failed-precondition', 'La asignatura del grupo no está configurada.')
    const bank = await db.collection('ejercicios').where('curriculum.subjectId', '==', group.data().subjectId).get()
    const problems = []
    bank.docs.forEach((doc) => {
      const exercise = doc.data()
      ;[exercise, ...(exercise.variaciones || [])].forEach((version, index) => {
        const reasons = []
        if (!trainingSegments(version).length) reasons.push('Faltan contenidos, soluciones o criterios de autoevaluación.')
        const statement = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, doc.id, bucket.name)
        const solution = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, doc.id, bucket.name)
        if (!statement || !solution || statement === solution) reasons.push('Falta compilar el enunciado o la solución.')
        if (index && !version.id) reasons.push('La variante necesita un identificador estable.')
        if (reasons.length) problems.push({ exerciseId: doc.id, version: index, title: String(version.titulo || exercise.titulo || `Ejercicio ${doc.id}`).slice(0, 160), reasons })
      })
    })
    return { total: bank.docs.length, problems }
  }
  return { load, start, pdf, update, studentMessages, teacherMessages, teacherProgress, readiness }
}
