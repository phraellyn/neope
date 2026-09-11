const DATABASE_NAME = 'neope-private-data'
const DATABASE_VERSION = 3
const IDENTITY_STORE = 'student-identities'
const KEY_STORE = 'crypto-keys'
const SETTINGS_STORE = 'settings'
const IDENTITY_KEY_ID = 'student-identities-v1'
const GLOBAL_IDENTITY_SCOPE = '__teacher-students__'
const LINKED_FILE_SETTING_ID = 'student-identities-linked-file-v1'
const TRANSFER_FORMAT = 'neope-private-students'
const TRANSFER_VERSION = 1
const TRANSFER_KDF_ITERATIONS = 310_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function transferKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: TRANSFER_KDF_ITERATIONS,
  }, material, { name: 'AES-GCM', length: 256 }, false, usages)
}

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
    request.onupgradeneeded = (event) => {
      const database = request.result
      const previousVersion = event.oldVersion
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
      if (previousVersion < 3) {
        const cursorRequest = identities.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          if (cursor.value?.groupId === GLOBAL_IDENTITY_SCOPE) cursor.delete()
          cursor.continue()
        }
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
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
  if (Array.isArray(value)) return value.some((entry) => identityHasValue(entry))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([field, entry]) => field !== 'id' && identityHasValue(entry))
  }
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

export async function deleteStudentIdentitiesEverywhere(studentIds) {
  await deleteStudentIdentityRecordsEverywhere(Array.isArray(studentIds) ? studentIds : [])
}

export async function loadStudentIdentitiesForGroup(group) {
  await syncStudentIdentitiesFromLinkedFile().catch(() => false)
  const groupIds = studentIdentityGroupIds(group)
  if (!groupIds.length) return new Map()
  const studentIds = Array.isArray(group?.alumnos) ? group.alumnos.map((student) => student.id) : []
  const studentIdSet = new Set(studentIds)
  const identities = await loadStudentIdentities(groupIds)
  // Nunca se reasigna una ficha a otro código: solo se aceptan coincidencias
  // exactas de grupo (o alias explícito) y código pseudónimo.
  identities.forEach((_identity, id) => {
    if (!studentIdSet.has(id)) identities.delete(id)
  })

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
  const recovered = await loadStudentIdentities(groupId)
  const safeIdentities = identities.map((identity) => (
    preserveEmpty ? mergeIdentity(identity, recovered.get(identity.id)) : { ...identity }
  ))
  const database = await openDatabase()
  try {
    const key = await getEncryptionKey(database)
    const encrypted = await Promise.all(safeIdentities.map(async (identity) => ({
        key: recordKey(groupId, identity.id),
        groupId,
        studentId: identity.id,
        ...(await encryptIdentity(key, identity)),
        updatedAt: new Date().toISOString(),
      })))
    const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
    const store = transaction.objectStore(IDENTITY_STORE)
    encrypted.forEach((record) => store.put(record))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
  scheduleLinkedIdentityFileWrite()
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

function validTransferRecord(record) {
  return record?.groupId
    && record.groupId !== GLOBAL_IDENTITY_SCOPE
    && record?.studentId
    && record?.privateData
    && typeof record.privateData === 'object'
}

function parseTransferBundle(serialized) {
  let bundle
  try {
    bundle = JSON.parse(String(serialized || ''))
  } catch {
    throw new Error('El archivo de datos locales no es válido.')
  }
  if (bundle?.format !== TRANSFER_FORMAT || bundle?.version !== TRANSFER_VERSION) {
    throw new Error('El archivo no pertenece a una versión compatible de Neope.')
  }
  return bundle
}

async function decryptTransferBundle(bundle, key) {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(bundle.cipher?.iv),
        additionalData: encoder.encode(`${TRANSFER_FORMAT}:${TRANSFER_VERSION}`),
      },
      key,
      base64ToBytes(bundle.data),
    )
    return JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new Error('No se ha podido descifrar el archivo. Comprueba la contraseña.')
  }
}

async function localTransferRecords() {
  const database = await openDatabase()
  try {
    const localKey = await getEncryptionKey(database)
    const transaction = database.transaction(IDENTITY_STORE, 'readonly')
    const records = (await requestResult(transaction.objectStore(IDENTITY_STORE).getAll()))
      .filter((record) => record.groupId !== GLOBAL_IDENTITY_SCOPE)
    await transactionDone(transaction)
    return Promise.all(records.map(async (record) => ({
      key: recordKey(record.groupId, record.studentId),
      groupId: record.groupId,
      studentId: record.studentId,
      updatedAt: record.updatedAt || null,
      privateData: await decryptIdentity(localKey, record),
    })))
  } finally {
    database.close()
  }
}

async function serializeTransferBundle(key, salt) {
  const identities = await localTransferRecords()
  const payload = encoder.encode(JSON.stringify({ exportedAt: new Date().toISOString(), identities }))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${TRANSFER_FORMAT}:${TRANSFER_VERSION}`) },
    key,
    payload,
  )
  return JSON.stringify({
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: TRANSFER_KDF_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    data: bytesToBase64(ciphertext),
  }, null, 2)
}

async function importTransferPayload(payload) {
  const identities = Array.isArray(payload?.identities) ? payload.identities.filter(validTransferRecord) : []
  const database = await openDatabase()
  try {
    const localKey = await getEncryptionKey(database)
    const readTransaction = database.transaction(IDENTITY_STORE, 'readonly')
    const store = readTransaction.objectStore(IDENTITY_STORE)
    const currentRecords = await requestResult(store.getAll())
    await transactionDone(readTransaction)
    const currentByKey = new Map(currentRecords.map((record) => [record.key, record]))
    const imported = identities.filter((record) => {
      const current = currentByKey.get(recordKey(record.groupId, record.studentId))
      return !current || String(record.updatedAt || '').localeCompare(String(current.updatedAt || '')) >= 0
    })
    const encrypted = await Promise.all(imported.map(async (record) => ({
      key: recordKey(record.groupId, record.studentId),
      groupId: record.groupId,
      studentId: record.studentId,
      ...(await encryptIdentity(localKey, { id: record.studentId, ...record.privateData })),
      updatedAt: record.updatedAt || new Date().toISOString(),
    })))
    if (encrypted.length) {
      const writeTransaction = database.transaction(IDENTITY_STORE, 'readwrite')
      const writeStore = writeTransaction.objectStore(IDENTITY_STORE)
      encrypted.forEach((record) => writeStore.put(record))
      await transactionDone(writeTransaction)
    }
    return { records: encrypted.length, students: new Set(identities.map((record) => record.studentId)).size }
  } finally {
    database.close()
  }
}

async function linkedFileSetting() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const setting = await requestResult(transaction.objectStore(SETTINGS_STORE).get(LINKED_FILE_SETTING_ID))
    await transactionDone(transaction)
    return setting || null
  } finally {
    database.close()
  }
}

async function saveLinkedFileSetting(setting) {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    transaction.objectStore(SETTINGS_STORE).put({ id: LINKED_FILE_SETTING_ID, ...setting })
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

async function linkedFilePermission(handle, request = false) {
  if (!handle?.queryPermission) return false
  const options = { mode: 'readwrite' }
  if (await handle.queryPermission(options) === 'granted') return true
  return request && await handle.requestPermission(options) === 'granted'
}

let linkedFileWriteTimer = null
let linkedFileOperation = Promise.resolve()

function runLinkedFileOperation(operation) {
  const next = linkedFileOperation.then(operation, operation)
  linkedFileOperation = next.catch(() => {})
  return next
}

async function writeLinkedIdentityFile() {
  return runLinkedFileOperation(async () => {
    const setting = await linkedFileSetting()
    if (!setting?.handle || !setting?.key || !setting?.salt) return false
    if (!await linkedFilePermission(setting.handle)) return false
    const currentContents = await (await setting.handle.getFile()).text()
    if (currentContents.trim()) {
      const currentBundle = parseTransferBundle(currentContents)
      await importTransferPayload(await decryptTransferBundle(currentBundle, setting.key))
    }
    const serialized = await serializeTransferBundle(setting.key, base64ToBytes(setting.salt))
    const writable = await setting.handle.createWritable()
    await writable.write(serialized)
    await writable.close()
    return true
  })
}

function scheduleLinkedIdentityFileWrite() {
  clearTimeout(linkedFileWriteTimer)
  linkedFileWriteTimer = setTimeout(() => {
    linkedFileWriteTimer = null
    writeLinkedIdentityFile().catch(() => {})
  }, 500)
}

/**
 * Crea un archivo portable cifrado con una contraseña de transferencia.
 * El contenido se descifra únicamente en este dispositivo y vuelve a cifrarse
 * antes de salir del navegador; nunca se envía a Firebase.
 */
export async function exportStudentIdentityBundle(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('La contraseña de transferencia debe tener al menos 8 caracteres.')
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await transferKey(passphrase, salt, ['encrypt'])
  return serializeTransferBundle(key, salt)
}

/** Importa un archivo portable y lo cifra de nuevo con la clave local no exportable. */
export async function importStudentIdentityBundle(serialized, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Introduce la contraseña de transferencia.')
  }
  const bundle = parseTransferBundle(serialized)
  const key = await transferKey(passphrase, base64ToBytes(bundle.kdf?.salt), ['decrypt'])
  const result = await importTransferPayload(await decryptTransferBundle(bundle, key))
  scheduleLinkedIdentityFileWrite()
  return result
}

export function supportsLinkedStudentIdentityFile() {
  return typeof globalThis.showSaveFilePicker === 'function'
}

export async function linkedStudentIdentityFileStatus() {
  const setting = await linkedFileSetting()
  if (!setting?.handle) return { supported: supportsLinkedStudentIdentityFile(), linked: false, permission: 'none', name: '' }
  const permission = setting.handle.queryPermission
    ? await setting.handle.queryPermission({ mode: 'readwrite' })
    : 'denied'
  return {
    supported: supportsLinkedStudentIdentityFile(),
    linked: true,
    permission,
    name: setting.name || setting.handle.name || 'datos-alumnos.neope',
  }
}

/**
 * Vincula este origen a un archivo cifrado compartido. Desarrollo y producción
 * pueden elegir el mismo archivo sin compartir IndexedDB ni usar el backend.
 */
export async function linkStudentIdentityFile(handle, passphrase) {
  if (!handle || !await linkedFilePermission(handle, true)) {
    throw new Error('No se ha concedido permiso para utilizar el archivo local.')
  }
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('La contraseña del archivo debe tener al menos 8 caracteres.')
  }
  const file = await handle.getFile()
  const serialized = await file.text()
  let salt
  let key
  if (serialized.trim()) {
    const bundle = parseTransferBundle(serialized)
    salt = base64ToBytes(bundle.kdf?.salt)
    key = await transferKey(passphrase, salt, ['encrypt', 'decrypt'])
    await importTransferPayload(await decryptTransferBundle(bundle, key))
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16))
    key = await transferKey(passphrase, salt, ['encrypt', 'decrypt'])
  }
  await saveLinkedFileSetting({
    handle,
    key,
    salt: bytesToBase64(salt),
    name: handle.name || 'datos-alumnos.neope',
    linkedAt: new Date().toISOString(),
  })
  await writeLinkedIdentityFile()
  return linkedStudentIdentityFileStatus()
}

export async function syncStudentIdentitiesFromLinkedFile({ requestPermission = false } = {}) {
  return runLinkedFileOperation(async () => {
    const setting = await linkedFileSetting()
    if (!setting?.handle || !setting?.key) return false
    if (!await linkedFilePermission(setting.handle, requestPermission)) return false
    const serialized = await (await setting.handle.getFile()).text()
    if (!serialized.trim()) return false
    const bundle = parseTransferBundle(serialized)
    const result = await importTransferPayload(await decryptTransferBundle(bundle, setting.key))
    return result
  })
}

export async function unlinkStudentIdentityFile() {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    transaction.objectStore(SETTINGS_STORE).delete(LINKED_FILE_SETTING_ID)
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

/**
 * Elimina todos los datos personales guardados por este origen. Si hay un
 * archivo compartido vinculado también se vacía, evitando que una recarga los
 * importe de nuevo. No modifica códigos, calificaciones ni ningún dato remoto.
 */
export async function clearAllLocalStudentIdentities() {
  clearTimeout(linkedFileWriteTimer)
  linkedFileWriteTimer = null
  return runLinkedFileOperation(async () => {
    const setting = await linkedFileSetting()
    const database = await openDatabase()
    try {
      const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
      transaction.objectStore(IDENTITY_STORE).clear()
      await transactionDone(transaction)
    } finally {
      database.close()
    }

    let linkedFileCleared = true
    if (setting?.handle && setting?.key && setting?.salt) {
      linkedFileCleared = await linkedFilePermission(setting.handle)
      if (linkedFileCleared) {
        const serialized = await serializeTransferBundle(setting.key, base64ToBytes(setting.salt))
        const writable = await setting.handle.createWritable()
        await writable.write(serialized)
        await writable.close()
      } else {
        await unlinkStudentIdentityFile()
      }
    }
    return { linkedFileCleared }
  })
}
