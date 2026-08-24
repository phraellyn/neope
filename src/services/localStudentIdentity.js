const DATABASE_NAME = 'neope-private-data'
const DATABASE_VERSION = 2
const IDENTITY_STORE = 'student-identities'
const KEY_STORE = 'crypto-keys'
const IDENTITY_KEY_ID = 'student-identities-v1'
const GLOBAL_IDENTITY_SCOPE = '__teacher-students__'
const DEVELOPMENT_PORTRAIT_SHEET = '/dev-fixtures/student-portraits.png'
const DEVELOPMENT_IDENTITIES = Object.freeze([
  ['ALONSO MARTÍN, Lucía', 'Lucía'],
  ['ÁLVAREZ ROMERO, Daniel', 'Daniel'],
  ['BENÍTEZ SERRANO, Claudia', 'Claudia'],
  ['BLANCO REY, Hugo', 'Hugo'],
  ['CASTRO MOLINA, Irene', 'Irene'],
  ['DELGADO SÁEZ, Marcos', 'Marcos'],
  ['DÍAZ NAVARRO, Alba', 'Alba'],
  ['FERNÁNDEZ PRIETO, Mateo', 'Mateo'],
  ['GARCÍA VEGA, Sara', 'Sara'],
  ['GIL PASCUAL, Pablo', 'Pablo'],
  ['HERRERA CAMPOS, Noa', 'Noa'],
  ['JIMÉNEZ VIDAL, Leo', 'Leo'],
  ['LÓPEZ CRESPO, Elena', 'Elena'],
  ['MARTÍNEZ SOLER, Adrián', 'Adrián'],
  ['MORENO RUIZ, Carla', 'Carla'],
  ['MUÑOZ CABRERA, Álex', 'Álex'],
  ['ORTEGA LEÓN, Marina', 'Marina'],
  ['RAMÍREZ PEÑA, Diego', 'Diego'],
  ['SÁNCHEZ MORA, Aitana', 'Aitana'],
  ['TORRES FUENTES, Nicolás', 'Nicolás'],
])
const DEVELOPMENT_IDENTITIES_4ESO_A = Object.freeze([
  ['AGUILAR NIETO, Valeria', 'Valeria'],
  ['CALVO HERRANZ, Samuel', 'Samuel'],
  ['CANO BLÁZQUEZ, Martina', 'Martina'],
  ['DOMÍNGUEZ LARA, Bruno', 'Bruno'],
  ['ESTEBAN ROLDÁN, Inés', 'Inés'],
  ['FUENTES MATEOS, Mario', 'Mario'],
  ['GARRIDO SANZ, Olivia', 'Olivia'],
  ['IGLESIAS CUÉLLAR, Álvaro', 'Álvaro'],
  ['MÉNDEZ GALÁN, Emma', 'Emma'],
  ['MOLINA CASAS, Lucas', 'Lucas'],
  ['PARRA ROBLES, Jimena', 'Jimena'],
  ['RUBIO PONS, Gael', 'Gael'],
  ['SANTOS VERA, Vega', 'Vega'],
  ['VÁZQUEZ LORENZO, Eric', 'Eric'],
])

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error || new Error('La operación local se ha cancelado.'))
  })
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      let identities
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        identities = database.createObjectStore(IDENTITY_STORE, { keyPath: 'key' })
        identities.createIndex('groupId', 'groupId', { unique: false })
      } else {
        identities = request.transaction.objectStore(IDENTITY_STORE)
      }
      if (!identities.indexNames.contains('studentId')) {
        identities.createIndex('studentId', 'studentId', { unique: false })
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getEncryptionKey(database) {
  const readTransaction = database.transaction(KEY_STORE, 'readonly')
  const stored = await requestResult(readTransaction.objectStore(KEY_STORE).get(IDENTITY_KEY_ID))
  await transactionDone(readTransaction)
  if (stored?.key) return stored.key

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const writeTransaction = database.transaction(KEY_STORE, 'readwrite')
  writeTransaction.objectStore(KEY_STORE).put({ id: IDENTITY_KEY_ID, key, createdAt: new Date().toISOString() })
  await transactionDone(writeTransaction)
  return key
}

function recordKey(groupId, studentId) {
  return `${groupId}:${studentId}`
}

export function studentIdentityGroupIds(group) {
  if (!group) return []
  const classroom = typeof group.aula === 'string' ? group.aula : ''
  const legacyCompositeId = [group.nombre, group.asignatura, classroom, group.color].join('|')
  const legacyObjectClassroomId = [group.nombre, group.asignatura, group.aula, group.color].join('|')
  const legacyIds = Array.isArray(group.legacyIds) ? group.legacyIds : []
  return [...new Set([
    GLOBAL_IDENTITY_SCOPE,
    group.id,
    ...legacyIds,
    legacyCompositeId,
    legacyObjectClassroomId,
  ].filter(Boolean))]
}

async function encryptIdentity(key, identity) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const { id: _studentId, ...privateData } = identity
  // Todo dato identificativo futuro debe permanecer dentro de este payload cifrado.
  const plaintext = encoder.encode(JSON.stringify(privateData))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv, ciphertext }
}

async function decryptIdentity(key, record) {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.ciphertext)
  return JSON.parse(decoder.decode(plaintext))
}

function identityHasValue(value) {
  if (typeof value === 'string') return Boolean(value.trim())
  return value !== undefined && value !== null && value !== false
}

function mergeIdentity(base, candidate) {
  if (!base) return { ...candidate }
  const merged = { ...base }
  Object.entries(candidate || {}).forEach(([field, value]) => {
    if (field === 'id') return
    if (!identityHasValue(merged[field]) && identityHasValue(value)) merged[field] = value
  })
  return merged
}

function identityMapFromList(identities) {
  return identities.reduce((result, identity) => {
    result.set(identity.id, mergeIdentity(result.get(identity.id), identity))
    return result
  }, new Map())
}

function identityHasPersonalData(identity) {
  return ['nombre', 'nombreCorto', 'foto', 'repetidor', 'pendiente', 'nuevo']
    .some((field) => identityHasValue(identity?.[field]))
}

function shuffled(values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000
    const target = Math.floor(random * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

let developmentPortraitSheetPromise

function developmentPortraitSheet() {
  if (!developmentPortraitSheetPromise) {
    developmentPortraitSheetPromise = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('No se ha podido cargar la lámina de retratos ficticios.'))
      image.src = DEVELOPMENT_PORTRAIT_SHEET
    })
  }
  return developmentPortraitSheetPromise
}

async function developmentPortrait(index) {
  const image = await developmentPortraitSheet()
  const columns = 5
  const rows = 4
  const sourceWidth = image.naturalWidth / columns
  const sourceHeight = image.naturalHeight / rows
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 300
  const context = canvas.getContext('2d')
  context.drawImage(
    image,
    (index % columns) * sourceWidth,
    Math.floor(index / columns) * sourceHeight,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/jpeg', 0.82)
}

async function developmentFakeIdentities(studentIds, groupName = '') {
  const source = groupName === '4ºESO A' ? DEVELOPMENT_IDENTITIES_4ESO_A : DEVELOPMENT_IDENTITIES
  const profiles = shuffled(source.map(([nombre, nombreCorto], index) => ({ nombre, nombreCorto, index })))
  const targets = shuffled(studentIds)
  return Promise.all(targets.slice(0, profiles.length).map(async (id, index) => {
    const profile = profiles[index]
    return {
      id,
      nombre: profile.nombre,
      nombreCorto: profile.nombreCorto,
      foto: await developmentPortrait(profile.index),
      repetidor: index === 4 || index === 15,
      pendiente: index === 8,
      nuevo: index === 12 || index === 18,
    }
  }))
}

export async function loadStudentIdentities(groupId) {
  const groupIds = [...new Set((Array.isArray(groupId) ? groupId : [groupId]).filter((value) => value !== undefined && value !== null && value !== ''))]
  const database = await openDatabase()
  try {
    const key = await getEncryptionKey(database)
    const transaction = database.transaction(IDENTITY_STORE, 'readonly')
    const index = transaction.objectStore(IDENTITY_STORE).index('groupId')
    const records = (await Promise.all(groupIds.map((id) => requestResult(index.getAll(id))))).flat()
    await transactionDone(transaction)
    const identities = await Promise.all(records.map(async (record) => ({
      id: record.studentId,
      ...(await decryptIdentity(key, record)),
    })))
    // El ID actual va primero, pero una copia vacía creada durante la migración
    // no debe ocultar los campos personales conservados bajo un alias anterior.
    return identityMapFromList(identities)
  } finally {
    database.close()
  }
}

async function loadStudentIdentitiesByStudentIds(studentIds) {
  const ids = [...new Set(studentIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const idSet = new Set(ids)
  const database = await openDatabase()
  try {
    const key = await getEncryptionKey(database)
    const transaction = database.transaction(IDENTITY_STORE, 'readonly')
    const records = (await requestResult(transaction.objectStore(IDENTITY_STORE).getAll()))
      .map((record) => {
        if (record.studentId) return record
        const studentId = ids.find((id) => String(record.key || '').endsWith(`:${id}`))
        return studentId ? { ...record, studentId } : record
      })
      .filter((record) => idSet.has(record.studentId))
    await transactionDone(transaction)

    // Una identidad puede existir bajo varios IDs históricos de grupo. La
    // copia más reciente es la mejor candidata cuando no conocemos ese alias.
    records.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    const identities = new Map()
    for (const record of records) {
      const identity = {
        id: record.studentId,
        ...(await decryptIdentity(key, record)),
      }
      identities.set(record.studentId, mergeIdentity(identities.get(record.studentId), identity))
    }
    return identities
  } finally {
    database.close()
  }
}

async function deleteStudentIdentityRecordsEverywhere(studentIds) {
  const ids = new Set(studentIds.filter(Boolean))
  if (!ids.size) return
  const database = await openDatabase()
  try {
    const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
    const store = transaction.objectStore(IDENTITY_STORE)
    const records = await requestResult(store.getAll())
    records.forEach((record) => {
      const studentId = record.studentId || [...ids].find((id) => String(record.key || '').endsWith(`:${id}`))
      if (ids.has(studentId)) store.delete(record.key)
    })
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function loadStudentIdentitiesForGroup(group) {
  const groupIds = studentIdentityGroupIds(group)
  if (!groupIds.length) return new Map()
  const knownIdentities = await loadStudentIdentities(groupIds)
  const studentIds = Array.isArray(group?.alumnos) ? group.alumnos.map((student) => student.id) : []
  const currentStudentIds = new Set(studentIds)
  const recoveredIdentities = await loadStudentIdentitiesByStudentIds(studentIds)
  const identities = new Map(recoveredIdentities)
  // Los datos encontrados mediante el ID actual o un alias explícito tienen
  // prioridad sobre la recuperación por código pseudónimo.
  knownIdentities.forEach((identity, id) => identities.set(id, mergeIdentity(identity, identities.get(id))))

  const unassignedStudentIds = studentIds.filter((id) => !identityHasPersonalData(identities.get(id)))
  if (unassignedStudentIds.length) {
    const historicalScopes = groupIds.filter((id) => id !== GLOBAL_IDENTITY_SCOPE && id !== group.id)
    const historicalIdentities = historicalScopes.length ? await loadStudentIdentities(historicalScopes) : new Map()
    const candidates = [...historicalIdentities.values()]
      .reduce((result, identity) => {
        if (!currentStudentIds.has(identity.id) && identityHasPersonalData(identity) && !result.has(identity.id)) {
          result.set(identity.id, identity)
        }
        return result
      }, new Map())
    const available = shuffled([...candidates.values()])
    const targets = shuffled(unassignedStudentIds).slice(0, available.length)
    const remapped = targets.map((studentId, index) => ({ ...available[index], id: studentId }))
    if (remapped.length) {
      await saveStudentIdentities(group.id, remapped)
      await deleteStudentIdentityRecordsEverywhere(available.slice(0, remapped.length).map((identity) => identity.id))
      remapped.forEach((identity) => identities.set(identity.id, identity))
    }
  }

  const stillUnassigned = studentIds.filter((id) => !identityHasPersonalData(identities.get(id)))
  if (import.meta.env.DEV && stillUnassigned.length) {
    const fakeIdentities = await developmentFakeIdentities(stillUnassigned, group?.nombre)
    if (fakeIdentities.length) {
      await saveStudentIdentities(group.id, fakeIdentities)
      fakeIdentities.forEach((identity) => identities.set(identity.id, identity))
    }
  }

  if (group?.id && identities.size) {
    const canonical = await loadStudentIdentities(group.id)
    const changed = [...identities.values()].filter((identity) => {
      const stored = canonical.get(identity.id)
      return !stored || JSON.stringify(stored) !== JSON.stringify(identity)
    })
    if (changed.length) await saveStudentIdentities(group.id, changed)
  }
  return identities
}

export async function saveStudentIdentities(groupId, identities, { preserveEmpty = true } = {}) {
  if (!identities.length) return
  const recovered = await loadStudentIdentitiesByStudentIds(identities.map((identity) => identity.id))
  const safeIdentities = identities.map((identity) => (
    preserveEmpty ? mergeIdentity(identity, recovered.get(identity.id)) : { ...identity }
  ))
  const database = await openDatabase()
  try {
    const key = await getEncryptionKey(database)
    const scopes = [...new Set([GLOBAL_IDENTITY_SCOPE, groupId].filter(Boolean))]
    const encrypted = await Promise.all(scopes.flatMap((scope) => safeIdentities.map(async (identity) => ({
        key: recordKey(scope, identity.id),
        groupId: scope,
        studentId: identity.id,
        ...(await encryptIdentity(key, identity)),
        updatedAt: new Date().toISOString(),
      }))))
    const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
    const store = transaction.objectStore(IDENTITY_STORE)
    encrypted.forEach((record) => store.put(record))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function deleteStudentIdentities(groupId, studentIds) {
  if (!studentIds.length) return
  const database = await openDatabase()
  try {
    const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
    const store = transaction.objectStore(IDENTITY_STORE)
    studentIds.forEach((studentId) => store.delete(recordKey(groupId, studentId)))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

export async function deleteStudentIdentitiesForGroup(group, studentIds) {
  const groupIds = studentIdentityGroupIds(group)
  await Promise.all(groupIds.map((groupId) => deleteStudentIdentities(groupId, studentIds)))
}
