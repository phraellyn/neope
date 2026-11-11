import { HttpsError } from 'firebase-functions/v2/https'
import { createHash } from 'node:crypto'
import { conceptProgress, pdfStoragePath, selectTrainingCandidate, terminalConceptsForSelection, trainingReadiness, trainingSegments, trainingVersionPublished } from './studentTrainingLogic.js'
import { examPdfCandidates, examResultItem, safeExamAssessment, safeExamExercise } from './studentExam.js'

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 500 && value !== '.' && value !== '..' && !value.includes('/')
const unique = (values) => [...new Set(Array.isArray(values) ? values.filter(validId) : [])]

function legacyConversationFields(message) {
  if (message.conversationVersion === 2) return {}
  return { conversationVersion: 2, legacyReply: message.reply ? { text: message.reply, createdAt: message.replyAt || message.updatedAt || message.createdAt } : null }
}

async function conversationEntries(db, snapshot) {
  const message = snapshot.data()
  const entries = []
  if (message.text) entries.push({ id: 'original', sender: 'student', text: message.text, createdAt: message.createdAt || '' })
  const legacy = message.conversationVersion === 2 ? message.legacyReply : message.reply ? { text: message.reply, createdAt: message.replyAt || message.updatedAt || message.createdAt } : null
  if (legacy?.text) entries.push({ id: 'legacy-reply', sender: 'teacher', ...legacy })
  const stored = await db.collection(`studentMessages/${snapshot.id}/entries`).get()
  entries.push(...stored.docs.map((doc) => ({ id: doc.id, ...doc.data() })))
  return entries.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
}

export { pdfStoragePath } from './studentTrainingLogic.js'

export function studentTrainingHandlers({ db, bucket, auth }) {
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
    return { id: session.id, status: session.status, exerciseId: session.exerciseId, key: session.key, durationMinutes: session.durationMinutes,
      timer: session.timer, selectedConceptIds: session.selectedConceptIds,
      ...(session.status === 'review' ? { segments: session.segments, criteriaIds: session.criteriaIds || [], legacyAssessment: session.legacyAssessment === true } : {}) }
  }

  function usedRef(context, subjectId, key) {
    return db.doc(`studentTraining/${context.code}/used/${createHash('sha256').update(`${subjectId}:${key}`).digest('hex')}`)
  }

  async function load(request) {
    const context = await identity(request, request.data?.groupId)
    const [nodes, session, attempts] = await Promise.all([catalog(context.group.subjectId), context.session.get(), context.attempts.where('subjectId', '==', context.group.subjectId).get()])
    const history = attempts.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    const completed = history.filter((item) => item.status === 'completed')
    const exerciseIds = [...new Set(completed.map((item) => item.exerciseId).filter(validId))]
    const exercises = new Map(await Promise.all(exerciseIds.map(async (id) => [id, (await db.doc(`ejercicios/${id}`).get()).data() || {}])))
    const items = completed.map((item) => {
      const root = exercises.get(item.exerciseId) || {}
      const version = item.variationId ? (Array.isArray(root.variaciones) ? root.variaciones : []).find((entry) => entry.id === item.variationId) || {} : root
      const structure = version.structure || version
      const parts = Array.isArray(structure.parts) ? structure.parts : Array.isArray(structure.apartados) ? structure.apartados : []
      const source = structure.statement?.latex || structure.enunciado || parts.map((part) => part?.statement?.latex || part?.enunciado).find((value) => typeof value === 'string' && value.trim()) || version.codigo || version.latex || version.titulo || root.titulo || 'Ejercicio de entrenamiento'
      const title = String(source).replace(/%[^\n]*/g, '').replace(/\\(?:ej|M|p)\s*(?:\{[^{}]*\})?/g, '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Ejercicio de entrenamiento'
      return { id: item.id, title, completedAt: item.completedAt || '', obtained: (item.segments || []).reduce((sum, part) => sum + (Number(part.obtained) || 0), 0), maximum: (item.segments || []).reduce((sum, part) => sum + (Number(part.maximum) || 0), 0) }
    }).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)) || b.id.localeCompare(a.id))
    return { nodes, session: publicSession(session.data()), progress: conceptProgress(history, nodes), completedCount: completed.length, history: items }
  }

  async function start(request) {
    const data = request.data || {}
    const context = await identity(request, data.groupId)
    const nodes = await catalog(context.group.subjectId)
    const allowed = new Set(nodes.map((node) => node.id))
    const requested = unique(data.selectedConceptIds)
    if (!requested.length || requested.some((id) => !allowed.has(id))) throw new HttpsError('invalid-argument', 'Selecciona contenidos de esta asignatura.')
    const selected = terminalConceptsForSelection(requested, nodes)
    if (!selected.length) throw new HttpsError('invalid-argument', 'Selecciona contenidos finales de esta asignatura.')
    const [bank, attempts, sessions] = await Promise.all([
      db.collection('ejercicios').where('curriculum.subjectId', '==', context.group.subjectId).get(),
      context.attempts.where('subjectId', '==', context.group.subjectId).get(),
      db.collection(`studentTraining/${context.code}/sessions`).where('subjectId', '==', context.group.subjectId).get(),
    ])
    const exercises = bank.docs.map((doc) => {
      const exercise = { ...doc.data(), id: doc.id }
      const usable = (version, variant = false) => trainingReadiness(version, { exerciseId: doc.id, bucketName: bucket.name, variant }).usable
      exercise.variaciones = (Array.isArray(exercise.variaciones) ? exercise.variaciones : []).filter((item) => item && usable(item, true))
      return usable(exercise) ? exercise : { ...exercise, pdf: null }
    })
    const completed = attempts.docs.map((doc) => doc.data()).filter((item) => item.status === 'completed').map((item) => item.key)
    const active = sessions.docs.map((doc) => doc.data()).filter((item) => ['active', 'review'].includes(item.status)).map((item) => item.key)
    const previousSession = sessions.docs.find((doc) => doc.id === data.groupId)?.data()
    const deferredKeys = unique(previousSession?.deferredKeys).slice(-1000)
    if (sessions.docs.some((doc) => doc.id === data.groupId && ['active', 'review'].includes(doc.data().status))) throw new HttpsError('failed-precondition', 'Ya hay un ejercicio en curso.')
    let candidate, version, statement, solution
    const unavailable = Array.isArray(data.excludeKeys) ? data.excludeKeys.filter((key) => typeof key === 'string' && key.length <= 1000).slice(0, 50) : []
    while (true) {
      candidate = selectTrainingCandidate(exercises, selected, nodes, completed, { repeat: data.repeat === true, active: [...active, ...unavailable], deferred: deferredKeys })
      if (!candidate) throw new HttpsError('not-found', unavailable.length ? 'No quedan ejercicios disponibles. Algunos necesitan volver a compilarse.' : 'No quedan ejercicios disponibles para estos contenidos.')
      const root = exercises.find((exercise) => exercise.id === candidate.exerciseId)
      version = candidate.variationId ? root.variaciones.find((item) => item.id === candidate.variationId) : root
      const statementPath = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, root.id, bucket.name)
      const solutionPath = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, root.id, bucket.name)
      try {
        ;[statement, solution] = await Promise.all([bucket.file(statementPath).download(), bucket.file(solutionPath).download()])
        if (!statement[0]?.length || !solution[0]?.length || statement[0].length > 7_000_000 || solution[0].length > 7_000_000) { unavailable.push(candidate.key); continue }
        break
      } catch (error) {
        if (Number(error?.code) !== 404) throw error
        unavailable.push(candidate.key)
      }
    }
    const id = context.attempts.doc().id
    const privateStatement = `studentTraining/${context.code}/${id}/statement.pdf`
    const privateSolution = `studentTraining/${context.code}/${id}/solution.pdf`
    try {
      await Promise.all([bucket.file(privateStatement).save(statement[0], { resumable: false, contentType: 'application/pdf' }), bucket.file(privateSolution).save(solution[0], { resumable: false, contentType: 'application/pdf' })])
    } catch (error) {
      await Promise.allSettled([bucket.file(privateStatement).delete({ ignoreNotFound: true }), bucket.file(privateSolution).delete({ ignoreNotFound: true })])
      throw error
    }
    const rawDuration = Number(version.durationMinutes || version.structure?.tiempo)
    const durationMinutes = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 15
    const session = { id, groupId: data.groupId, subjectId: context.group.subjectId, status: 'active', key: candidate.key, exerciseId: candidate.exerciseId, variationId: candidate.variationId, selectedConceptIds: selected, deferredKeys,
      segments: candidate.segments, statementPath: privateStatement, solutionPath: privateSolution, durationMinutes, timer: { elapsedMs: 0, runningSince: Date.now(), alerted: false } }
    try { await db.runTransaction(async (tx) => {
      const current = await tx.get(context.session)
      if (['active', 'review'].includes(current.data()?.status)) throw new HttpsError('failed-precondition', 'Ya hay un ejercicio en curso.')
      const used = await tx.get(db.doc(`studentTraining/${context.code}/used/${createHash('sha256').update(`${context.group.subjectId}:${candidate.key}`).digest('hex')}`))
      const currentExercise = await tx.get(db.doc(`ejercicios/${candidate.exerciseId}`))
      if (!trainingVersionPublished(currentExercise.data(), candidate.variationId)) throw new HttpsError('aborted', 'Este ejercicio acaba de retirarse. Vuelve a proponer otro.')
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
    if (request.data?.attemptId) {
      if (!validId(request.data.attemptId) || request.data?.kind !== 'statement') throw new HttpsError('invalid-argument', 'La solicitud del enunciado no es válida.')
      const attempt = (await context.attempts.doc(request.data.attemptId).get()).data()
      if (!attempt || attempt.status !== 'completed' || attempt.subjectId !== context.group.subjectId || !validId(attempt.exerciseId)) throw new HttpsError('not-found', 'El intento ya no está disponible.')
      const root = (await db.doc(`ejercicios/${attempt.exerciseId}`).get()).data()
      const version = attempt.variationId ? (Array.isArray(root?.variaciones) ? root.variaciones : []).find((item) => item.id === attempt.variationId) : root
      const path = pdfStoragePath(version?.pdf?.statement || version?.pdf?.enunciado, attempt.exerciseId, bucket.name)
      if (!path) throw new HttpsError('not-found', 'El enunciado de este ejercicio ya no está disponible.')
      let bytes
      try { [bytes] = await bucket.file(path).download() }
      catch (error) {
        if (Number(error?.code) === 404) throw new HttpsError('not-found', 'El enunciado de este ejercicio ya no está disponible.')
        throw error
      }
      if (bytes.length > 7_000_000) throw new HttpsError('resource-exhausted', 'El PDF es demasiado grande para mostrarlo.')
      return { data: bytes.toString('base64') }
    }
    const session = (await context.session.get()).data()
    if (!session || session.id !== request.data?.sessionId || !['active', 'review'].includes(session.status)) throw new HttpsError('not-found', 'El intento ya no está disponible.')
    const solved = request.data?.kind === 'solved'
    if (solved && session.status !== 'review') throw new HttpsError('permission-denied', 'Solicita primero la solución.')
    const path = solved ? session.solutionPath : session.statementPath
    if (path !== `studentTraining/${context.code}/${session.id}/${solved ? 'solution' : 'statement'}.pdf`) throw new HttpsError('failed-precondition', 'El PDF no está disponible.')
    let bytes
    try { [bytes] = await bucket.file(path).download() }
    catch (error) {
      if (Number(error?.code) === 404) throw new HttpsError('not-found', 'El PDF de este ejercicio ya no está disponible.')
      throw error
    }
    if (bytes.length > 7_000_000) throw new HttpsError('resource-exhausted', 'El PDF es demasiado grande para la vista de práctica.')
    return { data: bytes.toString('base64') }
  }

  async function update(request) {
    const data = request.data || {}
    const context = await identity(request, data.groupId)
    if (['history-reset', 'history-reevaluate', 'history-redo'].includes(data.action)) {
      if (!validId(data.attemptId)) throw new HttpsError('invalid-argument', 'El intento no es válido.')
      const attemptRef = context.attempts.doc(data.attemptId)
      const attempt = (await attemptRef.get()).data()
      if (!attempt || attempt.status !== 'completed' || attempt.subjectId !== context.group.subjectId) throw new HttpsError('not-found', 'El intento ya no está disponible.')
      if (data.action === 'history-reset') {
        await db.runTransaction(async (tx) => {
          const [current, stored, matching, reservation] = await Promise.all([tx.get(context.session), tx.get(attemptRef), tx.get(context.attempts.where('subjectId', '==', context.group.subjectId)), tx.get(usedRef(context, attempt.subjectId, attempt.key))])
          if (!stored.exists || stored.data()?.status !== 'completed') throw new HttpsError('not-found', 'El intento ya no está disponible.')
          if ((['active', 'review'].includes(current.data()?.status) && current.data()?.key === attempt.key) || reservation.data()?.status === 'active') throw new HttpsError('failed-precondition', 'Termina primero el ejercicio que tienes en curso.')
          matching.docs.filter((item) => item.data().status === 'completed' && item.data().key === attempt.key).forEach((item) => tx.delete(item.ref))
          tx.delete(usedRef(context, attempt.subjectId, attempt.key))
        })
        return { session: null }
      }
      if (!validId(attempt.exerciseId)) throw new HttpsError('not-found', 'Este ejercicio ya no está disponible.')
      const root = (await db.doc(`ejercicios/${attempt.exerciseId}`).get()).data()
      if (data.action === 'history-redo' && !trainingVersionPublished(root, attempt.variationId)) throw new HttpsError('failed-precondition', 'Este ejercicio ya no está disponible para volver a hacerlo.')
      const version = attempt.variationId ? (Array.isArray(root?.variaciones) ? root.variaciones : []).find((item) => item.id === attempt.variationId) : root
      if (!version) throw new HttpsError('not-found', 'Este ejercicio ya no está disponible.')
      const segments = Array.isArray(attempt.assessmentSegments) && attempt.assessmentSegments.length ? attempt.assessmentSegments : trainingSegments(version)
      if (!segments.length) throw new HttpsError('failed-precondition', 'La matriz de este ejercicio ya no está disponible.')
      const statementPath = pdfStoragePath(version.pdf?.statement || version.pdf?.enunciado, attempt.exerciseId, bucket.name)
      const solutionPath = pdfStoragePath(version.pdf?.solved || version.pdf?.resuelto, attempt.exerciseId, bucket.name)
      if (!statementPath || !solutionPath) throw new HttpsError('not-found', 'Los PDF de este ejercicio ya no están disponibles.')
      const [[statement], [solution]] = await Promise.all([bucket.file(statementPath).download(), bucket.file(solutionPath).download()])
      if (!statement.length || !solution.length || statement.length > 7_000_000 || solution.length > 7_000_000) throw new HttpsError('resource-exhausted', 'Los PDF de este ejercicio no se pueden abrir.')
      const id = context.attempts.doc().id
      const privateStatement = `studentTraining/${context.code}/${id}/statement.pdf`
      const privateSolution = `studentTraining/${context.code}/${id}/solution.pdf`
      const review = data.action === 'history-reevaluate'
      const duration = Number(version.durationMinutes || version.structure?.tiempo)
      const session = { id, groupId: data.groupId, subjectId: attempt.subjectId, status: review ? 'review' : 'active', key: attempt.key, exerciseId: attempt.exerciseId, variationId: attempt.variationId || null, selectedConceptIds: Array.isArray(attempt.selectedConceptIds) ? attempt.selectedConceptIds : [...new Set((attempt.segments || []).flatMap((segment) => segment.conceptIds || []))], segments, statementPath: privateStatement, solutionPath: privateSolution, durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : 15, timer: { elapsedMs: 0, runningSince: review ? null : Date.now(), alerted: false }, ...(review ? { historyAttemptId: data.attemptId, criteriaIds: Array.isArray(attempt.criteriaIds) ? attempt.criteriaIds : [], legacyAssessment: !Array.isArray(attempt.criteriaIds) } : {}) }
      try {
        await Promise.all([bucket.file(privateStatement).save(statement, { resumable: false, contentType: 'application/pdf' }), bucket.file(privateSolution).save(solution, { resumable: false, contentType: 'application/pdf' })])
        await db.runTransaction(async (tx) => {
          const [current, stored, used, currentExercise] = await Promise.all([tx.get(context.session), tx.get(attemptRef), tx.get(usedRef(context, attempt.subjectId, attempt.key)), tx.get(db.doc(`ejercicios/${attempt.exerciseId}`))])
          if (['active', 'review'].includes(current.data()?.status)) throw new HttpsError('failed-precondition', 'Termina o abandona primero el ejercicio que tienes en curso.')
          if (!stored.exists || stored.data()?.status !== 'completed') throw new HttpsError('not-found', 'El intento ya no está disponible.')
          if (!review && !trainingVersionPublished(currentExercise.data(), attempt.variationId)) throw new HttpsError('failed-precondition', 'Este ejercicio ya no está disponible para volver a hacerlo.')
          if (used.data()?.status === 'active') throw new HttpsError('failed-precondition', 'Este ejercicio está en curso en otra asignatura.')
          session.deferredKeys = current.data()?.subjectId === attempt.subjectId ? unique(current.data()?.deferredKeys).slice(-1000) : []
          tx.set(usedRef(context, attempt.subjectId, attempt.key), { key: attempt.key, subjectId: attempt.subjectId, status: 'active', sessionId: id })
          tx.set(context.session, session)
        })
      } catch (error) {
        await Promise.allSettled([bucket.file(privateStatement).delete({ ignoreNotFound: true }), bucket.file(privateSolution).delete({ ignoreNotFound: true })])
        throw error
      }
      return { session: publicSession(session) }
    }
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
      else if (data.action === 'abandon') {
        if (session.status === 'active') session.deferredKeys = [...unique(session.deferredKeys).filter((key) => key !== session.key), session.key].slice(-1000)
        session.status = 'abandoned'; cleanup = [session.statementPath, session.solutionPath]; if (reservation.data()?.sessionId === session.id) tx.delete(usedRef)
      }
      else if (data.action === 'complete' && session.status === 'review') {
        const selected = new Set(Array.isArray(data.criteriaIds) ? data.criteriaIds.filter((id) => typeof id === 'string' && id.length <= 330) : [])
        const all = session.segments.flatMap((segment) => segment.criteria.map((criterion) => `${segment.id}:${criterion.id}`))
        if ([...selected].some((id) => !all.includes(id))) throw new HttpsError('invalid-argument', 'Hay criterios no válidos.')
        const segments = session.segments.map((segment) => ({ conceptIds: segment.conceptIds, maximum: segment.maximum, obtained: segment.criteria.reduce((sum, criterion) => sum + (selected.has(`${segment.id}:${criterion.id}`) ? criterion.points : 0), 0) }))
        const previous = session.historyAttemptId ? (await tx.get(context.attempts.doc(session.historyAttemptId))).data() : null
        if (session.historyAttemptId && (!previous || previous.subjectId !== session.subjectId)) throw new HttpsError('not-found', 'El intento original ya no está disponible.')
        tx.set(context.attempts.doc(session.historyAttemptId || session.id), { groupId: session.groupId, subjectId: session.subjectId, key: session.key, exerciseId: session.exerciseId, variationId: session.variationId, status: 'completed', segments, assessmentSegments: session.segments, criteriaIds: [...selected], selectedConceptIds: session.selectedConceptIds || [], completedAt: previous?.completedAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
        tx.set(usedRef, { key: session.key, subjectId: session.subjectId, status: 'completed', completedAt: new Date(now).toISOString() })
        session.deferredKeys = unique(session.deferredKeys).filter((key) => key !== session.key)
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
      if (data.messageId !== undefined && !validId(data.messageId)) throw new HttpsError('invalid-argument', 'Conversación no válida.')
      const message = data.messageId ? messages.doc(data.messageId) : messages.doc()
      const entry = db.collection(`studentMessages/${message.id}/entries`).doc()
      await db.runTransaction(async (tx) => {
        const previous = await tx.get(limit)
        const conversation = data.messageId ? await tx.get(message) : null
        if (data.messageId && (!conversation.exists || conversation.data().groupId !== data.groupId || conversation.data().studentCode !== context.code)) throw new HttpsError('not-found', 'No se ha encontrado la conversación.')
        if (conversation && ['resolved', 'dismissed'].includes(conversation.data().status)) throw new HttpsError('failed-precondition', 'Esta conversación está cerrada. El profesor debe reabrirla para seguir escribiendo.')
        const now = Date.now()
        if (now - (Number(previous.data()?.lastSentAt) || 0) < 2000) throw new HttpsError('resource-exhausted', 'Espera un momento antes de enviar otro mensaje.')
        const timestamp = new Date(now).toISOString()
        tx.set(limit, { lastSentAt: now })
        if (conversation) {
          tx.set(entry, { sender: 'student', text, createdAt: timestamp })
          tx.update(message, { ...legacyConversationFields(conversation.data()), status: 'pending', updatedAt: timestamp, studentLastAt: timestamp, lastText: text })
        } else tx.set(message, { groupId: data.groupId, studentCode: context.code, subjectId: context.group.subjectId, text, status: 'pending', reply: '', createdAt: timestamp, updatedAt: timestamp, studentLastAt: timestamp, lastText: text })
      })
      data.messageId = message.id
    }
    const snapshot = await messages.where('studentCode', '==', context.code).get()
    const own = snapshot.docs.filter((doc) => doc.data().groupId === data.groupId)
    const selected = data.messageId ? own.find((doc) => doc.id === data.messageId) : null
    if (data.messageId && !selected) throw new HttpsError('not-found', 'No se ha encontrado la conversación.')
    if (data.markRead === true) await Promise.all((selected ? [selected] : own).filter((doc) => doc.data().replyAt && doc.data().replyAt > (doc.data().studentSeenAt || '')).map((doc) => doc.ref.update({ studentSeenAt: doc.data().replyAt })))
    const entries = selected ? await conversationEntries(db, selected) : []
    const list = own.map((doc) => ({ id: doc.id, ...doc.data(), ...(selected?.id === doc.id && data.markRead === true ? { studentSeenAt: doc.data().replyAt || '' } : {}) })).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    let teacherName = ''
    if (validId(context.group.teacherId)) {
      const profile = (await db.doc(`teachers/${context.group.teacherId}`).get()).data() || {}
      teacherName = typeof profile.displayName === 'string' ? profile.displayName.trim() : ''
      if (!teacherName && auth) teacherName = (await auth.getUser(context.group.teacherId).catch(() => null))?.displayName || ''
    }
    return { messages: list, entries, conversationId: selected?.id || null, teacherName }
  }

  async function teacherMessages(request) {
    const data = request.data || {}
    if (request.auth?.token?.role !== 'teacher' || !validId(data.groupId)) throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
    const group = await db.doc(`grupos/${data.groupId}`).get()
    if (!group.exists || group.data()?.teacherId !== request.auth.uid) throw new HttpsError('permission-denied', 'Este grupo no pertenece al profesor.')
    const messages = db.collection('studentMessages')
    if (data.messageId !== undefined) {
      if (!validId(data.messageId) || (data.status !== undefined && !['pending', 'waiting', 'resolved', 'dismissed'].includes(data.status))) throw new HttpsError('invalid-argument', 'Estado o mensaje no válido.')
      const reply = String(data.reply || '').trim()
      if (reply.length > 2000) throw new HttpsError('invalid-argument', 'La respuesta es demasiado larga.')
      const reference = messages.doc(data.messageId)
      const entry = db.collection(`studentMessages/${data.messageId}/entries`).doc()
      await db.runTransaction(async (tx) => {
        const message = await tx.get(reference)
        if (!message.exists || message.data().groupId !== data.groupId) throw new HttpsError('not-found', 'No se ha encontrado el mensaje.')
        const now = new Date().toISOString()
        const changes = {}
        if (data.status !== undefined) { changes.status = data.status; changes.updatedAt = now }
        if (reply && (data.append === true || reply !== message.data().reply)) {
          if (['resolved', 'dismissed'].includes(message.data().status)) throw new HttpsError('failed-precondition', 'Reabre la conversación antes de enviar mensajes.')
          tx.set(entry, { sender: 'teacher', text: reply, createdAt: now }); Object.assign(changes, legacyConversationFields(message.data()), { reply, replyAt: now, updatedAt: now, lastText: reply })
        }
        if (data.markRead === true) changes.teacherSeenAt = message.data().studentLastAt || message.data().createdAt || now
        if (Object.keys(changes).length) tx.update(reference, changes)
      })
    }
    const snapshot = await messages.where('groupId', '==', data.groupId).get()
    const selected = data.messageId ? snapshot.docs.find((doc) => doc.id === data.messageId) : null
    const result = { messages: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))), entries: selected ? await conversationEntries(db, selected) : [] }
    if (data.includeTrainingCounts === true && group.data()?.subjectId) {
      const roster = await db.collection(`grupos/${data.groupId}/alumnos`).get()
      const counts = await Promise.allSettled(roster.docs.filter((student) => validId(student.id)).map(async (student) => {
        const [attempts, access] = await Promise.all([
          db.collection(`studentTraining/${student.id}/attempts`).where('subjectId', '==', group.data().subjectId).get(),
          db.doc(`studentAccessCodes/${student.id}`).get(),
        ])
        const code = access.data() || {}
        let entered = false
        if (code.active === true && code.authUid && auth) {
          const account = await auth.getUser(code.authUid).catch(() => null)
          entered = account ? Boolean(!account.disabled && account.metadata?.lastSignInTime) : null
        } else if (code.active === true && code.authUid) {
          entered = null
        }
        return [student.id, attempts.docs.filter((attempt) => attempt.data().status === 'completed').length, entered]
      }))
      const available = counts.filter((item) => item.status === 'fulfilled').map((item) => item.value)
      result.trainingCounts = Object.fromEntries(available.map(([id, count]) => [id, count]))
      result.trainingAccess = Object.fromEntries(available.map(([id, , entered]) => [id, entered]))
    }
    return result
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
  async function publishedExam(request) {
    const { groupId, itemId } = request.data || {}
    if (!validId(itemId)) throw new HttpsError('invalid-argument', 'Resultado no válido.')
    const context = await identity(request, groupId)
    const [publication, student] = await Promise.all([db.doc(`grupos/${groupId}/studentPublications/result-${itemId}`).get(), db.doc(`grupos/${groupId}/alumnos/${context.code}`).get()])
    const item = examResultItem(context.group, itemId)
    const results = student.data()?.results || {}
    if (!publication.exists || publication.data()?.visible !== true || !item || !Object.hasOwn(results, itemId)) throw new HttpsError('permission-denied', 'Este resultado no está publicado.')
    const documentId = item.documentAssessment.documentId
    if (!validId(documentId)) throw new HttpsError('failed-precondition', 'El documento no está disponible.')
    const snapshot = await db.doc(`documentos/${documentId}`).get()
    if (!snapshot.exists) return { pdf: null, matrix: null }
    const document = snapshot.data() || {}
    let pdf = null
    for (const candidate of examPdfCandidates(document, documentId, bucket.name)) {
      try {
        const [bytes] = await bucket.file(candidate.path).download()
        if (bytes.length <= 7_000_000) { pdf = { data: bytes.toString('base64'), kind: candidate.solved ? 'solved' : 'statement' }; break }
      } catch (error) { if (Number(error?.code) !== 404) throw error }
    }
    const result = results[itemId]
    if (!result || typeof result !== 'object' || Number.isFinite(result.manualTotal) || !Array.isArray(result.selectedAchievementIds)) return { pdf, matrix: null }
    const stored = (Array.isArray(document.ejercicios) ? document.ejercicios : []).map((reference, order) => ({ ...reference, order: reference.order ?? order }))
    const requested = item.documentAssessment.exercises?.length ? item.documentAssessment.exercises : stored
    const references = requested.map((reference, order) => {
      const version = Number(reference.version) || 0
      const embedded = stored.find((candidate) => reference.blockId && candidate.blockId === reference.blockId)
        || stored.find((candidate) => candidate.order === (reference.order ?? order) && candidate.exerciseId === reference.exerciseId && (Number(candidate.version) || 0) === version)
        || stored.find((candidate) => candidate.exerciseId === reference.exerciseId && (Number(candidate.version) || 0) === version)
      return { ...embedded, ...reference, order: reference.order ?? embedded?.order ?? order, snapshot: reference.snapshot || embedded?.snapshot || null }
    }).sort((a, b) => a.order - b.order)
    const exercises = (await Promise.all(references.map(async (reference, order) => {
      if (!validId(reference.exerciseId)) return null
      let source = reference.snapshot
      if (!source) { const exercise = await db.doc(`ejercicios/${reference.exerciseId}`).get(); if (!exercise.exists) return null; source = exercise.data() }
      const version = Number(reference.version) || 0
      const active = version ? source.variaciones?.[version - 1] || source : source
      return { exerciseId: reference.exerciseId, version, order, source: safeExamExercise(active), assessment: safeExamAssessment(reference.snapshot?.assessment || reference.assessment || {}) }
    }))).filter(Boolean)
    return { pdf, matrix: exercises.length ? { exercises, selectedAchievementIds: result.selectedAchievementIds.filter((id) => typeof id === 'string') } : null }
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
      ;[exercise, ...(Array.isArray(exercise.variaciones) ? exercise.variaciones : [])].forEach((version, index) => {
        const { reasons } = trainingReadiness(version, { exerciseId: doc.id, bucketName: bucket.name, variant: index > 0 })
        if (reasons.length) problems.push({ exerciseId: doc.id, version: index, title: String(version?.titulo || exercise.titulo || `Ejercicio ${doc.id}`).slice(0, 160), reasons })
      })
    })
    return { total: bank.docs.length, problems }
  }
  return { load, start, pdf, update, studentMessages, teacherMessages, teacherProgress, readiness, publishedExam }
}
