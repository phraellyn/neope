import { createHash, randomBytes } from 'node:crypto'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const REGION = 'europe-west1'
const ADMIN_EMAIL = 'carlos.s@educa.madrid.org'
const LEGACY_ADMIN_EMAIL = 'carlosanchezcatala@gmail.com'
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000
const STUDENT_CODE_PATTERN = /^[A-HJ-NP-Za-km-z1-9]{6}$/
if (!getApps().length) initializeApp()
const auth = getAuth()
const db = getFirestore()

const callableOptions = { region: REGION, enforceAppCheck: true, cors: true }

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 8 caracteres.')
  }
  if (password.length > 128) {
    throw new HttpsError('invalid-argument', 'La contraseña es demasiado larga.')
  }
}

function assertStudentCode(code) {
  const normalized = String(code || '').trim()
  if (!STUDENT_CODE_PATTERN.test(normalized)) {
    throw new HttpsError('invalid-argument', 'El código de alumno no es válido.')
  }
  return normalized
}

function accessGroupIds(data = {}) {
  return [...new Set([
    ...(Array.isArray(data.groupIds) ? data.groupIds : []),
    data.groupId,
  ].map((groupId) => String(groupId || '').trim()).filter(Boolean))]
}

function publicTeacherInvitation(snapshot) {
  const data = snapshot.data() || {}
  return {
    id: snapshot.id,
    email: data.email || '',
    displayName: data.displayName || '',
    status: data.status || 'pending',
    expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null,
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    acceptedAt: data.acceptedAt?.toDate?.()?.toISOString?.() || null,
  }
}

async function ensureAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.')
  const email = normalizedEmail(request.auth.token.email)
  const isAdmin = request.auth.token.admin === true && request.auth.token.role === 'teacher'
  if (isAdmin) return request.auth.uid
  if (email !== ADMIN_EMAIL || request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Solo el administrador puede realizar esta operación.')
  }
  await auth.setCustomUserClaims(request.auth.uid, { role: 'teacher', admin: true })
  return request.auth.uid
}

async function ensureTeacher(request) {
  if (!request.auth || request.auth.token.role !== 'teacher') {
    throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de profesor.')
  }
  return request.auth.uid
}

async function migrateLegacyTeacher(uid) {
  const teacherReference = db.doc(`teachers/${uid}`)
  const teacherSnapshot = await teacherReference.get()
  if (Number(teacherSnapshot.data()?.authMigration?.schemaVersion) >= 3) return

  let legacyAdmin = null
  try {
    legacyAdmin = await auth.getUserByEmail(LEGACY_ADMIN_EMAIL)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }
  const sourceIds = ['test']
  if (legacyAdmin?.uid && legacyAdmin.uid !== uid) sourceIds.push(legacyAdmin.uid)
  const previousCorporateProfiles = await db.collection('teachers').where('email', '==', ADMIN_EMAIL).get()
  previousCorporateProfiles.docs.forEach((entry) => {
    if (entry.id !== uid) sourceIds.push(entry.id)
  })
  const uniqueSourceIds = [...new Set(sourceIds)]

  let foundLegacyTeacher = false
  for (const sourceId of uniqueSourceIds) {
    const sourceReference = db.doc(`teachers/${sourceId}`)
    const sourceSnapshot = await sourceReference.get()
    if (!sourceSnapshot.exists) continue
    foundLegacyTeacher = true
    await teacherReference.set({
      ...sourceSnapshot.data(),
      email: ADMIN_EMAIL,
      role: 'teacher',
      migratedFrom: sourceId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    const academicYears = await sourceReference.collection('academicYears').get()
    for (let index = 0; index < academicYears.docs.length; index += 400) {
      const batch = db.batch()
      academicYears.docs.slice(index, index + 400).forEach((entry) => {
        batch.set(teacherReference.collection('academicYears').doc(entry.id), entry.data(), { merge: true })
      })
      await batch.commit()
    }
  }
  if (!foundLegacyTeacher && !teacherSnapshot.exists) {
    await teacherReference.set({
      email: ADMIN_EMAIL,
      role: 'teacher',
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  for (const sourceId of uniqueSourceIds) {
    for (const collectionName of ['grupos', 'ejercicios', 'documentos']) {
      const fieldName = collectionName === 'grupos' ? 'teacherId' : 'ownerId'
      const snapshots = await db.collection(collectionName).where(fieldName, '==', sourceId).get()
      for (let index = 0; index < snapshots.docs.length; index += 400) {
        const batch = db.batch()
        snapshots.docs.slice(index, index + 400).forEach((entry) => {
          batch.update(entry.ref, { [fieldName]: uid, updatedAt: FieldValue.serverTimestamp() })
        })
        await batch.commit()
      }
    }
  }

  const groups = await db.collection('grupos').where('teacherId', '==', uid).get()
  for (const group of groups.docs) {
    const students = await group.ref.collection('alumnos').get()
    for (const student of students.docs) {
      if (!STUDENT_CODE_PATTERN.test(student.id)) continue
      await db.doc(`studentAccessCodes/${student.id}`).set({
        code: student.id,
        groupId: group.id,
        groupIds: FieldValue.arrayUnion(group.id),
        teacherId: uid,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  }
  await teacherReference.set({
    authMigration: { schemaVersion: 3, completedAt: FieldValue.serverTimestamp() },
  }, { merge: true })

  if (legacyAdmin?.uid && legacyAdmin.uid !== uid) {
    await auth.setCustomUserClaims(legacyAdmin.uid, { role: 'teacher', admin: false })
    await auth.updateUser(legacyAdmin.uid, { disabled: true })
  }
}

export const bootstrapAdminAccount = onCall(callableOptions, async () => {
  let user
  try {
    user = await auth.getUserByEmail(ADMIN_EMAIL)
    if (!user.emailVerified) {
      user = await auth.updateUser(user.uid, {
        emailVerified: true,
        displayName: 'Carlos Sánchez Catalá',
      })
    }
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
    user = await auth.createUser({
      email: ADMIN_EMAIL,
      emailVerified: true,
      displayName: 'Carlos Sánchez Catalá',
      password: randomBytes(32).toString('base64url'),
    })
  }
  await auth.setCustomUserClaims(user.uid, { role: 'teacher', admin: true })
  await migrateLegacyTeacher(user.uid)
  return { email: ADMIN_EMAIL, ready: true }
})

export const createTeacherInvitation = onCall(callableOptions, async (request) => {
  const adminUid = await ensureAdmin(request)
  const email = normalizedEmail(request.data?.email)
  const displayName = String(request.data?.displayName || '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpsError('invalid-argument', 'Introduce un correo electrónico válido.')
  try {
    await auth.getUserByEmail(email)
    throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo.')
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.code !== 'auth/user-not-found') throw error
  }

  const invitationsForEmail = await db.collection('teacherInvitations').where('email', '==', email).get()
  if (invitationsForEmail.docs.some((entry) => entry.data()?.status === 'pending'
    && entry.data()?.expiresAt?.toMillis?.() > Date.now())) {
    throw new HttpsError('already-exists', 'Ya existe una invitación pendiente para ese correo.')
  }

  const token = randomBytes(32).toString('base64url')
  const reference = db.collection('teacherInvitations').doc()
  await reference.set({
    email,
    displayName,
    tokenHash: sha256(token),
    status: 'pending',
    invitedBy: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  })
  return { id: reference.id, token, email, displayName, expiresInDays: 14 }
})

export const listTeacherInvitations = onCall(callableOptions, async (request) => {
  await ensureAdmin(request)
  const snapshot = await db.collection('teacherInvitations').orderBy('createdAt', 'desc').limit(100).get()
  return { invitations: snapshot.docs.map(publicTeacherInvitation) }
})

export const revokeTeacherInvitation = onCall(callableOptions, async (request) => {
  await ensureAdmin(request)
  const id = String(request.data?.id || '').trim()
  if (!id) throw new HttpsError('invalid-argument', 'Falta la invitación.')
  const reference = db.doc(`teacherInvitations/${id}`)
  const snapshot = await reference.get()
  if (!snapshot.exists) throw new HttpsError('not-found', 'La invitación no existe.')
  if (snapshot.data().status !== 'pending') throw new HttpsError('failed-precondition', 'La invitación ya no está pendiente.')
  await reference.update({ status: 'revoked', revokedAt: FieldValue.serverTimestamp() })
  return { revoked: true }
})

export const inspectTeacherInvitation = onCall(callableOptions, async (request) => {
  const tokenHash = sha256(String(request.data?.token || ''))
  const snapshot = await db.collection('teacherInvitations').where('tokenHash', '==', tokenHash).limit(1).get()
  if (snapshot.empty) throw new HttpsError('not-found', 'La invitación no es válida.')
  const invitation = snapshot.docs[0]
  const data = invitation.data()
  const expired = data.expiresAt?.toMillis?.() <= Date.now()
  return {
    id: invitation.id,
    email: data.email,
    displayName: data.displayName || '',
    status: expired && data.status === 'pending' ? 'expired' : data.status,
  }
})

export const acceptTeacherInvitation = onCall(callableOptions, async (request) => {
  const token = String(request.data?.token || '')
  const password = request.data?.password
  assertPassword(password)
  const invitationQuery = await db.collection('teacherInvitations')
    .where('tokenHash', '==', sha256(token)).limit(1).get()
  if (invitationQuery.empty) throw new HttpsError('not-found', 'La invitación no es válida.')
  const invitation = invitationQuery.docs[0]
  const data = invitation.data()
  if (data.status !== 'pending' || data.expiresAt?.toMillis?.() <= Date.now()) {
    throw new HttpsError('failed-precondition', 'La invitación ha caducado o ya se ha utilizado.')
  }

  let user
  try {
    try {
      const conflictingUser = await auth.getUserByEmail(data.email)
      if (conflictingUser.emailVerified || conflictingUser.customClaims?.role) {
        throw new HttpsError('already-exists', 'Ya existe una cuenta activa con ese correo.')
      }
      await auth.deleteUser(conflictingUser.uid)
    } catch (error) {
      if (error instanceof HttpsError) throw error
      if (error?.code !== 'auth/user-not-found') throw error
    }
    user = await auth.createUser({
      email: data.email,
      password,
      displayName: data.displayName || undefined,
    })
    await auth.setCustomUserClaims(user.uid, { role: 'teacher', admin: false })
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(invitation.ref)
      if (fresh.data()?.status !== 'pending') throw new HttpsError('aborted', 'La invitación ya se ha utilizado.')
      transaction.update(invitation.ref, {
        status: 'accepted',
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedBy: user.uid,
        tokenHash: FieldValue.delete(),
      })
      transaction.set(db.doc(`teachers/${user.uid}`), {
        email: data.email,
        displayName: data.displayName || '',
        role: 'teacher',
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  } catch (error) {
    if (user?.uid) await auth.deleteUser(user.uid).catch(() => {})
    if (error instanceof HttpsError) throw error
    if (error?.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo.')
    throw error
  }
  return { customToken: await auth.createCustomToken(user.uid) }
})

export const syncStudentAccessCodes = onCall(callableOptions, async (request) => {
  const teacherId = await ensureTeacher(request)
  const groupId = String(request.data?.groupId || '').trim()
  const codes = [...new Set((Array.isArray(request.data?.codes) ? request.data.codes : []).map(assertStudentCode))]
  const groupReference = db.doc(`grupos/${groupId}`)
  const references = codes.map((code) => db.doc(`studentAccessCodes/${code}`))

  // Un código identifica a un alumno, no a una matrícula: puede pertenecer a
  // varios grupos del mismo profesor (por ejemplo, Matemáticas y Refuerzo).
  // La reserva sigue siendo exclusiva entre profesores distintos.
  await db.runTransaction(async (transaction) => {
    const group = await transaction.get(groupReference)
    if (!group.exists || group.data()?.teacherId !== teacherId) {
      throw new HttpsError('permission-denied', 'El grupo no pertenece al profesor.')
    }

    const snapshots = []
    for (const reference of references) snapshots.push(await transaction.get(reference))
    for (let index = 0; index < codes.length; index += 1) {
      const snapshot = snapshots[index]
      if (snapshot.exists && snapshot.data()?.teacherId !== teacherId) {
        throw new HttpsError('already-exists', `El código ${codes[index]} ya pertenece a otro alumno.`)
      }
    }

    for (let index = 0; index < codes.length; index += 1) {
      const groupIds = [...new Set([
        ...accessGroupIds(snapshots[index]?.data?.() || {}),
        groupId,
      ])]
      transaction.set(references[index], {
        code: codes[index],
        groupId: groupIds[0],
        groupIds,
        teacherId,
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
  })

  const [legacyExisting, sharedExisting] = await Promise.all([
    db.collection('studentAccessCodes').where('groupId', '==', groupId).get(),
    db.collection('studentAccessCodes').where('groupIds', 'array-contains', groupId).get(),
  ])
  const existing = new Map([...legacyExisting.docs, ...sharedExisting.docs].map((entry) => [entry.id, entry]))
  const wanted = new Set(codes)
  const stale = [...existing.values()].filter((current) => !wanted.has(current.id))
  if (stale.length) {
    const batch = db.batch()
    for (const current of stale) {
      const remainingGroupIds = accessGroupIds(current.data()).filter((id) => id !== groupId)
      batch.set(current.ref, remainingGroupIds.length
        ? {
            groupId: remainingGroupIds[0],
            groupIds: remainingGroupIds,
            active: true,
            updatedAt: FieldValue.serverTimestamp(),
          }
        : {
            groupId: FieldValue.delete(),
            groupIds: [],
            active: false,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
    }
    await batch.commit()
  }
  return { synced: codes.length }
})

export const inspectStudentAccess = onCall(callableOptions, async (request) => {
  const code = assertStudentCode(request.data?.code)
  const snapshot = await db.doc(`studentAccessCodes/${code}`).get()
  if (!snapshot.exists || snapshot.data()?.active !== true) {
    throw new HttpsError('not-found', 'El código no está habilitado por ningún profesor.')
  }
  return { valid: true, claimed: Boolean(snapshot.data()?.authUid) }
})

export const resetStudentAccess = onCall(callableOptions, async (request) => {
  const teacherId = await ensureTeacher(request)
  const groupId = String(request.data?.groupId || '').trim()
  const code = assertStudentCode(request.data?.code)
  const reference = db.doc(`studentAccessCodes/${code}`)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.data()?.teacherId !== teacherId || !accessGroupIds(snapshot.data()).includes(groupId)) {
    throw new HttpsError('permission-denied', 'El código no pertenece a este grupo.')
  }
  const authUid = snapshot.data()?.authUid
  if (authUid) await auth.deleteUser(authUid).catch((error) => {
    if (error?.code !== 'auth/user-not-found') throw error
  })
  await reference.set({
    authUid: FieldValue.delete(),
    claimedAt: FieldValue.delete(),
    resetAt: FieldValue.serverTimestamp(),
    active: true,
  }, { merge: true })
  await Promise.all(accessGroupIds(snapshot.data()).map((linkedGroupId) => (
    db.doc(`grupos/${linkedGroupId}/alumnos/${code}`).set({
      authUid: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  )))
  return { reset: true }
})

export const claimStudentAccount = onCall(callableOptions, async (request) => {
  const code = assertStudentCode(request.data?.code)
  const password = request.data?.password
  assertPassword(password)
  const reference = db.doc(`studentAccessCodes/${code}`)
  const snapshot = await reference.get()
  if (!snapshot.exists || snapshot.data()?.active !== true) {
    throw new HttpsError('not-found', 'El código no está habilitado.')
  }
  if (snapshot.data()?.authUid) throw new HttpsError('already-exists', 'Este código ya tiene contraseña.')

  const email = `student-${sha256(code).slice(0, 32)}@students.neope.invalid`
  let user
  try {
    try {
      const conflictingUser = await auth.getUserByEmail(email)
      if (conflictingUser.customClaims?.role) throw new HttpsError('already-exists', 'Este código ya tiene una cuenta activa.')
      await auth.deleteUser(conflictingUser.uid)
    } catch (error) {
      if (error instanceof HttpsError) throw error
      if (error?.code !== 'auth/user-not-found') throw error
    }
    user = await auth.createUser({ email, password, displayName: code })
    await auth.setCustomUserClaims(user.uid, { role: 'student', studentCode: code })
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(reference)
      if (fresh.data()?.authUid) throw new HttpsError('aborted', 'Este código ya se ha activado.')
      transaction.update(reference, { authUid: user.uid, claimedAt: FieldValue.serverTimestamp() })
      accessGroupIds(fresh.data()).forEach((groupId) => {
        transaction.set(db.doc(`grupos/${groupId}/alumnos/${code}`), {
          authUid: user.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    })
  } catch (error) {
    if (user?.uid) await auth.deleteUser(user.uid).catch(() => {})
    if (error instanceof HttpsError) throw error
    throw error
  }
  return { customToken: await auth.createCustomToken(user.uid) }
})

export const getStudentDashboard = onCall(callableOptions, async (request) => {
  if (!request.auth || request.auth.token.role !== 'student') {
    throw new HttpsError('permission-denied', 'Esta operación requiere una cuenta de alumno.')
  }
  const code = assertStudentCode(request.auth.token.studentCode)
  const access = await db.doc(`studentAccessCodes/${code}`).get()
  if (!access.exists || access.data()?.authUid !== request.auth.uid || access.data()?.active !== true) {
    throw new HttpsError('permission-denied', 'El acceso de este alumno ya no está activo.')
  }
  const groupIds = accessGroupIds(access.data())
  const group = await db.doc(`grupos/${groupIds[0]}`).get()
  const student = await group.ref.collection('alumnos').doc(code).get()
  if (!group.exists || !student.exists) throw new HttpsError('not-found', 'No se han encontrado los datos académicos.')
  const groupData = group.data()
  return {
    code,
    group: {
      id: group.id,
      name: groupData.name || '',
      subject: groupData.subject || '',
      academicYear: groupData.academicYear || '',
      evaluation: groupData.evaluation || { structure: [], weights: {} },
    },
    results: student.data()?.results || {},
  }
})
