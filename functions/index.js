import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAuth } from 'firebase-admin/auth'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
export {
  acceptTeacherInvitation,
  bootstrapAdminAccount,
  claimStudentAccount,
  createTeacherInvitation,
  getStudentDashboard,
  inspectStudentAccess,
  inspectTeacherInvitation,
  listTeacherInvitations,
  resetStudentAccess,
  revokeTeacherInvitation,
  syncStudentAccessCodes,
} from './auth.js'
import { codeForCompiler, compilationArtifacts, sourceHash } from './exerciseCompilation.js'
import { curriculumPromptContext } from './curriculumContext.js'
import {
  ensureAlignedInDisplayMath,
  hasLegacyDisplayMathDelimiters,
  hasTrailingInfoCommand,
  normalizeDisplayMathDelimiters,
  normalizeLatexTextAccents,
  splitAlignedRows,
  splitOverloadedCompactRows,
} from './solutionLayout.js'

if (!getApps().length) initializeApp()

const adminDb = getFirestore()
const adminStorage = getStorage()
const lomloeMathLaw = JSON.parse(readFileSync(new URL('./lomloeMathLaw.json', import.meta.url), 'utf8'))

function requireTeacherAccess(request) {
  if (!request.auth || request.auth.token.role !== 'teacher') {
    throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
  }
}

const openRouterApiKey = defineSecret('OPENROUTER_API_KEY')
const compilerOrigin = 'http://51.170.57.25:5000'

async function deleteStudentAccounts(accessCodes) {
  const auth = getAuth()
  const userIds = [...new Set(accessCodes.docs.map((entry) => entry.data()?.authUid).filter(Boolean))]
  for (const uid of userIds) {
    try {
      await auth.deleteUser(uid)
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error
    }
  }
  return userIds.length
}

async function detachDocumentsFromGroup(groupId) {
  const fields = ['assessment.groupId', 'programming.groupId', 'groupContext.id']
  const snapshots = await Promise.all(fields.map((field) => (
    adminDb.collection('documentos').where(field, '==', groupId).get()
  )))
  const documents = new Map()
  snapshots.flatMap((snapshot) => snapshot.docs).forEach((entry) => documents.set(entry.id, entry))
  const entries = [...documents.values()]
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = adminDb.batch()
    entries.slice(offset, offset + 400).forEach((entry) => {
      const data = entry.data() || {}
      const updates = { updatedAt: new Date().toISOString() }
      if (data.assessment?.groupId === groupId) {
        updates.assessment = {
          ...data.assessment,
          evaluable: false,
          groupId: null,
          gradebookItemId: null,
        }
      }
      if (data.programming?.groupId === groupId) {
        updates.programming = { ...data.programming, groupId: null, hidden: true }
      }
      if (data.groupContext?.id === groupId) updates.groupContext = FieldValue.delete()
      batch.update(entry.ref, updates)
    })
    await batch.commit()
  }
  return entries.length
}

async function removeGroupFromTeacherCalendar(teacherId, groupId) {
  const reference = adminDb.doc(`teachers/${teacherId}`)
  const snapshot = await reference.get()
  if (!snapshot.exists) return false
  const calendars = structuredClone(snapshot.data()?.calendariosEscolares || {})
  let changed = false
  Object.values(calendars).forEach((calendar) => {
    if (!Array.isArray(calendar?.types)) return
    calendar.types = calendar.types.map((type) => {
      if (!Array.isArray(type?.cursos) || !type.cursos.includes(groupId)) return type
      changed = true
      return { ...type, cursos: type.cursos.filter((id) => id !== groupId) }
    })
  })
  if (changed) await reference.set({ calendariosEscolares: calendars }, { merge: true })
  return changed
}

async function deleteGroupStorage(teacherId, groupId) {
  const bucket = adminStorage.bucket()
  const prefix = `teachers/${teacherId}/programacion/${groupId}/`
  const [files] = await bucket.getFiles({ prefix })
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))
  return files.length
}

export const deleteTeacherGroup = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '256MiB',
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const groupId = String(request.data?.groupId || '').trim()
  if (!groupId) throw new HttpsError('invalid-argument', 'Falta el identificador del grupo.')

  const groupReference = adminDb.doc(`grupos/${groupId}`)
  const group = await groupReference.get()
  if (!group.exists || group.data()?.teacherId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'El grupo no pertenece al profesor.')
  }

  const [students, accessCodes] = await Promise.all([
    groupReference.collection('alumnos').get(),
    adminDb.collection('studentAccessCodes').where('groupId', '==', groupId).get(),
  ])

  // Todo lo que vive fuera del árbol del grupo se limpia antes del borrado
  // recursivo. Cada paso es repetible: si una ejecución se interrumpe, el
  // usuario puede volver a confirmar sin dejar referencias huérfanas.
  const [deletedAccounts, detachedDocuments, calendarUpdated, deletedFiles] = await Promise.all([
    deleteStudentAccounts(accessCodes),
    detachDocumentsFromGroup(groupId),
    removeGroupFromTeacherCalendar(request.auth.uid, groupId),
    deleteGroupStorage(request.auth.uid, groupId),
  ])
  if (!accessCodes.empty) {
    const batch = adminDb.batch()
    accessCodes.docs.forEach((entry) => batch.delete(entry.ref))
    await batch.commit()
  }
  await adminDb.recursiveDelete(groupReference)
  return {
    studentIds: students.docs.map((student) => student.id),
    cleanup: {
      deletedAccounts,
      deletedAccessCodes: accessCodes.size,
      detachedDocuments,
      deletedFiles,
      calendarUpdated,
    },
  }
})

const proxyResponseHeaders = Object.freeze([
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
])

async function relayResponse(upstream, response) {
  response.status(upstream.status)
  for (const header of proxyResponseHeaders) {
    const value = upstream.headers.get(header)
    if (value) response.setHeader(header, value)
  }
  if (upstream.status === 204) {
    response.end()
    return
  }
  response.send(Buffer.from(await upstream.arrayBuffer()))
}

function proxyPath(request, prefix) {
  const originalUrl = request.originalUrl || request.url || ''
  const path = originalUrl.replace(new RegExp(`^${prefix}`), '')
  return path.startsWith('/') ? path : `/${path}`
}

export const compilerProxy = onRequest({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  maxInstances: 2,
  cors: false,
}, async (request, response) => {
  try {
    const authorization = String(request.get('authorization') || '')
    const match = authorization.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      response.status(401).send('Autenticación necesaria')
      return
    }
    const token = await getAuth().verifyIdToken(match[1])
    if (token.role !== 'teacher') {
      response.status(403).send('Acceso reservado al profesorado')
      return
    }
  } catch {
    response.status(401).send('Sesión no válida')
    return
  }
  const path = proxyPath(request, '/compiler-api')
  const allowedMethod = ['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)
  if (!allowedMethod) {
    response.setHeader('Allow', 'GET, POST, PUT, DELETE')
    response.status(405).send('Método no permitido')
    return
  }
  if (!path.startsWith('/v1/')) {
    response.status(404).send('Ruta no encontrada')
    return
  }

  try {
    const headers = {}
    for (const name of ['accept', 'content-type']) {
      const value = request.get(name)
      if (value) headers[name] = value
    }
    const hasBody = !['GET', 'HEAD'].includes(request.method)
    const body = hasBody
      ? (request.rawBody?.length ? request.rawBody : Buffer.from(JSON.stringify(request.body ?? {})))
      : undefined
    const upstream = await fetch(`${compilerOrigin}${path}`, {
      method: request.method,
      headers,
      body,
      signal: AbortSignal.timeout(115_000),
    })
    await relayResponse(upstream, response)
  } catch (error) {
    console.error('Compiler proxy failed', { path, error })
    response.status(error?.name === 'TimeoutError' ? 504 : 502).json({
      status: 'error',
      message: error?.name === 'TimeoutError'
        ? 'El compilador LaTeX ha tardado demasiado en responder.'
        : 'No se ha podido contactar con el compilador LaTeX.',
    })
  }
})

function compilationTarget(exercise, variationIndex = null) {
  if (variationIndex === null) return exercise
  return Array.isArray(exercise.variaciones) ? exercise.variaciones[variationIndex] : null
}

function compilationAssets(exercise = {}) {
  return Object.fromEntries((Array.isArray(exercise.archivos) ? exercise.archivos : [])
    .filter((file) => file?.compilerName && file?.url)
    .map((file) => [file.compilerName, { url: file.url }]))
}

function compilationContext(preambleName, assets) {
  const assetSignature = Object.entries(assets).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify({ preambleName, assets: assetSignature })
}

async function compileExerciseArtifact(artifact, preambleName, assets) {
  const upstream = await fetch(`${compilerOrigin}/v1/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: artifact.compilerCode || codeForCompiler(artifact.code, artifact.profile),
      preamble_name: preambleName,
      assets,
    }),
    signal: AbortSignal.timeout(115_000),
  })
  if (!upstream.ok) {
    const responseText = await upstream.text()
    let details = {}
    try {
      details = JSON.parse(responseText)
    } catch {
      // Algunos errores de infraestructura llegan como texto plano o HTML.
    }
    const compilerDetails = details.log || details.message || responseText.trim()
      || `El compilador ha respondido con HTTP ${upstream.status}.`
    throw new Error(`Vista ${artifact.key}:\n${compilerDetails}`)
  }

  const pdfBuffer = Buffer.from(await upstream.arrayBuffer())
  const pageMetrics = pdfFirstPageMetrics(pdfBuffer)
  const bucket = adminStorage.bucket()
  const file = bucket.file(artifact.storagePath)
  const downloadToken = randomUUID()
  await file.save(pdfBuffer, {
    resumable: false,
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'private, max-age=31536000, immutable',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        sourceHash: artifact.sourceHash,
        ...(pageMetrics ? {
          pageWidth: String(pageMetrics.width),
          pageHeight: String(pageMetrics.height),
          pageAspectRatio: String(pageMetrics.aspectRatio),
        } : {}),
      },
    },
  })
  return {
    storagePath: artifact.storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(artifact.storagePath)}?alt=media&token=${downloadToken}`,
    sourceHash: artifact.sourceHash,
    revision: artifact.revision,
    updatedAt: new Date().toISOString(),
    ...(pageMetrics || {}),
  }
}

function pdfFirstPageMetrics(buffer) {
  const source = buffer.toString('latin1')
  const boxes = [...source.matchAll(/\/(?:CropBox|MediaBox)\s*\[\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s*\]/g)]
  for (const box of boxes) {
    const [, left, bottom, right, top] = box.map(Number)
    const width = Math.abs(right - left)
    const height = Math.abs(top - bottom)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue
    return {
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
      aspectRatio: Math.round((width / height) * 1_000_000) / 1_000_000,
    }
  }
  return null
}

function applyArtifactReferences(target, references) {
  const updated = structuredClone(target)
  if (!updated.pdf || typeof updated.pdf !== 'object') updated.pdf = { statement: null, solved: null }

  for (const [key, reference] of references) {
    if (key === 'pdf.statement') updated.pdf.statement = reference
    else if (key === 'pdf.solved') updated.pdf.solved = reference
    else if (key === 'statement.pdf' && updated.statement) updated.statement.pdf = reference
    else if (key === 'workedSolution.pdf' && updated.workedSolution) updated.workedSolution.pdf = reference
    else {
      const match = key.match(/^parts\.([^.]+)\.(statement|workedSolution)\.pdf$/)
      if (!match) continue
      const part = updated.parts?.find((candidate) => candidate.id === match[1])
      if (part?.[match[2]]) part[match[2]].pdf = reference
    }
  }

  if (!updated.workedSolution?.latex?.trim()) {
    if (updated.workedSolution) updated.workedSolution.pdf = null
  }
  for (const part of updated.parts || []) {
    if (!part.workedSolution?.latex?.trim() && part.workedSolution) part.workedSolution.pdf = null
  }
  const hasSolutions = Boolean(updated.workedSolution?.latex?.trim()
    || (updated.parts || []).some((part) => part.workedSolution?.latex?.trim()))
  if (!hasSolutions) updated.pdf.solved = null
  return updated
}

function pdfStoragePaths(target = {}) {
  const paths = new Set()
  const add = (reference) => {
    if (reference?.storagePath) paths.add(reference.storagePath)
  }
  add(target.pdf?.statement)
  add(target.pdf?.solved)
  add(target.statement?.pdf)
  add(target.answer?.pdf)
  add(target.workedSolution?.pdf)
  for (const part of target.parts || []) {
    add(part.statement?.pdf)
    add(part.answer?.pdf)
    add(part.workedSolution?.pdf)
  }
  return paths
}

async function deleteStoragePaths(paths) {
  const bucket = adminStorage.bucket()
  await Promise.all([...new Set(paths)].map(async (storagePath) => {
    if (!storagePath) return
    try {
      await bucket.file(storagePath).delete({ ignoreNotFound: true })
    } catch (error) {
      console.warn('Exercise PDF cleanup failed', { storagePath, error })
    }
  }))
}

export const saveExerciseThumbnail = onCall({
  region: 'europe-west1',
  timeoutSeconds: 30,
  memory: '256MiB',
  invoker: 'public',
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const exerciseId = String(request.data?.exerciseId || '').trim()
  const sourceUrl = String(request.data?.sourceUrl || '').trim()
  const encodedImage = String(request.data?.imageBase64 || '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(exerciseId) || !sourceUrl || !encodedImage) {
    throw new HttpsError('invalid-argument', 'Faltan datos de la miniatura del ejercicio.')
  }

  const image = Buffer.from(encodedImage, 'base64')
  if (!image.length || image.length > 500_000) {
    throw new HttpsError('invalid-argument', 'La miniatura supera el tamaño permitido.')
  }

  const exerciseReference = adminDb.collection('ejercicios').doc(exerciseId)
  const snapshot = await exerciseReference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', 'El ejercicio no existe.')
  const exercise = snapshot.data() || {}
  const currentSourceUrl = exercise.pdf?.statement?.downloadUrl
    || exercise.pdf?.statement?.url
    || exercise.pdf?.enunciado
    || ''
  if (currentSourceUrl !== sourceUrl) {
    throw new HttpsError('failed-precondition', 'El PDF cambió antes de guardar la miniatura.')
  }

  const storagePath = `ejercicios/${exerciseId}/miniaturas/enunciado_${Date.now()}_${randomUUID()}.webp`
  const downloadToken = randomUUID()
  const bucket = adminStorage.bucket()
  await bucket.file(storagePath).save(image, {
    resumable: false,
    contentType: 'image/webp',
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  })

  const thumbnail = {
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`,
    storagePath,
    sourceUrl,
    width: Math.max(0, Number(request.data?.width) || 0),
    height: Math.max(0, Number(request.data?.height) || 0),
    aspectRatio: Math.max(0, Number(request.data?.aspectRatio) || 0),
    createdAt: new Date().toISOString(),
  }
  const previousPath = exercise.preview?.enunciado?.storagePath
  await exerciseReference.update({ 'preview.enunciado': thumbnail })
  if (previousPath && previousPath !== storagePath) await deleteStoragePaths([previousPath])
  return thumbnail
})

export const queueExerciseCompilation = onCall({
  region: 'europe-west1',
  timeoutSeconds: 30,
  invoker: 'public',
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const exerciseId = String(request.data?.exerciseId || '').trim()
  const rawVariationIndex = request.data?.variationIndex
  const variationIndex = Number.isInteger(rawVariationIndex) && rawVariationIndex >= 0 ? rawVariationIndex : null
  const mode = request.data?.mode === 'full' ? 'full' : 'selective'
  const preambleName = String(request.data?.preambleName || 'ejercicio.tex').trim()
  if (!exerciseId) throw new HttpsError('invalid-argument', 'Falta el identificador del ejercicio.')

  const exerciseReference = adminDb.collection('ejercicios').doc(exerciseId)
  const snapshot = await exerciseReference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', 'El ejercicio no existe.')
  const exercise = snapshot.data()
  const target = compilationTarget(exercise, variationIndex)
  if (!target || Number(target.schemaVersion || exercise.schemaVersion) < 3) {
    throw new HttpsError('failed-precondition', 'El ejercicio todavía no utiliza el modelo estructurado.')
  }

  const revision = Number(target.revision) || 1
  const jobReference = adminDb.collection('compileJobs').doc()
  const now = new Date().toISOString()
  await jobReference.set({
    exerciseId,
    variationIndex,
    revision,
    mode,
    preambleName,
    status: 'queued',
    attempts: 0,
    requestedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
  })

  if (variationIndex === null) {
    await exerciseReference.update({
      'compilation.requestedRevision': revision,
      'compilation.status': 'queued',
      'compilation.requestedAt': now,
      'compilation.error': null,
    })
  } else {
    const variations = [...(exercise.variaciones || [])]
    variations[variationIndex] = {
      ...target,
      compilation: {
        ...(target.compilation || {}),
        requestedRevision: revision,
        status: 'queued',
        requestedAt: now,
        error: null,
      },
    }
    await exerciseReference.update({ variaciones: variations })
  }
  return { jobId: jobReference.id, revision, status: 'queued' }
})

export const processExerciseCompilation = onDocumentCreated({
  document: 'compileJobs/{jobId}',
  region: 'europe-west1',
  timeoutSeconds: 540,
  memory: '1GiB',
  maxInstances: 2,
  retry: false,
}, async (event) => {
  const jobReference = event.data?.ref
  const job = event.data?.data()
  if (!jobReference || !job || job.status !== 'queued') return
  const exerciseReference = adminDb.collection('ejercicios').doc(job.exerciseId)
  const startedAt = new Date().toISOString()
  const uploadedPaths = []
  await jobReference.update({ status: 'compiling', attempts: Number(job.attempts) + 1, startedAt })

  try {
    const exerciseSnapshot = await exerciseReference.get()
    if (!exerciseSnapshot.exists) throw new Error('El ejercicio ya no existe.')
    const exercise = exerciseSnapshot.data()
    const target = compilationTarget(exercise, job.variationIndex)
    if (!target || Number(target.revision) !== Number(job.revision)) {
      await jobReference.update({ status: 'obsolete', completedAt: new Date().toISOString() })
      return
    }

    if (job.variationIndex === null) {
      await exerciseReference.update({ 'compilation.status': 'compiling' })
    }

    const assets = compilationAssets(exercise)
    const context = compilationContext(job.preambleName, assets)
    const artifacts = compilationArtifacts(target, job.exerciseId, job.revision).map((artifact) => {
      const compilerCode = codeForCompiler(artifact.code, artifact.profile)
      return {
        ...artifact,
        compilerCode,
        revision: job.revision,
        sourceHash: sourceHash(compilerCode, context),
      }
    })
    const pendingArtifacts = job.mode === 'full'
      ? artifacts
      : artifacts.filter((artifact) => (
        !artifact.current?.storagePath || artifact.current.sourceHash !== artifact.sourceHash
      ))

    const references = new Map()
    for (const artifact of pendingArtifacts) {
      const reference = await compileExerciseArtifact(artifact, job.preambleName, assets)
      references.set(artifact.key, reference)
      uploadedPaths.push(reference.storagePath)
    }

    let pathsToDelete = []
    const published = await adminDb.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(exerciseReference)
      if (!latestSnapshot.exists) return false
      const latest = latestSnapshot.data()
      const latestTarget = compilationTarget(latest, job.variationIndex)
      if (!latestTarget || Number(latestTarget.revision) !== Number(job.revision)) return false
      const updatedTarget = applyArtifactReferences(latestTarget, references)
      const nextPaths = pdfStoragePaths(updatedTarget)
      pathsToDelete = [
        ...(latestTarget.pendingStorageCleanup || []),
        ...[...pdfStoragePaths(latestTarget)].filter((path) => !nextPaths.has(path)),
      ].filter((path) => !nextPaths.has(path))
      updatedTarget.pendingStorageCleanup = []
      const completedAt = new Date().toISOString()
      if (job.variationIndex === null) {
        transaction.update(exerciseReference, {
          ...updatedTarget,
          compilation: {
            ...(latest.compilation || {}),
            requestedRevision: job.revision,
            readyRevision: job.revision,
            status: 'ready',
            completedAt,
            error: null,
          },
        })
      } else {
        const variations = [...(latest.variaciones || [])]
        variations[job.variationIndex] = {
          ...updatedTarget,
          compilation: {
            ...(updatedTarget.compilation || {}),
            requestedRevision: job.revision,
            readyRevision: job.revision,
            status: 'ready',
            completedAt,
            error: null,
          },
        }
        transaction.update(exerciseReference, { variaciones: variations })
      }
      transaction.update(jobReference, { status: 'ready', completedAt, error: null })
      return true
    })
    if (!published) {
      await deleteStoragePaths(uploadedPaths)
      await jobReference.update({ status: 'obsolete', completedAt: new Date().toISOString() })
      return
    }
    await deleteStoragePaths(pathsToDelete)
  } catch (error) {
    const message = error?.message || 'No se ha podido compilar el ejercicio.'
    console.error('Background exercise compilation failed', { jobId: event.params.jobId, error })
    await deleteStoragePaths(uploadedPaths)
    const completedAt = new Date().toISOString()
    await jobReference.update({ status: 'error', completedAt, error: message })
    if (job.variationIndex === null) {
      const snapshot = await exerciseReference.get()
      if (snapshot.exists && Number(snapshot.data()?.revision) === Number(job.revision)) {
        await exerciseReference.update({
          'compilation.status': 'error',
          'compilation.completedAt': completedAt,
          'compilation.error': message,
        })
      }
    } else {
      const snapshot = await exerciseReference.get()
      if (snapshot.exists) {
        const latest = snapshot.data()
        const variations = [...(latest.variaciones || [])]
        const target = variations[job.variationIndex]
        if (target && Number(target.revision) === Number(job.revision)) {
          variations[job.variationIndex] = {
            ...target,
            compilation: {
              ...(target.compilation || {}),
              status: 'error',
              completedAt,
              error: message,
            },
          }
          await exerciseReference.update({ variaciones: variations })
        }
      }
    }
  }
})

const aiModels = Object.freeze({
  'openai/gpt-5-mini': { reasoningEffort: 'minimal', label: 'GPT-5 Mini' },
  'google/gemini-3-flash-preview': { reasoningEffort: 'minimal', label: 'Gemini 3 Flash' },
  'google/gemini-3.7-flash': { reasoningEffort: 'low', label: 'Gemini 3.7 Flash' },
  'google/gemini-3.8-flash': { reasoningEffort: 'low', label: 'Gemini 3.8 Flash' },
  'openai/gpt-5.6-luna': { reasoningEffort: 'minimal', label: 'GPT-5.6 Luna' },
  'openai/gpt-5.6-terra': { reasoningEffort: 'minimal', label: 'GPT-5.6 Terra' },
  'openai/gpt-5.6-sol': { reasoningEffort: 'minimal', label: 'GPT-5.6 Sol' },
  'openai/gpt-6-astra': { reasoningEffort: 'minimal', label: 'GPT-6 Astra' },
  'anthropic/claude-fable-5.1': { reasoningEffort: 'minimal', label: 'Claude Fable 5.1' },
  'moonshotai/kimi-k3': { reasoningEffort: 'minimal', label: 'Kimi K3' },
})

const variationResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_variation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        enunciado: { type: 'string', minLength: 1, maxLength: 60_000 },
      },
      required: ['enunciado'],
      additionalProperties: false,
    },
  },
}

const solutionResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'solved_exercise',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        enunciado: { type: 'string', minLength: 1, maxLength: 60_000 },
      },
      required: ['enunciado'],
      additionalProperties: false,
    },
  },
}

const exerciseAnalysisResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_variation_strategy',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        core: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        difficulty: { type: 'string' },
        solutionOutline: { type: 'string' },
        transformationPlan: { type: 'string' },
        invariants: { type: 'array', items: { type: 'string' } },
      },
      required: ['core', 'skills', 'difficulty', 'solutionOutline', 'transformationPlan', 'invariants'],
      additionalProperties: false,
    },
  },
}

const rubricAlignmentResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'rubric_curriculum_alignment',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        criterionIds: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
        },
        descriptorEvidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descriptorId: { type: 'string' },
              strength: { type: 'string', enum: ['weak', 'medium', 'strong'] },
            },
            required: ['descriptorId', 'strength'],
            additionalProperties: false,
          },
        },
      },
      required: ['criterionIds', 'descriptorEvidence'],
      additionalProperties: false,
    },
  },
}

const exerciseCompetenciesResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_competency_breakdown',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              segmentId: { type: 'string' },
              achievements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    description: { type: 'string' },
                    points: { type: 'number', minimum: 0 },
                    criterionIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                    descriptorEvidence: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          descriptorId: { type: 'string' },
                          strength: { type: 'string', enum: ['weak', 'medium', 'strong'] },
                        },
                        required: ['descriptorId', 'strength'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['description', 'points', 'criterionIds', 'descriptorEvidence'],
                  additionalProperties: false,
                },
              },
            },
            required: ['segmentId', 'achievements'],
            additionalProperties: false,
          },
        },
      },
      required: ['segments'],
      additionalProperties: false,
    },
  },
}

const documentAchievementSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    points: { type: 'number', minimum: 0 },
    criterionIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    descriptorEvidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          descriptorId: { type: 'string' },
          strength: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['descriptorId', 'strength'],
        additionalProperties: false,
      },
    },
  },
  required: ['description', 'points', 'criterionIds', 'descriptorEvidence'],
  additionalProperties: false,
}

const documentGeneratedPartSchema = {
  type: 'object',
  properties: {
    statement: { type: 'string' },
    answer: { type: 'string' },
    workedSolution: { type: 'string' },
    points: { type: 'number', minimum: 0 },
    durationMinutes: { type: 'number', minimum: 0 },
    contentIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    achievements: { type: 'array', items: documentAchievementSchema },
  },
  required: ['statement', 'answer', 'workedSolution', 'points', 'durationMinutes', 'contentIds', 'achievements'],
  additionalProperties: false,
}

const documentContentResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'neope_document_content',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        beforeExercisesLatex: { type: 'string' },
        generatedExercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              statement: { type: 'string' },
              answer: { type: 'string' },
              workedSolution: { type: 'string' },
              points: { type: 'number', minimum: 0 },
              durationMinutes: { type: 'number', minimum: 0 },
              sourcePage: { type: 'integer', minimum: 1 },
              partsEnvironment: { type: 'string', enum: ['none', 'apartados', 'apartadosc'] },
              parts: { type: 'array', items: documentGeneratedPartSchema },
              info: { type: 'string' },
              contentIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              achievements: { type: 'array', items: documentAchievementSchema },
            },
            required: ['statement', 'answer', 'workedSolution', 'points', 'durationMinutes', 'sourcePage', 'partsEnvironment', 'parts', 'info', 'contentIds', 'achievements'],
            additionalProperties: false,
          },
        },
        alignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceBlockId: { type: 'string' },
              segmentIndex: { type: 'integer', minimum: -1 },
              contentIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              achievements: { type: 'array', items: documentAchievementSchema },
            },
            required: ['sourceBlockId', 'segmentIndex', 'contentIds', 'achievements'],
            additionalProperties: false,
          },
        },
        afterExercisesLatex: { type: 'string' },
      },
      required: ['beforeExercisesLatex', 'generatedExercises', 'alignments', 'afterExercisesLatex'],
      additionalProperties: false,
    },
  },
}

const analysisSystemPrompt = String.raw`Analiza un ejercicio de Matemáticas de Secundaria o Bachillerato diseñado por un profesor. No redactes una variación ni LaTeX: extrae una estrategia de diseño para crear después una variante pedagógicamente sustancial.

Identifica la estructura matemática esencial, las destrezas evaluadas, la dificultad, el esquema de solución y los elementos que deben preservarse. Propón un plan de transformación que cambie de manera estructural el objeto, la restricción, la magnitud, la representación o la pregunta, sin reducir la dificultad ni convertirlo en un simple cambio de datos. El nuevo ejercicio deberá poder resolverse con un esquema de razonamiento comparable, pero no ser clónico del original.

Si recibes un MARCO CURRICULAR OBLIGATORIO, úsalo como límite estricto al analizar la dificultad, los prerrequisitos y el plan de transformación.`

const systemPrompt = String.raw`Eres un profesor de Matemáticas de Secundaria y Bachillerato que redacta ejercicios rigurosos en LaTeX.

Genera UNA variación pedagógicamente sustancial del ejercicio recibido. Debe evaluar los mismos conceptos y destrezas, conservar dificultad y extensión comparables, pero cambiar de manera razonable los datos, el enfoque, la representación o lo que se pide. No te limites a sustituir números.

Si el usuario incluye un MARCO CURRICULAR OBLIGATORIO, respétalo estrictamente: el nuevo ejercicio no puede requerir conocimientos o métodos de cursos posteriores, aunque pudieran simplificar la resolución.

Contrato obligatorio de salida:
- Devuelve exclusivamente el ejercicio LaTeX completo como formato de intercambio con Neope: sin Markdown, sin explicaciones, sin preámbulo y sin \begin{document} ni \end{document}. Neope descompondrá después el resultado en enunciado general, apartados, respuestas, resoluciones e información; no devuelvas JSON, rutas de Storage ni referencias a PDF.
- Conserva la estructura indicada en el contrato que acompaña al ejercicio: \ej, \ap, \info, el entorno de apartados y los demás comandos estructurales presentes. No los conviertas en texto ordinario. Si el contrato fija el contenido de \info, respétalo literalmente.
- Los comandos \M{...}, \P{...}, \p{...}, \T{...} y \t{...} son proyecciones de campos estructurados gestionados por Neope: consérvalos literalmente, en la misma posición y con el mismo valor; no recalcules, redistribuyas ni inventes puntuaciones o tiempos. Conserva también literalmente cada comentario de identidad «% neope:part id=...» y no intercambies esos identificadores entre apartados.
- Ignora por completo los comandos heredados \sol y \lsol: no los copies, no los generes y no añadas \soluciones. Las soluciones solo se conservan si aparecen explícitamente dentro de \begin{solucion} ... \end{solucion}.
- Antes de responder, comprueba mentalmente que todas las variables están definidas, los datos son compatibles y cada apartado tiene respuesta. No modifiques metadatos estructurados para corregir o cuadrar puntuaciones.
- En cualquier solución de geometría vectorial que conserves o generes, no hagas álgebra con puntos: usa vectores posición respecto de un origen, por ejemplo \Vec{OB}=\Vec{OA}+\Vec{AB}, y no B=A+\Vec{AB}.
- Si el ejercicio pide razonar a partir de una gráfica o figura, trata la gráfica como la única fuente de información: no uses ni menciones la expresión analítica, parámetros, coordenadas de control o comandos internos de TikZ/pgfplots, salvo que estén mostrados explícitamente al alumno. Toda afirmación de la solución debe poder inferirse visualmente de la gráfica proporcionada.
- Conserva todas las barras invertidas, equilibra llaves y entornos, y usa & únicamente dentro de pmatrix, matrizp, matrix, array, aligned, align o tabular.
- Si hay un entorno solucion, reescribe una solución completa y correcta para los nuevos datos; si no lo hay, no inventes soluciones.
- Conserva exactamente el entorno de apartados del original, incluido \begin{apartadosc}...\end{apartadosc}. La aplicación generará una copia temporal en una sola columna únicamente al compilar la versión resuelta; no hagas esa sustitución en el código devuelto.
- Las reglas de diseño de 8 cm se aplican SOLO dentro de \begin{solucion}...\end{solucion}; no alteres el enunciado para adaptarte a ellas. En cada solución deja una línea en blanco antes de \begin{solucion}, usa matrizp, detp y sistemap en lugar de matrices estándar, compón las cadenas largas con aligned solo cuando lo necesiten y no pongas dos matrices compactas en una misma fila de aligned. Si la solución incluye una figura, sigue las mismas reglas de composición con TikZ. No uses nunca \begin{center} ni \end{center} dentro de una solución: para centrar un tikzpicture usa \noindent\hfill antes y \hfill\mbox{}\par después. Todo símbolo o comando matemático debe estar dentro de $...$ o de $$...$$; en particular, no escribas \text, \mathrm, \frac, \sqrt, ^, _ ni variables matemáticas en texto normal. Comprueba que cada $ tiene su pareja antes de responder. En problemas de geometría o modelización espacial que describan una construcción, transformación o relación entre figuras, el TikZ explicativo es obligatorio.
- Evita copiar literalmente el enunciado original y las variaciones anteriores.`

const solutionSystemPrompt = String.raw`Eres un profesor de Matemáticas de Secundaria y Bachillerato. Incorpora al ejercicio recibido una solución completa, rigurosa y pedagógica.

Si el usuario incluye un MARCO CURRICULAR OBLIGATORIO, ajusta vocabulario, profundidad y método de resolución a ese curso. No uses técnicas de cursos posteriores cuando exista un procedimiento correcto propio del nivel indicado.

Contrato obligatorio de salida:
- Devuelve exclusivamente el EJERCICIO COMPLETO como formato de intercambio LaTeX con Neope: sin Markdown, sin explicaciones externas, sin preámbulo y sin \begin{document} ni \end{document}. Neope descompondrá después el resultado en campos estructurados; no devuelvas JSON, rutas de Storage ni referencias a PDF.
- Conserva literalmente el enunciado y su estructura. Los comandos \M{...}, \P{...}, \p{...}, \T{...} y \t{...} son proyecciones de campos gestionados por Neope: no cambies sus valores ni su posición. Conserva también literalmente cada comentario «% neope:part id=...». Añade solamente las soluciones y coloca \info al final según la regla indicada por el usuario.
- Ignora por completo \sol, \lsol y \soluciones: no los copies ni los generes.
- Si el ejercicio tiene apartados (\ap), añade exactamente un entorno \begin{solucion} ... \end{solucion} completo después del contenido de CADA apartado y antes del siguiente \ap o del cierre del entorno de apartados original. Si no hay \ap, añade un único entorno \begin{solucion} ... \end{solucion} al final del ejercicio, antes de \info.
- Conserva exactamente \begin{apartadosc}...\end{apartadosc} si aparece en el enunciado. La aplicación sustituirá esos delimitadores solo en la copia temporal destinada a compilar el PDF resuelto; el código fuente devuelto debe mantener el entorno original.
- Aunque haya muchos apartados o cada uno incluya un dibujo TikZ largo, no agrupes las soluciones al final ni omitas ninguna: cuenta los comandos \ap del enunciado y coloca exactamente una solución inmediatamente después de cada uno.
- Deja siempre una línea en blanco real entre el final del enunciado o apartado y cada \begin{solucion}. Es decir, debe haber dos saltos de línea antes de iniciar ese entorno; no basta con una nueva línea sangrada.
- Resuelve todos los apartados con cálculos, justificaciones y resultados correctos. No dejes marcadores pendientes ni afirmaciones sin justificar.
- En geometría vectorial, no hagas álgebra con puntos: nunca escribas B=A+\Vec{AB}. Formula las relaciones con vectores posición respecto de un origen, por ejemplo \Vec{OB}=\Vec{OA}+\Vec{AB}, y distingue con precisión puntos, vectores y coordenadas.
- Cuando el enunciado pida razonar sobre una gráfica o figura, la solución debe usar exclusivamente la información visible para el alumno: no deduzcas ni emplees la fórmula analítica, parámetros, puntos de control o comandos internos de TikZ/pgfplots que aparezcan en el código fuente. Justifica límites, continuidad, crecimiento, valores o tangencias solo a partir de lo que se lee en la gráfica.
- Usa únicamente LaTeX compilable, con llaves y entornos equilibrados. No uses \[ ... \]; para matemáticas destacadas usa siempre $$ ... $$. Todo comando o símbolo matemático (incluidos \text, \mathrm, \frac, \sqrt, ^ y _) debe estar dentro de $...$ o $$...$$; revisa que cada signo $ quede emparejado, también en las etiquetas de TikZ.
- Para matrices, determinantes y sistemas usa SIEMPRE los entornos compactos que ya define la plantilla: \begin{matrizp} ... \end{matrizp}, \begin{detp} ... \end{detp} y \begin{sistemap} ... \end{sistemap}. No uses pmatrix, bmatrix, matrix, vmatrix, Vmatrix, cases ni array para ellos. Para un vector de dos componentes usa \c{a}{b}.
- Actúa también como un diseñador editorial: la columna útil mide 8 cm y debes anticipar la anchura REAL compuesta, no aplicar reglas mecánicas según el número de signos. Antes de responder, revisa visualmente cada bloque matemático y asegúrate de que ninguna fila puede exceder esos 8 cm.
- Usa aligned solo cuando mejore la composición. Divide una cadena de igualdades o implicaciones en filas cuando no quepa con comodidad; entonces mantén una transformación legible por fila, por ejemplo A&=B=\\ &=C=\\ &=D=E, o A&\implies B\implies\\ \implies{}&C\implies D. No dejes nunca líneas en blanco dentro de aligned: cada línea física debe contener una fila matemática o el separador \\. No fragmentes una cadena simbólica corta que sí cabe, como C^6&=C^3\cdot C^3=I.
- No pongas dos matrices, determinantes o sistemas compactos en una misma fila de aligned: incluso compactos, dos 3×3 se salen de la columna. En esos casos usa nombres intermedios y una composición vertical, por ejemplo C^2&=C\cdot C\\ &=\begin{matrizp}...\end{matrizp}. Una fila puede contener como máximo una matriz compacta.
- Cuando un dibujo, esquema geométrico, gráfica, diagrama de árbol o representación visual ayude de forma relevante a justificar o entender la solución, inclúyelo con TikZ. En problemas de geometría o modelización espacial que describan una construcción, transformación o relación entre figuras, es OBLIGATORIO incluir un TikZ explicativo antes de plantear las ecuaciones. Por ejemplo, para una cartulina que se pliega en un cilindro, dibuja de forma compacta el rectángulo y/o el cilindro resultante, etiqueta qué lado es la altura h y qué lado se convierte en la circunferencia 2\pi r. El dibujo debe ser matemáticamente correcto, sobrio y compacto, caber en la columna útil de 8 cm y aportar información: no uses TikZ como mero adorno ni repitas una figura ya suficiente en el enunciado. Importante: no uses \begin{center}, \end{center}, figure ni otros entornos flotantes. Para centrar un dibujo utiliza exactamente \noindent\hfill antes de \begin{tikzpicture} y \hfill\mbox{}\par después de \end{tikzpicture}.
- Usa & únicamente dentro de un entorno de alineación o matriz.`

const alignedEnvironments = new Set([
  'align', 'align*', 'aligned', 'array', 'bmatrix', 'matrix', 'matriz', 'matrizp', 'detp', 'sistemap',
  'pmatrix', 'smallmatrix', 'tabular', 'tabular*', 'vmatrix', 'Vmatrix',
])

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length
}

function choiceContent(choice) {
  const rawContent = choice?.message?.content
  return typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
      : ''
}

const transientOpenRouterStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function openRouterErrorText(payload, status) {
  const message = String(payload?.error?.message || '').trim()
  if (message && !/^provider returned error\.?$/i.test(message)) return message.slice(0, 600)
  if (status === 429) return 'El proveedor está limitando temporalmente las solicitudes.'
  if ([502, 503, 504].includes(status)) return 'El proveedor del modelo no está disponible temporalmente.'
  return message || `OpenRouter ha respondido con HTTP ${status}.`
}

function isTransientOpenRouterError(status, payload) {
  if (transientOpenRouterStatuses.has(status)) return true
  return /provider returned error|deadline|timed?\s*out|temporar|overload|rate.?limit|unavailable/i
    .test(String(payload?.error?.message || ''))
}

async function waitForRetry(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function requestOpenRouterWithRetry({ body, model, deadlineAt, maximumAttempts = 3 }) {
  let lastFailure = null
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const remainingMs = deadlineAt - Date.now()
    if (remainingMs < 5_000) break
    let response
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(remainingMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError') throw error
      lastFailure = {
        status: null,
        message: 'Se ha interrumpido temporalmente la conexión con OpenRouter.',
        provider: null,
        requestId: null,
      }
      console.warn('OpenRouter network request failed', { model, attempt, error: error?.message || error })
      if (attempt === maximumAttempts) break
      const delayMs = attempt === 1 ? 1_500 : 4_000
      if (deadlineAt - Date.now() <= delayMs + 5_000) break
      await waitForRetry(delayMs)
      continue
    }
    const payload = await response.json().catch(() => ({}))
    if (response.ok) return { payload, attempt }

    const transient = isTransientOpenRouterError(response.status, payload)
    lastFailure = {
      status: response.status,
      message: openRouterErrorText(payload, response.status),
      provider: payload?.error?.metadata?.provider_name || payload?.provider || null,
      requestId: response.headers.get('x-request-id') || null,
    }
    console.warn('OpenRouter request rejected', {
      model,
      attempt,
      transient,
      ...lastFailure,
    })
    if (!transient || attempt === maximumAttempts) break
    const delayMs = attempt === 1 ? 1_500 : 4_000
    if (deadlineAt - Date.now() <= delayMs + 5_000) break
    await waitForRetry(delayMs)
  }

  throw new HttpsError(
    'unavailable',
    `Fallo temporal de ${aiModels[model]?.label || model} en OpenRouter tras varios intentos. ${lastFailure?.message || 'Vuelve a intentarlo dentro de unos instantes.'}`,
    {
      provider: lastFailure?.provider,
      status: lastFailure?.status,
      requestId: lastFailure?.requestId,
    },
  )
}

function stripLegacySolutionCommands(text) {
  const commandPattern = /\\(?:sol|lsol)\s*\{/g
  let result = ''
  let cursor = 0

  for (const match of text.matchAll(commandPattern)) {
    const openingBrace = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let end = openingBrace + 1
    for (; end < text.length && depth > 0; end += 1) {
      if (text[end] === '{') depth += 1
      if (text[end] === '}') depth -= 1
    }
    if (depth !== 0) break
    result += text.slice(cursor, match.index)
    cursor = end
  }

  return `${result}${text.slice(cursor)}`.replace(/\n{3,}/g, '\n\n').trim()
}

function removeBlankLinesInsideAligned(text) {
  return text.replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => (
    `\\begin{aligned}${body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')}\\end{aligned}`
  ))
}

function compactAlignedChains(text) {
  return removeBlankLinesInsideAligned(text).replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => {
    const normalizedBody = body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')
    const rows = splitAlignedRows(normalizedBody).flatMap((row) => {
      const equalityCount = countMatches(row, /=/g)
      const equalityMatch = equalityCount > 2 && row.length > 72 && row.match(/^([\s\S]*?&\s*=\s*)([\s\S]*)$/)
      if (equalityMatch) {
        const terms = equalityMatch[2].split('=').map((term) => term.trim()).filter(Boolean)
        if (terms.length >= 3) {
          const formatted = [`${equalityMatch[1]}${terms[0]}=`]
          for (let index = 1; index < terms.length - 2; index += 1) formatted.push(`&=${terms[index]}=`)
          formatted.push(`&=${terms.at(-2)}=${terms.at(-1)}`)
          return formatted
        }
      }

      const implicationCount = countMatches(row, /\\implies\b/g)
      const implicationMatch = implicationCount > 2 && row.length > 72 && row.match(/^([\s\S]*?&\s*\\implies\s*)([\s\S]*)$/)
      if (implicationMatch) {
        const terms = implicationMatch[2].split(/\\implies\b/).map((term) => term.trim()).filter(Boolean)
        if (terms.length >= 3) {
          const formatted = [`${implicationMatch[1]}${terms[0]} \\implies`]
          for (let index = 1; index < terms.length - 2; index += 1) formatted.push(`\\implies{}&${terms[index]} \\implies`)
          formatted.push(`\\implies{}&${terms.at(-2)} \\implies ${terms.at(-1)}`)
          return formatted
        }
      }

      return [row]
    })
    return `\\begin{aligned}${rows.join('\\\\\n')}\\end{aligned}`
  })
}

function infoContent(text) {
  const match = text.match(/\\info\s*\{([^{}]*)\}/)
  return match?.[1]?.trim() || ''
}

function scoreMetadata(text) {
  return [...String(text || '').matchAll(/\\(M|P|p|T|t)\s*\{([^{}]*)\}/g)]
    .map((match) => `${match[1]}:${match[2].trim()}`)
}

function partMarkerIds(text) {
  return [...String(text || '').matchAll(/^[ \t]*%[ \t]*neope:part[ \t]+id=([A-Za-z0-9_-]+)/gm)]
    .map((match) => match[1])
}

function validateLatexVariation(original, variation, expectedInfo = '') {
  const issues = []
  const requiredPatterns = [
    ['\\ej', /\\ej\b/g],
    ['\\M', /\\M\s*\{/g],
    ['\\T', /\\T\s*\{/g],
    ['\\ap', /\\ap\b/g],
    ['\\p', /\\p\s*\{/g],
    ['\\t', /\\t\s*\{/g],
    ['\\info', /\\info\s*\{/g],
    ['apartados', /\\begin\s*\{apartados\}/g],
    ['apartadosc', /\\begin\s*\{apartadosc\}/g],
    ['solucion', /\\begin\s*\{solucion\}/g],
  ]

  for (const [label, pattern] of requiredPatterns) {
    const originalCount = countMatches(original, pattern)
    if (!originalCount) continue
    const variationCount = countMatches(variation, pattern)
    if (variationCount !== originalCount) {
      issues.push(`Debe conservar ${originalCount} aparición(es) de ${label}; contiene ${variationCount}.`)
    }
  }

  const originalScores = scoreMetadata(original)
  const generatedScores = scoreMetadata(variation)
  if (originalScores.join('|') !== generatedScores.join('|')) {
    issues.push('Debe conservar literalmente y en el mismo orden los valores de puntuación y tiempo gestionados por Neope.')
  }

  const originalPartIds = partMarkerIds(original)
  const generatedPartIds = partMarkerIds(variation)
  if (originalPartIds.join('|') !== generatedPartIds.join('|')) {
    issues.push('Debe conservar literalmente los identificadores % neope:part de cada apartado.')
  }

  if (expectedInfo && countMatches(original, /\\info\s*\{/g) && !variation.includes(`\\info{${expectedInfo}}`)) {
    issues.push(`El contenido de \\info debe ser exactamente "${expectedInfo}".`)
  }

  const originalSolutionEnvironments = [...original.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  if (originalSolutionEnvironments.length) {
    const generatedSolutionEnvironments = [...variation.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
    if (generatedSolutionEnvironments.some((match) => !match[1].trim())) {
      issues.push('Los entornos solucion no pueden estar vacíos.')
    }
  }

  const environmentStack = []
  const tokenPattern = /\\(begin|end)\s*\{([^}]+)\}/g
  for (const match of variation.matchAll(tokenPattern)) {
    if (match[1] === 'begin') {
      environmentStack.push(match[2])
    } else if (match[1] === 'end') {
      const openEnvironment = environmentStack.pop()
      if (openEnvironment !== match[2]) {
        issues.push(`Entornos desordenados: se cierra ${match[2]} pero estaba abierto ${openEnvironment || 'ninguno'}.`)
        break
      }
    }
  }
  if (environmentStack.length) issues.push(`Falta cerrar el entorno ${environmentStack.at(-1)}.`)

  let braceDepth = 0
  for (let index = 0; index < variation.length; index += 1) {
    const character = variation[index]
    if (character !== '{' && character !== '}') continue
    let slashCount = 0
    for (let cursor = index - 1; cursor >= 0 && variation[cursor] === '\\'; cursor -= 1) slashCount += 1
    if (slashCount % 2) continue
    braceDepth += character === '{' ? 1 : -1
    if (braceDepth < 0) break
  }
  if (braceDepth !== 0) issues.push('Las llaves no están equilibradas.')

  return [...new Set(issues)]
}

function validateSolvedExercise(original, solvedExercise, expectedInfo) {
  const issues = validateLatexVariation(original, solvedExercise, expectedInfo)
  const partCount = countMatches(original, /\\ap\b/g)
  const solutionCount = countMatches(solvedExercise, /\\begin\s*\{solucion\}/g)

  if (partCount ? solutionCount !== partCount : solutionCount !== 1) {
    issues.push(partCount
      ? `Debe haber una solución por apartado (${partCount}); hay ${solutionCount}.`
      : `El ejercicio debe contener un único entorno solucion; hay ${solutionCount}.`)
  }
  if (countMatches(solvedExercise, /\\info\s*\{/g) !== 1) {
    issues.push('El ejercicio resuelto debe contener una única orden \\info.')
  }
  if (partCount) {
    const solvedParts = [...solvedExercise.matchAll(/\\ap\b([\s\S]*?)(?=\\ap\b|\\end\s*\{apartadosc?\})/g)]
    if (solvedParts.length !== partCount || solvedParts.some((part) => !/\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/.test(part[1]))) {
      issues.push('Cada apartado debe contener su propio entorno solucion antes del siguiente apartado.')
    }
  }
  if (hasLegacyDisplayMathDelimiters(solvedExercise)) {
    issues.push('Usa $$ ... $$ en lugar de \\[ ... \\].')
  }
  const generatedSolutions = [...solvedExercise.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  const missingSolutionSpacing = [...solvedExercise.matchAll(/\\begin\s*\{solucion\}/g)].some((solution) => (
    !/\n[ \t]*\n[ \t]*$/.test(solvedExercise.slice(0, solution.index))
  ))
  if (missingSolutionSpacing) {
    issues.push('Debe haber una línea en blanco antes de cada entorno solucion.')
  }
  const standardMatrix = /\\begin\s*\{(?:pmatrix|bmatrix|matrix|vmatrix|Vmatrix|cases)\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (standardMatrix) {
    issues.push('Las soluciones deben usar matrizp, detp o sistemap en lugar de matrices estándar.')
  }
  const overloadedMatrixRow = generatedSolutions.some((solution) => (
    [...solution[1].matchAll(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g)].some((aligned) => (
      splitAlignedRows(aligned[1]).some((row) => countMatches(row, /\\begin\s*\{(?:matrizp|detp|sistemap)\}/g) > 1)
    ))
  ))
  if (overloadedMatrixRow) {
    issues.push('Una fila de aligned no puede contener dos matrices o determinantes compactos.')
  }
  if (!hasTrailingInfoCommand(solvedExercise, expectedInfo)) {
    issues.push('\\info debe ser el último comando del ejercicio.')
  }

  return [...new Set(issues)]
}

function validateSolutionLayout(fragment) {
  const issues = []
  const generatedSolutions = [...fragment.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  if (!generatedSolutions.length) return issues

  const missingSolutionSpacing = [...fragment.matchAll(/\\begin\s*\{solucion\}/g)].some((solution) => (
    !/\n[ \t]*\n[ \t]*$/.test(fragment.slice(0, solution.index))
  ))
  if (missingSolutionSpacing) issues.push('Debe haber una línea en blanco antes de cada entorno solucion.')

  const standardMatrix = /\\begin\s*\{(?:pmatrix|bmatrix|matrix|vmatrix|Vmatrix|cases)\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (standardMatrix) issues.push('Las soluciones deben usar matrizp, detp o sistemap en lugar de matrices estándar.')

  const centerEnvironment = /\\(?:begin|end)\s*\{center\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (centerEnvironment) issues.push('No se puede usar el entorno center dentro de una solución.')

  const overloadedMatrixRow = generatedSolutions.some((solution) => (
    [...solution[1].matchAll(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g)].some((aligned) => (
      splitAlignedRows(aligned[1]).some((row) => countMatches(row, /\\begin\s*\{(?:matrizp|detp|sistemap)\}/g) > 1)
    ))
  ))
  if (overloadedMatrixRow) issues.push('Una fila de aligned no puede contener dos matrices o determinantes compactos.')

  const unescapedDollars = (fragment.replace(/\\\$/g, '').match(/\$/g) || []).length
  if (unescapedDollars % 2 !== 0) issues.push('Todos los delimitadores $ de modo matemático deben estar emparejados.')

  return issues
}

export const generateExerciseVariation = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const startedAt = Date.now()
  const enunciado = typeof request.data?.enunciado === 'string' ? request.data.enunciado.trim() : ''
  const tags = Array.isArray(request.data?.tags) ? request.data.tags.filter((tag) => typeof tag === 'string').slice(0, 40) : []
  const variaciones = Array.isArray(request.data?.variaciones)
    ? request.data.variaciones.filter((variation) => typeof variation === 'string').slice(-8).map(stripLegacySolutionCommands)
    : []
  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  const experimental = request.data?.experimental === true
  const curriculumContext = curriculumPromptContext(request.data?.curriculum)

  if (!enunciado || enunciado.length > 60_000) {
    throw new HttpsError('invalid-argument', 'El enunciado es obligatorio y no puede superar 60.000 caracteres.')
  }
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }
  const exerciseForGeneration = normalizeDisplayMathDelimiters(stripLegacySolutionCommands(enunciado))
  const modelLabel = aiModels[model].label

  try {
    console.info('OpenRouter variation request started', {
      model,
      inputCharacters: exerciseForGeneration.length,
      previousVariations: variaciones.length,
      curriculumSubjectId: request.data?.curriculum?.subjectId || null,
    })
    const solutionEnvironmentCount = countMatches(exerciseForGeneration, /\\begin\s*\{solucion\}/g)
    const solutionRequirement = solutionEnvironmentCount
      ? `REQUISITO DE SOLUCIONES: conserva y recalcula ${solutionEnvironmentCount} entorno(s) solucion. Ninguna solución puede estar vacía.`
      : 'REQUISITO DE SOLUCIONES: el original no contiene soluciones; no añadas ninguna.'
    const expectedInfo = experimental ? `Variación experimental -- ${modelLabel}` : `Generado por ${modelLabel}`
    const infoRequirement = experimental
      ? `REGLA DE \\info: añade exactamente \\info{${expectedInfo}} como último comando del ejercicio.`
      : countMatches(exerciseForGeneration, /\\info\s*\{/g)
      ? `REGLA DE \\info: escribe exactamente \\info{${expectedInfo}}.`
      : 'REGLA DE \\info: no añadas este comando si el original no lo contiene.'
    const structureSummary = [
      ['\\ej', /\\ej\b/g],
      ['\\M', /\\M\s*\{/g],
      ['\\T', /\\T\s*\{/g],
      ['\\ap', /\\ap\b/g],
      ['\\p', /\\p\s*\{/g],
      ['\\t', /\\t\s*\{/g],
      ['\\info', /\\info\s*\{/g],
      ['apartados', /\\begin\s*\{apartados\}/g],
      ['apartadosc', /\\begin\s*\{apartadosc\}/g],
    ].map(([name, pattern]) => `${name}: ${countMatches(exerciseForGeneration, pattern)}`).join(', ')
    let experimentalStrategy = ''
    if (experimental) {
      console.info('OpenRouter experimental variation analysis started', { model })
      const analysisResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            { role: 'system', content: analysisSystemPrompt },
            { role: 'user', content: [curriculumContext, 'EJERCICIO BASE:', exerciseForGeneration].filter(Boolean).join('\n\n') },
          ],
          response_format: exerciseAnalysisResponseFormat,
          provider: { require_parameters: true, data_collection: 'deny' },
          max_tokens: 1_500,
        }),
        signal: AbortSignal.timeout(Math.max(1, 40_000 - (Date.now() - startedAt))),
      })
      const analysisPayload = await analysisResponse.json().catch(() => ({}))
      const analysisContent = analysisResponse.ok ? choiceContent(analysisPayload.choices?.[0]) : ''
      if (!analysisContent) {
        throw new HttpsError('unavailable', analysisPayload.error?.message || 'La IA no ha podido analizar el ejercicio base.')
      }
      const analysis = JSON.parse(analysisContent)
      experimentalStrategy = `ANÁLISIS DIDÁCTICO DEL EJERCICIO BASE:\n- Núcleo: ${analysis.core}\n- Destrezas: ${analysis.skills.join('; ')}\n- Dificultad: ${analysis.difficulty}\n- Esquema de solución: ${analysis.solutionOutline}\n- Elementos que deben mantenerse: ${analysis.invariants.join('; ')}\n\nPLAN OBLIGATORIO DE TRANSFORMACIÓN ESTRUCTURAL:\n${analysis.transformationPlan}\n\nNo hagas un cambio cosmético ni solo numérico. Aplica ese plan y comprueba que el resultado sea claramente distinto al original, pero de dificultad y extensión comparables.`
    }
    const originalRequest = [
      curriculumContext,
      `ETIQUETAS: ${tags.length ? tags.join(', ') : 'sin etiquetas'}`,
      `CONTRATO DE ESTRUCTURA: ${structureSummary}. Conserva exactamente esas cantidades cuando sean mayores que cero.`,
      solutionRequirement,
      infoRequirement,
      experimentalStrategy,
      'EJERCICIO ORIGINAL:',
      exerciseForGeneration,
      variaciones.length ? `VARIACIONES YA EXISTENTES (no repetir):\n${variaciones.join('\n\n---\n\n')}` : '',
    ].filter(Boolean).join('\n\n')
    let variation = null
    let validationIssues = []

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const repairRequest = attempt === 2
        ? String.raw`CORRIGE EL SIGUIENTE BORRADOR. No simplifiques ni elimines comandos LaTeX.

PROBLEMAS DETECTADOS:
${validationIssues.join('\n')}

BORRADOR INVÁLIDO:
${variation?.enunciado || ''}`
        : ''
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [originalRequest, repairRequest].filter(Boolean).join('\n\n') },
          ],
          response_format: variationResponseFormat,
          provider: {
            require_parameters: true,
            data_collection: 'deny',
          },
          max_tokens: 6_000,
        }),
        signal: AbortSignal.timeout(Math.max(1, 105_000 - (Date.now() - startedAt))),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        console.error('OpenRouter variation request rejected', {
          model,
          attempt,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          providerMessage: payload.error?.message,
        })
        throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
      }

      const choice = payload.choices?.[0]
      const rawContent = choice?.message?.content
      const content = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
          : ''
      variation = content ? JSON.parse(content) : null
      if (!variation?.enunciado?.trim()) {
        console.error('OpenRouter variation response had no usable content', {
          model,
          attempt,
          elapsedMs: Date.now() - startedAt,
          finishReason: choice?.finish_reason,
          contentType: Array.isArray(rawContent) ? 'array' : typeof rawContent,
          reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
          completionTokens: payload.usage?.completion_tokens,
        })
        throw new HttpsError('internal', 'La IA terminó sin generar el ejercicio. Prueba de nuevo o selecciona otro modelo.')
      }

      variation.enunciado = splitOverloadedCompactRows(normalizeDisplayMathDelimiters(compactAlignedChains(stripLegacySolutionCommands(variation.enunciado.trim()))))
      validationIssues = validateLatexVariation(exerciseForGeneration, variation.enunciado, expectedInfo)
      if (experimental && !variation.enunciado.includes(`\\info{${expectedInfo}}`)) {
        validationIssues.push(`La variación experimental debe terminar con \\info{${expectedInfo}}.`)
      }
      if (solutionEnvironmentCount) validationIssues.push(...validateSolutionLayout(variation.enunciado))
      validationIssues = [...new Set(validationIssues)]
      if (!validationIssues.length) break
      console.warn('OpenRouter variation failed LaTeX validation', {
        model,
        attempt,
        elapsedMs: Date.now() - startedAt,
        issues: validationIssues,
      })
    }

    if (validationIssues.length) {
      throw new HttpsError('internal', `La IA no ha conservado la estructura LaTeX: ${validationIssues[0]}`)
    }

    console.info('OpenRouter variation request completed', {
      model,
      elapsedMs: Date.now() - startedAt,
      outputCharacters: variation.enunciado.length,
    })

    return {
      enunciado: variation.enunciado.trim(),
      model,
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') {
      console.error('OpenRouter variation request timed out', { model, elapsedMs: Date.now() - startedAt })
      throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en responder. Prueba de nuevo o selecciona otro modelo.')
    }
    console.error('OpenRouter variation generation failed', { model, elapsedMs: Date.now() - startedAt, error })
    throw new HttpsError('internal', 'No se ha podido generar la variación con IA.')
  }
})

export const generateExerciseSolution = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const startedAt = Date.now()
  const enunciado = typeof request.data?.enunciado === 'string' ? request.data.enunciado.trim() : ''
  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  const previousAttempt = typeof request.data?.previousAttempt === 'string' ? request.data.previousAttempt.trim().slice(0, 60_000) : ''
  const compileError = typeof request.data?.compileError === 'string' ? request.data.compileError.trim().slice(0, 2_000) : ''
  const curriculumContext = curriculumPromptContext(request.data?.curriculum)

  if (!enunciado || enunciado.length > 60_000) {
    throw new HttpsError('invalid-argument', 'El enunciado es obligatorio y no puede superar 60.000 caracteres.')
  }
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }
  if (/\\begin\s*\{solucion\}/.test(enunciado)) {
    throw new HttpsError('failed-precondition', 'Esta variante ya tiene una solución.')
  }

  const exerciseForSolution = normalizeDisplayMathDelimiters(stripLegacySolutionCommands(enunciado))
  const expectedInfo = infoContent(exerciseForSolution) || `Generado por ${aiModels[model].label}`
  try {
    console.info('OpenRouter solution request started', {
      model,
      inputCharacters: exerciseForSolution.length,
      curriculumSubjectId: request.data?.curriculum?.subjectId || null,
    })
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey.value()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neope.web.app',
        'X-Title': 'Neope',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
        messages: [
          { role: 'system', content: solutionSystemPrompt },
          {
            role: 'user',
            content: `${curriculumContext ? `${curriculumContext}\n\n` : ''}REGLA OBLIGATORIA PARA \\info: usa exactamente \\info{${expectedInfo}} y sitúalo como último comando del ejercicio.\n\nEJERCICIO A RESOLVER:\n\n${exerciseForSolution}${previousAttempt ? `\n\nINTENTO ANTERIOR NO COMPILABLE: corrige este intento, conservando el enunciado y su solución matemática, pero reescribiendo el LaTeX defectuoso. No expliques el error; devuelve solamente el ejercicio completo compilable.\nERROR DEL COMPILADOR:\n${compileError || 'Error de sintaxis LaTeX.'}\n\nINTENTO A REPARAR:\n${previousAttempt}` : ''}`,
          },
        ],
        response_format: solutionResponseFormat,
        provider: {
          require_parameters: true,
          data_collection: 'deny',
        },
        max_tokens: 12_000,
      }),
      signal: AbortSignal.timeout(105_000),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('OpenRouter solution request rejected', {
        model,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        providerMessage: payload.error?.message,
      })
      throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
    }

    const content = choiceContent(payload.choices?.[0])
    let solvedExercise = content
      ? splitOverloadedCompactRows(normalizeDisplayMathDelimiters(compactAlignedChains(stripLegacySolutionCommands(JSON.parse(content)?.enunciado?.trim() || ''))))
      : ''
    if (!solvedExercise) {
      throw new HttpsError('internal', 'La IA terminó sin generar el ejercicio resuelto.')
    }
    let latexIssues = [...new Set([
      ...validateSolvedExercise(exerciseForSolution, solvedExercise, expectedInfo),
      ...validateSolutionLayout(solvedExercise),
    ])]
    const needsLayoutRepair = latexIssues.includes('Una fila de aligned no puede contener dos matrices o determinantes compactos.')
      || latexIssues.includes('No se puede usar el entorno center dentro de una solución.')
      || latexIssues.includes('Todos los delimitadores $ de modo matemático deben estar emparejados.')
      || latexIssues.some((issue) => issue.includes('Cada apartado debe contener su propio entorno solucion'))
      || latexIssues.some((issue) => issue.includes('Debe haber una solución por apartado'))
      || latexIssues.some((issue) => issue.includes('Debe conservar') && issue.includes('apartadosc'))
    if (needsLayoutRepair) {
      console.info('OpenRouter solution layout repair started', { model })
      const repairResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            {
              role: 'system',
              content: String.raw`Eres el corrector final y maquetador profesional de ejercicios de Matemáticas. Devuelve el ejercicio LaTeX completo que recibes, preservando literalmente el enunciado, sus datos, dibujos, resultados y la orden final \info.

Corrige también la estructura obligatoria de las soluciones: cuenta los comandos \ap del enunciado y coloca exactamente un entorno \begin{solucion}...\end{solucion} después de cada apartado, antes del siguiente \ap o del cierre del entorno de apartados. No agrupes soluciones al final, no omitas apartados y no dejes un apartado sin solución. Conserva exactamente \begin{apartadosc}...\end{apartadosc} si aparece en el original; la aplicación hará una sustitución temporal solo al compilar el PDF resuelto. Conserva literalmente, en su posición y sin recalcular, todos los comandos \M{...}, \P{...}, \p{...}, \T{...}, \t{...} y comentarios «% neope:part id=...»: son metadatos estructurados gestionados por Neope.

Solo corrige la composición para una columna útil de 8 cm: dentro de aligned nunca pueden aparecer dos matrices, determinantes o sistemas en una misma fila; reescribe los productos largos mediante nombres intermedios y una sola matriz resultado por fila. Conserva los entornos compactos matrizp, detp y sistemap. Dentro de solucion no uses center, figure ni flotantes: si hay tikzpicture, céntralo con \noindent\hfill antes y \hfill\mbox{}\par después. Todo comando matemático debe estar dentro de $...$ o $$...$$ y cada $ debe estar emparejado, también dentro de TikZ. Devuelve solo LaTeX, sin Markdown.`,
            },
            { role: 'user', content: `RECOMPÓN ESTE EJERCICIO. Defectos detectados: ${latexIssues.join(' ')}

EJERCICIO ORIGINAL COMPLETO (fuente de verdad para recuperar cualquier apartado o dibujo que falte):
${exerciseForSolution}

Borrador generado que debes corregir:
${solvedExercise}` },
          ],
          response_format: solutionResponseFormat,
          provider: { require_parameters: true, data_collection: 'deny' },
          max_tokens: 12_000,
        }),
        signal: AbortSignal.timeout(45_000),
      })
      const repairPayload = await repairResponse.json().catch(() => ({}))
      const repairContent = repairResponse.ok ? choiceContent(repairPayload.choices?.[0]) : ''
      const repairedExercise = repairContent
        ? splitOverloadedCompactRows(normalizeDisplayMathDelimiters(compactAlignedChains(stripLegacySolutionCommands(JSON.parse(repairContent)?.enunciado?.trim() || ''))))
        : ''
      if (repairedExercise) {
        solvedExercise = repairedExercise
        latexIssues = [...new Set([
          ...validateSolvedExercise(exerciseForSolution, solvedExercise, expectedInfo),
          ...validateSolutionLayout(solvedExercise),
        ])]
      }
    }
    if (latexIssues.length) {
      throw new HttpsError('internal', `El ejercicio resuelto generado no cumple el formato: ${latexIssues[0]}`)
    }

    console.info('OpenRouter solution request completed', {
      model,
      elapsedMs: Date.now() - startedAt,
      outputCharacters: solvedExercise.length,
    })
    return { enunciado: solvedExercise, model }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') {
      console.error('OpenRouter solution request timed out', { model, elapsedMs: Date.now() - startedAt })
      throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en generar la solución.')
    }
    console.error('OpenRouter solution generation failed', { model, elapsedMs: Date.now() - startedAt, error })
    throw new HttpsError('internal', 'No se ha podido generar la solución con IA.')
  }
})

export const suggestRubricAlignment = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)

  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }

  const text = (value, maximum = 4_000) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  const criteria = (Array.isArray(request.data?.criteria) ? request.data.criteria : []).slice(0, 120).map((criterion) => ({
    id: text(criterion?.id, 120),
    code: text(criterion?.code, 80),
    competenceId: text(criterion?.competenceId, 120),
    description: text(criterion?.description, 2_500),
    descriptorIds: (Array.isArray(criterion?.descriptorIds) ? criterion.descriptorIds : []).slice(0, 30).map((id) => text(id, 120)),
  })).filter((criterion) => criterion.id && criterion.description)
  const competencies = (Array.isArray(request.data?.competencies) ? request.data.competencies : []).slice(0, 40).map((competency) => ({
    id: text(competency?.id, 120),
    code: text(competency?.code, 80),
    description: text(competency?.description || competency?.title, 3_000),
    descriptorIds: (Array.isArray(competency?.descriptorIds) ? competency.descriptorIds : []).slice(0, 30).map((id) => text(id, 120)),
  })).filter((competency) => competency.id)
  const descriptors = (Array.isArray(request.data?.descriptors) ? request.data.descriptors : []).slice(0, 100).map((descriptor) => ({
    id: text(descriptor?.id, 120),
    code: text(descriptor?.code, 80),
    keyCompetencyId: text(descriptor?.keyCompetencyId, 120),
    description: text(descriptor?.description, 2_500),
  })).filter((descriptor) => descriptor.id && descriptor.description)

  const categoryTitle = text(request.data?.categoryTitle, 500)
  const assessmentDefinition = text(request.data?.levelDescription, 8_000)
  if (!categoryTitle || !assessmentDefinition || !criteria.length) {
    throw new HttpsError('invalid-argument', 'La categoría, su definición de puntuación y el catálogo de criterios son obligatorios.')
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey.value()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neope.web.app',
        'X-Title': 'Neope',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
        messages: [
          {
            role: 'system',
            content: 'Eres especialista en evaluación competencial LOMLOE. Vincula una categoría completa de una rúbrica exclusivamente con los identificadores del catálogo legal proporcionado. La categoría puede definirse mediante varios niveles de desempeño con puntuaciones concretas o mediante una horquilla entera. Selecciona solo los criterios que la categoría permite observar realmente. Para cada descriptor operativo relacionado que produzca evidencia, indica weak, medium o strong según la calidad y directitud de esa evidencia. No inventes identificadores, no selecciones por mera afinidad temática y devuelve solo el JSON solicitado.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              context: {
                course: text(request.data?.course, 80),
                subjectId: text(request.data?.subjectId, 120),
                subjectTitle: text(request.data?.subjectTitle, 200),
                rubricTitle: text(request.data?.rubricTitle, 500),
                categoryTitle,
                assessmentDefinition,
                score: request.data?.score || {},
              },
              competencies,
              evaluationCriteria: criteria,
              operationalDescriptors: descriptors,
            }),
          },
        ],
        response_format: rubricAlignmentResponseFormat,
        provider: { require_parameters: true, data_collection: 'deny' },
        max_tokens: 2_500,
      }),
      signal: AbortSignal.timeout(105_000),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
    }
    const content = choiceContent(payload.choices?.[0])
    const suggestion = content ? JSON.parse(content) : null
    if (!suggestion) throw new HttpsError('internal', 'La IA no ha devuelto una vinculación curricular.')

    const allowedCriteria = new Set(criteria.map((criterion) => criterion.id))
    const allowedDescriptors = new Set(descriptors.map((descriptor) => descriptor.id))
    const criterionIds = [...new Set((suggestion.criterionIds || []).filter((id) => allowedCriteria.has(id)))]
    const descriptorEvidence = (suggestion.descriptorEvidence || [])
      .filter((item) => allowedDescriptors.has(item?.descriptorId) && ['weak', 'medium', 'strong'].includes(item?.strength))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.descriptorId === item.descriptorId) === index)

    return { criterionIds, descriptorEvidence, model }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en proponer la vinculación curricular.')
    console.error('Rubric alignment suggestion failed', { model, error })
    throw new HttpsError('internal', 'No se ha podido generar la vinculación curricular con IA.')
  }
})

export const suggestExerciseCompetencies = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)

  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }

  const cleanText = (value, maximum = 8_000) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  const subjectId = cleanText(request.data?.subjectId, 120)
  const catalog = lomloeMathLaw.subjects?.[subjectId]
  if (!catalog) throw new HttpsError('failed-precondition', 'No hay datos LOMLOE para la asignatura seleccionada.')

  const segments = (Array.isArray(request.data?.segments) ? request.data.segments : [])
    .slice(0, 24)
    .map((segment) => ({
      id: cleanText(segment?.id, 120),
      label: cleanText(segment?.label, 120),
      points: Math.max(0, Math.round((Number(segment?.points) || 0) * 100) / 100),
      statement: cleanText(segment?.statement, 18_000),
      answer: cleanText(segment?.answer, 5_000),
      workedSolution: cleanText(segment?.workedSolution, 20_000),
      contentIds: (Array.isArray(segment?.contentIds) ? segment.contentIds : []).slice(0, 80).map((id) => cleanText(id, 160)).filter(Boolean),
    }))
    .filter((segment) => segment.id && segment.statement && segment.points > 0)
  if (!segments.length) {
    throw new HttpsError('invalid-argument', 'No hay ningún segmento evaluable con enunciado y puntuación.')
  }

  const competencies = (catalog.specificCompetencies || []).map((competency) => ({
    id: competency.id,
    code: competency.code,
    description: competency.description,
    descriptorIds: competency.descriptorIds || [],
  }))
  const criteria = (catalog.evaluationCriteria || []).map((criterion) => ({
    id: criterion.id,
    code: criterion.code,
    competenceId: criterion.competenceId,
    description: criterion.description,
    descriptorIds: criterion.descriptorIds || [],
  }))
  const stage = catalog.stage || (String(request.data?.course || '').includes('BTO') ? 'Bachillerato' : 'ESO')
  const descriptors = (lomloeMathLaw.global?.operationalDescriptors || [])
    .filter((descriptor) => !descriptor.stage || descriptor.stage === stage)
    .map((descriptor) => ({
      id: descriptor.id,
      code: descriptor.code,
      keyCompetencyId: descriptor.keyCompetencyId,
      description: descriptor.description,
    }))

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey.value()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neope.web.app',
        'X-Title': 'Neope',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
        messages: [
          {
            role: 'system',
            content: `Eres especialista en evaluación competencial LOMLOE y diseño de ejercicios de Matemáticas. Descompón la puntuación de cada segmento en logros atómicos: acciones pequeñas, observables, independientes y corregibles. No redactes niveles de desempeño ni criterios genéricos; describe exactamente qué debe demostrar el alumno en ese ejercicio. La suma de los puntos de los logros de cada segmento debe coincidir exactamente con la puntuación del segmento. Usa el enunciado, la respuesta breve, la resolución, el curso y los contenidos como contexto, pero no premies dos veces la misma acción. Vincula cada logro solo con los identificadores legales proporcionados que realmente permita observar. Para cada descriptor operativo relacionado que produzca evidencia, asigna weak, medium o strong según su calidad y directitud. No inventes identificadores. Devuelve todos los segmentos solicitados y únicamente el JSON del esquema.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              context: {
                course: cleanText(request.data?.course, 80),
                subjectId,
                subjectTitle: cleanText(request.data?.subjectTitle, 200) || catalog.subjectTitle,
                curriculum: curriculumPromptContext(request.data?.curriculum),
                completeLatex: cleanText(request.data?.latex, 60_000),
              },
              segments,
              specificCompetencies: competencies,
              evaluationCriteria: criteria,
              operationalDescriptors: descriptors,
            }),
          },
        ],
        response_format: exerciseCompetenciesResponseFormat,
        provider: { require_parameters: true, data_collection: 'deny' },
        max_tokens: 8_000,
      }),
      signal: AbortSignal.timeout(105_000),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
    }
    const content = choiceContent(payload.choices?.[0])
    const suggestion = content ? JSON.parse(content) : null
    if (!suggestion?.segments?.length) throw new HttpsError('internal', 'La IA no ha generado ningún logro evaluable.')

    const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
    const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]))
    const competencyMap = new Map(competencies.map((competency) => [competency.id, competency]))
    const descriptorIds = new Set(descriptors.map((descriptor) => descriptor.id))
    const normalizedSegments = []

    for (const generatedSegment of suggestion.segments) {
      const segment = segmentById.get(generatedSegment?.segmentId)
      if (!segment || normalizedSegments.some((item) => item.segmentId === segment.id)) continue
      let achievements = (Array.isArray(generatedSegment.achievements) ? generatedSegment.achievements : [])
        .slice(0, 10)
        .map((achievement) => {
          const criterionIds = [...new Set((achievement?.criterionIds || []).filter((id) => criterionById.has(id)))]
          const allowedDescriptorIds = new Set(criterionIds.flatMap((criterionId) => {
            const criterion = criterionById.get(criterionId)
            return [
              ...(criterion?.descriptorIds || []),
              ...(competencyMap.get(criterion?.competenceId)?.descriptorIds || []),
            ]
          }))
          const descriptorEvidence = (achievement?.descriptorEvidence || [])
            .filter((evidence) => descriptorIds.has(evidence?.descriptorId)
              && allowedDescriptorIds.has(evidence.descriptorId)
              && ['weak', 'medium', 'strong'].includes(evidence?.strength))
            .filter((evidence, index, values) => values.findIndex((candidate) => candidate.descriptorId === evidence.descriptorId) === index)
          return {
            id: `achievement-${randomUUID()}`,
            description: cleanText(achievement?.description, 1_200),
            points: Math.max(0, Number(achievement?.points) || 0),
            alignment: { criterionIds, descriptorEvidence, source: 'ai', model },
          }
        })
        .filter((achievement) => achievement.description)

      if (!achievements.length) continue
      const rawTotal = achievements.reduce((total, achievement) => total + achievement.points, 0)
      if (rawTotal <= 0) achievements = achievements.map((achievement) => ({ ...achievement, points: 1 }))
      const weightTotal = achievements.reduce((total, achievement) => total + achievement.points, 0)
      let assignedCents = 0
      const targetCents = Math.round(segment.points * 100)
      achievements = achievements.map((achievement, index) => {
        const cents = index === achievements.length - 1
          ? targetCents - assignedCents
          : Math.max(0, Math.round((achievement.points / weightTotal) * targetCents))
        assignedCents += cents
        return { ...achievement, points: Math.max(0, cents) / 100 }
      }).filter((achievement) => achievement.points > 0)
      if (!achievements.length) continue
      const normalizedTotal = achievements.reduce((total, achievement) => total + Math.round(achievement.points * 100), 0)
      if (normalizedTotal !== targetCents) {
        achievements.at(-1).points = Math.max(0, Math.round((achievements.at(-1).points * 100) + targetCents - normalizedTotal) / 100)
      }
      normalizedSegments.push({ segmentId: segment.id, achievements })
    }

    const missingSegments = segments.filter((segment) => !normalizedSegments.some((item) => item.segmentId === segment.id))
    if (missingSegments.length) {
      throw new HttpsError('internal', `La IA no ha desglosado ${missingSegments.map((segment) => segment.label).join(', ')}.`)
    }
    return { segments: normalizedSegments, model }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en desglosar las competencias.')
    console.error('Exercise competency suggestion failed', { model, subjectId, error })
    throw new HttpsError('internal', 'No se ha podido generar el desglose competencial con IA.')
  }
})

function normalizeGeneratedAchievements(achievements, points, law, model) {
  const criterionById = new Map((law.criteria || []).map((item) => [item.id, item]))
  const competencyById = new Map((law.competencies || []).map((item) => [item.id, item]))
  const descriptorIds = new Set((law.descriptors || []).map((item) => item.id))
  let result = (Array.isArray(achievements) ? achievements : []).slice(0, 12).map((achievement) => {
    const criterionIds = [...new Set((achievement?.criterionIds || []).filter((id) => criterionById.has(id)))]
    const allowedDescriptors = new Set(criterionIds.flatMap((criterionId) => {
      const criterion = criterionById.get(criterionId)
      return [...(criterion?.descriptorIds || []), ...(competencyById.get(criterion?.competenceId)?.descriptorIds || [])]
    }))
    return {
      id: `achievement-${randomUUID()}`,
      description: String(achievement?.description || '').trim().slice(0, 1_200),
      points: Math.max(0, Number(achievement?.points) || 0),
      alignment: {
        criterionIds,
        descriptorEvidence: (Array.isArray(achievement?.descriptorEvidence) ? achievement.descriptorEvidence : [])
          .filter((item) => descriptorIds.has(item?.descriptorId)
            && allowedDescriptors.has(item.descriptorId)
            && ['weak', 'medium', 'strong'].includes(item?.strength))
          .filter((item, index, values) => values.findIndex((candidate) => candidate.descriptorId === item.descriptorId) === index),
        source: 'ai',
        model,
      },
    }
  }).filter((item) => item.description)
  const targetCents = Math.max(0, Math.round((Number(points) || 0) * 100))
  if (!targetCents || !result.length) return []
  const rawTotal = result.reduce((sum, item) => sum + item.points, 0)
  if (rawTotal <= 0) result = result.map((item) => ({ ...item, points: 1 }))
  const weight = result.reduce((sum, item) => sum + item.points, 0)
  let assigned = 0
  return result.map((item, index) => {
    const cents = index === result.length - 1
      ? targetCents - assigned
      : Math.max(0, Math.round((item.points / weight) * targetCents))
    assigned += cents
    return { ...item, points: cents / 100 }
  }).filter((item) => item.points > 0)
}

export const generateDocumentContent = onCall({
  region: 'europe-west1',
  timeoutSeconds: 300,
  memory: '1GiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)
  const startedAt = Date.now()
  const clean = (value, maximum = 20_000) => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
  const model = clean(request.data?.model, 120) || 'google/gemini-3-flash-preview'
  if (!Object.hasOwn(aiModels, model)) throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  const mode = request.data?.mode === 'align' ? 'align' : 'generate'
  const sourceType = clean(request.data?.sourceType, 40)
  const course = clean(request.data?.course, 80)
  const subjectId = clean(request.data?.subjectId, 160)
  const catalog = lomloeMathLaw.subjects?.[subjectId]
  if (!catalog) throw new HttpsError('failed-precondition', 'Selecciona un curso y una asignatura con datos LOMLOE antes de generar.')

  const stage = catalog.stage || (course.includes('BTO') ? 'Bachillerato' : 'ESO')
  const law = {
    competencies: (catalog.specificCompetencies || []).map((item) => ({ id: item.id, code: item.code, description: item.description, descriptorIds: item.descriptorIds || [] })),
    criteria: (catalog.evaluationCriteria || []).map((item) => ({ id: item.id, code: item.code, competenceId: item.competenceId, description: item.description, descriptorIds: item.descriptorIds || [] })),
    descriptors: (lomloeMathLaw.global?.operationalDescriptors || [])
      .filter((item) => !item.stage || item.stage === stage)
      .map((item) => ({ id: item.id, code: item.code, keyCompetencyId: item.keyCompetencyId, description: item.description })),
  }
  const concepts = (Array.isArray(request.data?.concepts) ? request.data.concepts : []).slice(0, 240).map((item) => ({
    id: clean(item?.id, 180),
    title: clean(item?.title, 300),
    path: clean(item?.path, 1_000),
    selected: Boolean(item?.selected),
  })).filter((item) => item.id)
  const allowedConceptIds = new Set(concepts.map((item) => item.id))
  const sourceExercises = (Array.isArray(request.data?.exercises) ? request.data.exercises : []).slice(0, 24).map((item) => ({
    sourceBlockId: clean(item?.sourceBlockId, 180),
    latex: clean(item?.latex, 60_000),
    segments: (Array.isArray(item?.segments) ? item.segments : []).slice(0, 24).map((segment) => ({
      segmentIndex: Math.max(-1, Math.floor(Number(segment?.segmentIndex) || 0)),
      points: Math.max(0, Number(segment?.points) || 0),
      statement: clean(segment?.statement, 18_000),
      answer: clean(segment?.answer, 5_000),
      workedSolution: clean(segment?.workedSolution, 24_000),
      contentIds: (Array.isArray(segment?.contentIds) ? segment.contentIds : []).filter((id) => allowedConceptIds.has(id)),
    })),
  })).filter((item) => item.sourceBlockId && item.latex)
  if (mode === 'align' && !sourceExercises.length) throw new HttpsError('invalid-argument', 'No hay ejercicios que analizar.')

  const files = (Array.isArray(request.data?.files) ? request.data.files : []).slice(0, 6).map((file) => ({
    name: clean(file?.name, 240),
    mimeType: clean(file?.mimeType, 120),
    dataUrl: clean(file?.dataUrl, 7_500_000),
  })).filter((file) => /^data:(?:image\/(?:png|jpeg)|application\/pdf);base64,/i.test(file.dataUrl))
  if (files.reduce((sum, file) => sum + file.dataUrl.length, 0) > 7_500_000) {
    throw new HttpsError('invalid-argument', 'Los archivos seleccionados superan el tamaño máximo para analizarlos con IA.')
  }

  const rawLatexCapabilities = request.data?.latexCapabilities && typeof request.data.latexCapabilities === 'object'
    ? request.data.latexCapabilities
    : {}
  const cleanStringList = (values, limit, itemLimit = 120) => [...new Set(
    (Array.isArray(values) ? values : []).slice(0, limit).map((value) => clean(value, itemLimit)).filter(Boolean),
  )]
  const latexCapabilities = {
    packages: cleanStringList(rawLatexCapabilities.packages, 80),
    customCommands: cleanStringList(rawLatexCapabilities.customCommands, 120),
    environments: cleanStringList(rawLatexCapabilities.environments, 80),
    standardConstructs: cleanStringList(rawLatexCapabilities.standardConstructs, 40),
    headerFields: (Array.isArray(rawLatexCapabilities.headerFields) ? rawLatexCapabilities.headerFields : []).slice(0, 30).map((field) => ({
      key: clean(field?.key, 100),
      label: clean(field?.label, 200),
      value: clean(field?.value, 1_000),
    })).filter((field) => field.key || field.label),
    headerInvocations: (Array.isArray(rawLatexCapabilities.headerInvocations) ? rawLatexCapabilities.headerInvocations : []).slice(0, 8).map((header) => ({
      template: clean(header?.template, 200),
      latex: clean(header?.latex, 4_000),
    })).filter((header) => header.latex),
  }
  const imageSourceCount = files.filter((file) => /^image\//i.test(file.mimeType)).length
  const expectedPageCount = files.length > 0 && imageSourceCount === files.length ? imageSourceCount : null

  const task = mode === 'align'
    ? 'No reescribas ni alteres los ejercicios. Devuelve únicamente alignments para todos sus segmentos evaluables, conservando sourceBlockId y segmentIndex.'
    : sourceType === 'curriculum'
      ? 'Diseña un conjunto breve y coherente de ejercicios nuevos que evalúe los conceptos seleccionados, con dificultad adecuada al curso, solución completa, respuestas breves, segmentación y desglose competencial.'
      : 'Reconstruye fielmente el documento aportado como LaTeX editable y ejercicios Neope estructurados. Conserva no solo las preguntas, sino también su estructura visual, instrucciones, tablas de recogida de datos, espacios de respuesta, recuadros, líneas, rejillas, diagramas y dibujos; completa después respuestas, resoluciones, segmentación, contenidos y logros evaluables.'
  const promptPayload = {
    task,
    context: {
      course,
      subjectId,
      subjectTitle: clean(request.data?.subjectTitle, 200) || catalog.subjectTitle,
      sourceType,
      sourceFiles: files.map((file, index) => ({ page: index + 1, name: file.name, mimeType: file.mimeType })),
      expectedPageCount,
      requestedConceptIds: (Array.isArray(request.data?.selectedConceptIds) ? request.data.selectedConceptIds : []).filter((id) => allowedConceptIds.has(id)),
      sourceLatex: clean(request.data?.latex, 100_000),
    },
    sourceExercises,
    concepts,
    latexCapabilities,
    evaluationCriteria: law.criteria,
    operationalDescriptors: law.descriptors,
  }
  const userContent = [{ type: 'text', text: JSON.stringify(promptPayload) }]
  files.forEach((file) => {
    if (file.mimeType === 'application/pdf') {
      userContent.push({ type: 'file', file: { filename: file.name || 'documento.pdf', file_data: file.dataUrl } })
    } else {
      userContent.push({ type: 'image_url', image_url: { url: file.dataUrl } })
    }
  })

  try {
    console.info('Document content generation started', {
      model,
      mode,
      sourceType,
      sourceExerciseCount: sourceExercises.length,
      fileCount: files.length,
      fileCharacters: files.reduce((sum, file) => sum + file.dataUrl.length, 0),
      promptCharacters: JSON.stringify(promptPayload).length,
    })
    const { payload, attempt } = await requestOpenRouterWithRetry({
      model,
      deadlineAt: startedAt + 270_000,
      body: {
        model,
        reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
        messages: [{
          role: 'system',
          content: `Eres un profesor experto en diseño editorial de documentos, ejercicios de Matemáticas y evaluación competencial LOMLOE. Devuelve exclusivamente el JSON solicitado. Cada ejercicio generado debe ser correcto, autosuficiente y apropiado para ${course}.

RECONSTRUCCIÓN VISUAL OBLIGATORIA:
- Antes de redactar, haz internamente un inventario completo y ordenado de todo lo visible en todas las páginas. No omitas elementos porque no sean preguntas matemáticas.
- Reproduce las instrucciones, cuestionarios previos, tablas de recogida de datos, líneas para responder, cajas de trabajo, divisiones internas, rejillas, rectas numéricas, esquemas y dibujos. En una transcripción desde imagen o PDF prima la fidelidad: no conviertas una ficha de trabajo en una simple lista de enunciados.
- latexCapabilities.headerInvocations muestra exactamente las cabeceras que Neope insertará antes de tu contenido. No repitas en beforeExercisesLatex ni en los ejercicios ningún dato ya visible allí: nombre del instituto, asignatura, nivel/curso/grupo, título y fecha. Del documento fotografiado elimina también su antiguo membrete institucional cuando la plantilla ya aporta uno. Esto no autoriza a eliminar instrucciones ni preguntas.
- Puedes omitir un campo para datos personales ya cubierto inequívocamente por la cabecera (por ejemplo, «Nombre y apellidos»). Conserva todas las demás preguntas del cuestionario inicial, aunque sean datos académicos previos.
- Usa cualquier construcción LaTeX declarada en latexCapabilities y también construcciones estándar compatibles: tabular, array, minipage, parbox, makebox, fbox, framebox, rule, hspace, vspace y TikZ. Cuando una figura sea relevante, recréala con TikZ; no la describas con palabras ni insertes la fotografía original como sustituto.
- Reserva en el documento una superficie de respuesta comparable a la del original. Las líneas, cajas y dibujos forman parte del contenido y no deben desaparecer de la versión enunciado.

PAGINACIÓN Y MAQUETACIÓN:
- sourcePage indica la página de origen en la que empieza cada ejercicio. Asígnalo con precisión y en orden no decreciente; Neope introducirá el salto cuando cambie de página. Si un mismo ejercicio atraviesa una página, coloca \\newpage en el punto exacto dentro de su statement o del statement del apartado correspondiente.
- ${expectedPageCount ? `Se han recibido ${expectedPageCount} imágenes de página: el resultado debe ocupar exactamente ${expectedPageCount} páginas y conservar la frontera entre ellas.` : 'Conserva el número y las fronteras de página que puedas identificar en la fuente.'}
- Maqueta de forma conservadora dentro de \\linewidth. La suma de anchuras de columnas, separaciones y márgenes nunca debe excederla. No uses desplazamientos negativos ni superposiciones para forzar el parecido.
- Antes de devolver el JSON, revisa mentalmente cada página para detectar desbordamientos, solapamientos y grandes espacios muertos. Si dos cajas, textos o dibujos no caben holgadamente en horizontal, apílalos verticalmente. Prefiere tabular con columnas p{...}, minipage y TikZ con bounding box explícito antes que coordenadas absolutas frágiles.
- Reparte la altura disponible de manera coherente con el original: conserva espacio suficiente para responder, pero compacta separaciones decorativas si fueran a provocar una página adicional.

CONTRATO DE SEGMENTACIÓN:
- beforeExercisesLatex contiene solo el material situado entre la cabecera de la plantilla y el primer ejercicio: instrucciones, cuestionarios o tablas globales. afterExercisesLatex contiene únicamente material posterior al último ejercicio. En modo align ambos deben ser cadenas vacías.
- beforeExercisesLatex y afterExercisesLatex no pueden contener begin/end document, begin/end ejercicios, ej, ap ni info.
- No incluyas \\ej, \\ap, \\info, \\begin{document} ni entornos estructurales en statement, answer o workedSolution: Neope los añadirá.
- Si hay contenido común a varios apartados, inclúyelo en statement. Incluye en cada parts[i].statement todas las líneas, cajas, diagramas y espacios que pertenecen solo a ese apartado. Esto conserva la segmentación sin perder la maquetación.
- Si hay apartados, usa partsEnvironment apartados o apartadosc. Si no los hay, usa none y parts vacío. La suma de puntos de los apartados debe coincidir con la del ejercicio.

REGLAS MATEMÁTICAS Y DE EVALUACIÓN:
- Usa LaTeX puro, sin Markdown. En matemáticas destacadas usa $$...$$, nunca \\[...\\].
- Escribe directamente todos los caracteres españoles en UTF-8 (á, é, í, ó, ú, ü, ñ, ¿, ¡). No uses formas heredadas como \\'o, \\~n o \\c{c}; hacen el código innecesariamente ilegible.
- aligned no activa el modo matemático: todo bloque \\begin{aligned}...\\end{aligned} debe estar completamente envuelto en $$...$$. Nunca escribas aligned directamente en modo texto ni dentro de center sin esos delimitadores.
- Los logros deben ser observables, atómicos y sumar exactamente los puntos de su segmento. contentIds, criterionIds y descriptorId solo pueden proceder de los catálogos recibidos; no inventes identificadores.
- Mantén las soluciones en un ancho editorial de 8 cm, sin líneas vacías dentro de aligned y usando matrizp, detp y sistemap para matrices, determinantes y sistemas.`,
        }, { role: 'user', content: userContent }],
        response_format: documentContentResponseFormat,
        provider: { require_parameters: true, data_collection: 'deny', allow_fallbacks: true, sort: 'throughput' },
        max_tokens: 20_000,
      },
    })
    const raw = choiceContent(payload.choices?.[0])
    const generated = raw ? JSON.parse(raw) : null
    if (!generated) throw new HttpsError('internal', 'La IA no ha devuelto contenido utilizable.')

    const normalizeGeneratedLatex = (value, maximum) => normalizeLatexTextAccents(
      ensureAlignedInDisplayMath(normalizeDisplayMathDelimiters(
        clean(value, maximum)
          .replace(/^```(?:latex|tex)?\s*/i, '')
          .replace(/\s*```$/i, ''),
      )),
    )
    const normalizeContentIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => allowedConceptIds.has(id)))]
    const normalizeSegment = (segment) => ({
      statement: normalizeGeneratedLatex(segment?.statement, 30_000),
      answer: normalizeGeneratedLatex(segment?.answer, 8_000),
      workedSolution: normalizeGeneratedLatex(segment?.workedSolution, 40_000),
      points: Math.max(0, Math.round((Number(segment?.points) || 0) * 100) / 100),
      durationMinutes: Math.max(0, Math.round(Number(segment?.durationMinutes) || 0)),
      contentIds: normalizeContentIds(segment?.contentIds),
    })
    const generatedExercises = (generated.generatedExercises || []).slice(0, 16).map((exercise) => {
      const normalized = normalizeSegment(exercise)
      const parts = (Array.isArray(exercise?.parts) ? exercise.parts : []).slice(0, 20).map((part) => {
        const item = normalizeSegment(part)
        return { ...item, achievements: normalizeGeneratedAchievements(part?.achievements, item.points, law, model) }
      }).filter((part) => part.statement)
      const points = parts.length ? parts.reduce((sum, part) => sum + part.points, 0) : normalized.points
      return {
        ...normalized,
        points,
        sourcePage: Math.max(1, Math.floor(Number(exercise?.sourcePage) || 1)),
        achievements: parts.length ? [] : normalizeGeneratedAchievements(exercise?.achievements, points, law, model),
        partsEnvironment: parts.length && exercise?.partsEnvironment === 'apartadosc' ? 'apartadosc' : (parts.length ? 'apartados' : 'none'),
        parts,
        info: clean(exercise?.info, 1_000) || `Generado por ${aiModels[model].label}`,
      }
    }).filter((exercise) => exercise.statement)
    const beforeExercisesLatex = mode === 'align'
      ? ''
      : normalizeGeneratedLatex(generated.beforeExercisesLatex, 60_000)
    const afterExercisesLatex = mode === 'align'
      ? ''
      : normalizeGeneratedLatex(generated.afterExercisesLatex, 60_000)
    const alignments = (generated.alignments || []).slice(0, 400).map((alignment) => {
      const source = sourceExercises.find((exercise) => exercise.sourceBlockId === alignment?.sourceBlockId)
      const segment = source?.segments.find((item) => item.segmentIndex === Number(alignment?.segmentIndex))
      if (!source || !segment) return null
      return {
        sourceBlockId: source.sourceBlockId,
        segmentIndex: segment.segmentIndex,
        contentIds: normalizeContentIds(alignment?.contentIds),
        achievements: normalizeGeneratedAchievements(alignment?.achievements, segment.points, law, model),
      }
    }).filter(Boolean)
    if (mode === 'align' && !alignments.length) throw new HttpsError('internal', 'La IA no ha generado el análisis de los ejercicios.')
    if (mode === 'generate' && !generatedExercises.length) throw new HttpsError('internal', 'La IA no ha generado ningún ejercicio.')
    console.info('Document content generation completed', {
      model,
      resolvedModel: payload.model || model,
      provider: payload.provider || null,
      attempt,
      elapsedMs: Date.now() - startedAt,
      generatedExerciseCount: generatedExercises.length,
      alignmentCount: alignments.length,
      beforeExercisesCharacters: beforeExercisesLatex.length,
      afterExercisesCharacters: afterExercisesLatex.length,
    })
    return {
      beforeExercisesLatex,
      generatedExercises,
      alignments,
      afterExercisesLatex,
      model: payload.model || model,
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') {
      console.error('Document content generation timed out', { model, sourceType, elapsedMs: Date.now() - startedAt })
      throw new HttpsError('deadline-exceeded', `La generación con ${aiModels[model].label} ha superado 4 minutos y medio.`)
    }
    console.error('Document content generation failed', { model, sourceType, elapsedMs: Date.now() - startedAt, error })
    throw new HttpsError('internal', 'No se ha podido generar el contenido del documento con IA.')
  }
})

export const syncLomloeCatalog = onCall({
  region: 'europe-west1',
  timeoutSeconds: 60,
  memory: '256MiB',
  enforceAppCheck: true,
}, async (request) => {
  requireTeacherAccess(request)

  const batch = adminDb.batch()
  batch.set(adminDb.doc('law/lomloe'), {
    ...lomloeMathLaw.global,
    catalogVersion: '2022-1',
    updatedAt: new Date(),
  })
  for (const [subjectId, catalog] of Object.entries(lomloeMathLaw.subjects)) {
    batch.set(adminDb.doc(`especialidades/Matemáticas/asignaturas/${subjectId}/law/lomloe`), {
      ...catalog,
      catalogVersion: '2022-1',
      updatedAt: new Date(),
    })
  }
  await batch.commit()

  return {
    subjects: Object.keys(lomloeMathLaw.subjects).length,
    descriptors: lomloeMathLaw.global.operationalDescriptors.length,
    criteria: Object.values(lomloeMathLaw.subjects).reduce((total, catalog) => total + catalog.evaluationCriteria.length, 0),
  }
})
