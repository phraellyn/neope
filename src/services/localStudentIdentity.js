import {
  canonicalStudentIdentityKey,
  decodeIdentityRecords,
  identitiesForExactStudentIds,
  identityRecoveryMessage,
  newestIdentityRecords,
} from '../utils/localIdentityRecovery'
import {
  CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION,
  migrateStudentIdentityEnvelope,
  migrateTransferredStudentIdentity,
  studentIdentityEnvelope,
} from '../utils/localStudentIdentityMigrations'

const DATABASE_NAME = 'neope-private-data'
const MIRROR_DATABASE_NAME = 'neope-private-data-mirror'
const MIRROR_DATABASE_VERSION = 2
const IDENTITY_STORE = 'student-identities'
const KEY_STORE = 'crypto-keys'
const SETTINGS_STORE = 'settings'
const RECOVERY_STORE = 'identity-recovery'
const IDENTITY_KEY_ID = 'student-identities-v1'
const GLOBAL_IDENTITY_SCOPE = '__teacher-students__'
const LINKED_FILE_SETTING_ID = 'student-identities-linked-file-v1'
const HEALTHCHECK_SETTING_ID = 'student-identities-healthcheck'
const TRANSFER_FORMAT = 'neope-private-students'
const TRANSFER_VERSION = 1
const TRANSFER_KDF_ITERATIONS = 310_000
export const LOCAL_IDENTITY_BACKUP_EVENT = 'neope:local-identity-backup-status'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
let lastPublishedBackupError = ''
let localIdentityMutation = Promise.resolve()
let persistenceRequestStarted = false

function runLocalIdentityMutation(operation) {
  const next = localIdentityMutation.then(operation, operation)
  localIdentityMutation = next.catch(() => {})
  return next
}

function requestPersistenceInBackground() {
  if (persistenceRequestStarted || !globalThis.navigator?.storage?.persist) return
  persistenceRequestStarted = true
  navigator.storage.persist().catch(() => false)
}

function publishBackupStatus(detail) {
  if (typeof window === 'undefined') return
  if (detail?.state === 'error') {
    if (detail.message === lastPublishedBackupError) return
    lastPublishedBackupError = detail.message
  } else if (detail?.state === 'saved') {
    lastPublishedBackupError = ''
  }
  window.dispatchEvent(new CustomEvent(LOCAL_IDENTITY_BACKUP_EVENT, { detail }))
}

function publishReplicaFailure(error) {
  publishBackupStatus({
    state: 'error',
    message: `Los datos se han guardado, pero no se ha podido actualizar la réplica local cifrada: ${error?.message || 'error desconocido'}`,
  })
}

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
    // Abrir sin número de versión evita que una lectura ordinaria fuerce una
    // migración del almacén que contiene los datos personales. Esto es
    // especialmente importante en Safari/WebKit, donde una actualización de
    // esquema fallida puede dejar posteriores aperturas en UnknownError.
    // Si la base no existe, IndexedDB crea la versión inicial y ejecuta el
    // mismo inicializador de esquema.
    const request = indexedDB.open(DATABASE_NAME)
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
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
        database.createObjectStore(RECOVERY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      const error = new Error('Otra pestaña mantiene bloqueado el archivo local. Cierra las demás pestañas de Neope y vuelve a intentarlo.')
      error.name = 'BlockedError'
      reject(error)
    }
  })
}

function openMirrorDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MIRROR_DATABASE_NAME, MIRROR_DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        const identities = database.createObjectStore(IDENTITY_STORE, { keyPath: 'key' })
        identities.createIndex('groupId', 'groupId', { unique: false })
        identities.createIndex('studentId', 'studentId', { unique: false })
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
        database.createObjectStore(RECOVERY_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('La réplica local está bloqueada por otra pestaña.'))
  })
}

async function readStoredKey(database) {
  const transaction = database.transaction(KEY_STORE, 'readonly')
  const done = transactionDone(transaction)
  const stored = await requestResult(transaction.objectStore(KEY_STORE).get(IDENTITY_KEY_ID))
  await done
  return stored?.key || null
}

async function writeStoredKey(database, key) {
  const transaction = database.transaction(KEY_STORE, 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(KEY_STORE).put({ id: IDENTITY_KEY_ID, key, updatedAt: new Date().toISOString() })
  await done
}

async function countStoredIdentities(database) {
  const transaction = database.transaction(IDENTITY_STORE, 'readonly')
  const done = transactionDone(transaction)
  const count = await requestResult(transaction.objectStore(IDENTITY_STORE).count())
  await done
  return count
}

async function readIdentityRecords(database, groupIds = null) {
  const transaction = database.transaction(IDENTITY_STORE, 'readonly')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(IDENTITY_STORE)
  let records
  if (!groupIds) {
    records = await requestResult(store.getAll())
  } else if (store.indexNames.contains('groupId')) {
    records = (await Promise.all(groupIds.map((id) => requestResult(store.index('groupId').getAll(id))))).flat()
  } else {
    // Compatibilidad con un esquema local antiguo que no llegase a crear el
    // índice. Leer y filtrar es preferible a perder el acceso a las fichas.
    const allowed = new Set(groupIds)
    records = (await requestResult(store.getAll())).filter((record) => allowed.has(record.groupId))
  }
  await done
  return records
}

async function readIdentityRecordsByStudentIds(database, studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))]
  if (!ids.length) return []
  const transaction = database.transaction(IDENTITY_STORE, 'readonly')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(IDENTITY_STORE)
  let records
  if (store.indexNames.contains('studentId')) {
    records = (await Promise.all(ids.map((id) => requestResult(store.index('studentId').getAll(id))))).flat()
  } else {
    const allowed = new Set(ids)
    records = (await requestResult(store.getAll())).filter((record) => allowed.has(record.studentId))
  }
  await done
  return records
}

async function putIdentityRecords(database, records) {
  if (!records.length) return
  const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(IDENTITY_STORE)
  records.forEach((record) => store.put(record))
  await done
}

async function deleteIdentityRecordKeys(database, keys) {
  if (!keys.length) return
  const transaction = database.transaction(IDENTITY_STORE, 'readwrite')
  const done = transactionDone(transaction)
  const store = transaction.objectStore(IDENTITY_STORE)
  keys.forEach((key) => store.delete(key))
  await done
}

async function readSetting(database, id) {
  const transaction = database.transaction(SETTINGS_STORE, 'readonly')
  const done = transactionDone(transaction)
  const setting = await requestResult(transaction.objectStore(SETTINGS_STORE).get(id))
  await done
  return setting || null
}

async function writeSetting(database, setting) {
  const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(SETTINGS_STORE).put(setting)
  await done
}

async function deleteSetting(database, id) {
  const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore(SETTINGS_STORE).delete(id)
  await done
}

async function databaseIsWritable(database) {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  try {
    await writeSetting(database, { id: HEALTHCHECK_SETTING_ID, nonce })
    const stored = await readSetting(database, HEALTHCHECK_SETTING_ID)
    await deleteSetting(database, HEALTHCHECK_SETTING_ID)
    return stored?.nonce === nonce
  } catch {
    return false
  }
}

async function mirrorEncryptionKey(key) {
  const mirror = await openMirrorDatabase()
  try {
    const current = await readStoredKey(mirror)
    const records = await countStoredIdentities(mirror)
    // Una réplica vacía puede conservar una clave antigua después de que el
    // navegador haya reparado el almacén principal. En ese caso es seguro y
    // necesario volver a alinearla antes de copiar nuevos cifrados.
    if (current && !records) {
      await writeStoredKey(mirror, key)
      return key
    }
    if (current) return current
    if (records) {
      const error = new Error('La réplica contiene fichas pero ha perdido su clave. No se sobrescribirá para evitar destruir una posible recuperación.')
      error.code = 'local-identity-key-missing'
      throw error
    }
    await writeStoredKey(mirror, key)
    return key
  } finally {
    mirror.close()
  }
}

async function mirrorIdentityRecords(records) {
  if (!records.length) return
  const mirror = await openMirrorDatabase()
  try {
    await putIdentityRecords(mirror, records)
  } finally {
    mirror.close()
  }
}

async function getEncryptionKey(database) {
  const storedKey = await readStoredKey(database)
  if (storedKey) {
    try {
      await mirrorEncryptionKey(storedKey)
    } catch (error) {
      publishReplicaFailure(error)
    }
    return storedKey
  }

  const mirror = await openMirrorDatabase()
  let mirrorKey
  let mirrorIdentityCount = 0
  try {
    mirrorKey = await readStoredKey(mirror)
    mirrorIdentityCount = await countStoredIdentities(mirror)
  } finally {
    mirror.close()
  }
  if (mirrorKey) {
    try {
      await writeStoredKey(database, mirrorKey)
    } catch (error) {
      publishBackupStatus({ state: 'error', message: `La clave se ha recuperado desde la réplica, pero no se ha podido reparar el almacén principal: ${error?.message || 'error desconocido'}` })
    }
    return mirrorKey
  }

  const storedIdentityCount = await countStoredIdentities(database)
  if (storedIdentityCount || mirrorIdentityCount) {
    const error = new Error('Falta la clave local necesaria para abrir las fichas. Los datos se han conservado; importa una copia .neope para recuperarlos.')
    error.code = 'local-identity-key-missing'
    throw error
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await writeStoredKey(database, key)
  try {
    await mirrorEncryptionKey(key)
  } catch (error) {
    publishReplicaFailure(error)
  }
  return key
}

async function getEncryptionKeyForImport(database) {
  try {
    return await getEncryptionKey(database)
  } catch (error) {
    if (error?.code !== 'local-identity-key-missing') throw error

    const readTransaction = database.transaction(IDENTITY_STORE, 'readonly')
    const readDone = transactionDone(readTransaction)
    const records = await requestResult(readTransaction.objectStore(IDENTITY_STORE).getAll())
    await readDone

    if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
      throw new Error('La clave local no está disponible y este almacén todavía no dispone del área segura de recuperación. Los datos cifrados se mantienen intactos.')
    }

    const capturedAt = new Date().toISOString()
    const recoveryTransaction = database.transaction([IDENTITY_STORE, RECOVERY_STORE], 'readwrite')
    const recoveryDone = transactionDone(recoveryTransaction)
    const recoveryStore = recoveryTransaction.objectStore(RECOVERY_STORE)
    records.forEach((record, index) => recoveryStore.put({
      id: `${capturedAt}:${index}:${record.key}`,
      capturedAt,
      reason: 'missing-encryption-key',
      record,
    }))
    recoveryTransaction.objectStore(IDENTITY_STORE).clear()
    await recoveryDone
    return getEncryptionKey(database)
  }
}

function canonicalRecordKey(studentId) {
  return canonicalStudentIdentityKey(studentId)
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
  const plaintext = encoder.encode(JSON.stringify(studentIdentityEnvelope(privateData)))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv, ciphertext, identitySchemaVersion: CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION }
}

async function decryptIdentityPayload(key, record) {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.ciphertext)
  return migrateStudentIdentityEnvelope(JSON.parse(decoder.decode(plaintext)))
}

async function decryptIdentity(key, record) {
  return (await decryptIdentityPayload(key, record)).envelope.data
}

/**
 * Reescribe fichas antiguas solo después de comprobar que la nueva copia se
 * cifra y descifra correctamente. El original cifrado y la sustitución se
 * guardan en la misma transacción IndexedDB.
 */
async function migrateStoredIdentityRecords(database, key, records) {
  if (!records.length || !database.objectStoreNames.contains(RECOVERY_STORE)) return records
  const replacements = []
  for (const record of records) {
    try {
      const migration = await decryptIdentityPayload(key, record)
      if (!migration.migrated) continue
      const encrypted = await encryptIdentity(key, { ...migration.envelope.data, id: record.studentId })
      const replacement = {
        ...record,
        ...encrypted,
        migratedFromSchemaVersion: migration.originalVersion,
        updatedAt: new Date().toISOString(),
      }
      await decryptIdentity(key, replacement)
      replacements.push({ original: record, replacement })
    } catch {
      // Una ficha ilegible o creada por una versión futura se conserva tal
      // cual. El diagnóstico habitual la señalará sin bloquear las demás.
    }
  }
  if (!replacements.length) return records

  const capturedAt = new Date().toISOString()
  const transaction = database.transaction([IDENTITY_STORE, RECOVERY_STORE], 'readwrite')
  const done = transactionDone(transaction)
  const identities = transaction.objectStore(IDENTITY_STORE)
  const recovery = transaction.objectStore(RECOVERY_STORE)
  replacements.forEach(({ original, replacement }, index) => {
    recovery.put({
      id: `schema-migration:${capturedAt}:${index}:${original.key}`,
      capturedAt,
      reason: 'schema-migration',
      fromSchemaVersion: Number(original.identitySchemaVersion) || 0,
      toSchemaVersion: CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION,
      record: original,
    })
    identities.put(replacement)
  })
  await done
  const replacementsByKey = new Map(replacements.map(({ replacement }) => [replacement.key, replacement]))
  return records.map((record) => replacementsByKey.get(record.key) || record)
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

function identityMapFromDecodedRecords(records) {
  return [...(records || [])]
    .sort((left, right) => String(right.source?.updatedAt || '').localeCompare(String(left.source?.updatedAt || '')))
    .reduce((result, entry) => {
      result.set(entry.identity.id, mergeIdentity(result.get(entry.identity.id), entry.identity))
      return result
    }, new Map())
}

function attachDiagnostics(identities, diagnostics = {}) {
  Object.defineProperty(identities, 'diagnostics', {
    configurable: true,
    enumerable: false,
    value: {
      total: Number(diagnostics.total) || 0,
      recovered: Number(diagnostics.recovered) || 0,
      failed: Number(diagnostics.failed) || 0,
      failures: Array.isArray(diagnostics.failures) ? diagnostics.failures : [],
      source: diagnostics.source || 'primary',
      canonicalStudentIds: Array.isArray(diagnostics.canonicalStudentIds) ? diagnostics.canonicalStudentIds : [],
    },
  })
  return identities
}

export function studentIdentityDiagnostics(identities) {
  return identities?.diagnostics || { total: identities?.size || 0, recovered: identities?.size || 0, failed: 0, failures: [], source: 'primary', canonicalStudentIds: [] }
}

export { identityRecoveryMessage }

export async function loadStudentIdentities(groupId, studentIds = null) {
  const groupIds = [...new Set((Array.isArray(groupId) ? groupId : [groupId]).filter((value) => value !== undefined && value !== null && value !== ''))]
  let database
  let usingMirrorAsPrimary = false
  try {
    database = await openDatabase()
  } catch (primaryError) {
    database = await openMirrorDatabase()
    usingMirrorAsPrimary = true
    publishBackupStatus({
      state: 'error',
      message: `El almacén principal no se puede abrir; Neope está usando su réplica cifrada: ${primaryError?.message || 'error desconocido'}`,
    })
  }
  try {
    const key = usingMirrorAsPrimary ? await readStoredKey(database) : await getEncryptionKey(database)
    if (!key) {
      const error = new Error('La réplica contiene datos, pero no dispone de su clave de cifrado. Importa una copia externa para recuperarlos.')
      error.code = 'local-identity-key-missing'
      throw error
    }
    let primaryRecords = studentIds
      ? await readIdentityRecordsByStudentIds(database, studentIds)
      : await readIdentityRecords(database, groupIds)
    primaryRecords = await migrateStoredIdentityRecords(database, key, primaryRecords)
    if (usingMirrorAsPrimary) {
      const decoded = await decodeIdentityRecords(primaryRecords, (record) => decryptIdentity(key, record))
      return attachDiagnostics(identityMapFromDecodedRecords(decoded.records), {
        total: decoded.total,
        recovered: decoded.identities.length,
        failed: decoded.failures.length,
        failures: decoded.failures,
        source: 'mirror',
        canonicalStudentIds: primaryRecords
          .filter((record) => record.key === canonicalRecordKey(record.studentId))
          .map((record) => record.studentId),
      })
    }
    const mirror = await openMirrorDatabase()
    let mirrorRecords
    try {
      mirrorRecords = studentIds
        ? await readIdentityRecordsByStudentIds(mirror, studentIds)
        : await readIdentityRecords(mirror, groupIds)
      mirrorRecords = await migrateStoredIdentityRecords(mirror, key, mirrorRecords)
    } finally {
      mirror.close()
    }
    const primaryByKey = newestIdentityRecords(primaryRecords)
    const mirrorByKey = newestIdentityRecords(mirrorRecords)
    const reconciledByKey = newestIdentityRecords([...mirrorRecords, ...primaryRecords])
    const missingFromPrimary = [...reconciledByKey.values()].filter((record) => (
      !primaryByKey.has(record.key)
      || String(record.updatedAt || '').localeCompare(String(primaryByKey.get(record.key)?.updatedAt || '')) > 0
    ))
    const missingFromMirror = [...reconciledByKey.values()].filter((record) => (
      !mirrorByKey.has(record.key)
      || String(record.updatedAt || '').localeCompare(String(mirrorByKey.get(record.key)?.updatedAt || '')) > 0
    ))
    try {
      await Promise.all([
        putIdentityRecords(database, missingFromPrimary),
        mirrorIdentityRecords(missingFromMirror),
      ])
    } catch (error) {
      publishBackupStatus({ state: 'error', message: `No se han podido reconciliar las dos copias locales: ${error?.message || 'error desconocido'}` })
    }
    const records = [...reconciledByKey.values()]
    const decoded = await decodeIdentityRecords(records, (record) => decryptIdentity(key, record))
    // El ID actual va primero, pero una copia vacía creada durante la migración
    // no debe ocultar los campos personales conservados bajo un alias anterior.
    return attachDiagnostics(identityMapFromDecodedRecords(decoded.records), {
      total: decoded.total,
      recovered: decoded.identities.length,
      failed: decoded.failures.length,
      failures: decoded.failures,
      canonicalStudentIds: records
        .filter((record) => record.key === canonicalRecordKey(record.studentId))
        .map((record) => record.studentId),
    })
  } finally {
    database.close()
  }
}

async function deleteStudentIdentityRecordsEverywhere(studentIds) {
  const ids = new Set(studentIds.filter(Boolean))
  if (!ids.size) return

  async function deleteFrom(open) {
    const database = await open()
    try {
      const records = await readIdentityRecords(database)
      const keys = records.flatMap((record) => {
        const studentId = record.studentId || [...ids].find((id) => String(record.key || '').endsWith(`:${id}`))
        return ids.has(studentId) ? [record.key] : []
      })
      await deleteIdentityRecordKeys(database, [...new Set(keys)])
    } finally {
      database.close()
    }
  }

  const results = await Promise.allSettled([deleteFrom(openDatabase), deleteFrom(openMirrorDatabase)])
  if (results.every((result) => result.status === 'rejected')) throw results[0].reason
  const partialFailure = results.find((result) => result.status === 'rejected')
  if (partialFailure) publishReplicaFailure(partialFailure.reason)
}

export async function deleteStudentIdentitiesEverywhere(studentIds) {
  await runLocalIdentityMutation(() => deleteStudentIdentityRecordsEverywhere(Array.isArray(studentIds) ? studentIds : []))
  await writeLinkedIdentityFile({ mergeExternal: false })
}

export async function loadStudentIdentitiesForGroup(group) {
  await syncStudentIdentitiesFromLinkedFile().catch(() => false)
  const groupIds = studentIdentityGroupIds(group)
  if (!groupIds.length) return new Map()
  const studentIds = Array.isArray(group?.alumnos) ? group.alumnos.map((student) => student.id) : []
  const storedIdentities = await loadStudentIdentities(groupIds, studentIds)
  const diagnostics = studentIdentityDiagnostics(storedIdentities)
  // Nunca se reasigna una ficha a otro código: solo se aceptan coincidencias
  // exactas de grupo (o alias explícito) y código pseudónimo.
  const identities = identitiesForExactStudentIds(storedIdentities, studentIds)

  if (group?.id && identities.size) {
    const canonicalIds = new Set(diagnostics.canonicalStudentIds || [])
    const needsMigration = [...identities.values()].filter((identity) => !canonicalIds.has(identity.id))
    if (needsMigration.length) await saveStudentIdentities(group.id, needsMigration)
  }
  return attachDiagnostics(identities, diagnostics)
}

async function saveStudentIdentitiesNow(groupId, identities, { preserveEmpty = true } = {}) {
  if (!identities.length) return
  requestPersistenceInBackground()
  const identityIds = identities.map((identity) => identity?.id).filter(Boolean)
  const recovered = await loadStudentIdentities(groupId, identityIds)
  const failedStudentIds = new Set(studentIdentityDiagnostics(recovered).failures.map((failure) => failure.studentId))
  const safeIdentities = identities
    .filter((identity) => !(
      preserveEmpty
      && failedStudentIds.has(identity.id)
      && !identityHasValue(identity)
    ))
    .map((identity) => {
      const previous = recovered.get(identity.id)
      // En edición explícita los campos conocidos pueden vaciarse, pero los
      // campos de una versión anterior o futura que la vista no representa
      // no deben desaparecer al volver a guardar la ficha.
      return preserveEmpty
        ? mergeIdentity(identity, previous)
        : { ...(previous || {}), ...identity }
    })
  if (!safeIdentities.length) return
  let database
  let usingMirrorAsPrimary = false
  try {
    database = await openDatabase()
  } catch (primaryError) {
    database = await openMirrorDatabase()
    usingMirrorAsPrimary = true
    publishBackupStatus({
      state: 'error',
      message: `El almacén principal no está disponible; los cambios se guardarán en la réplica cifrada: ${primaryError?.message || 'error desconocido'}`,
    })
  }
  try {
    let key = usingMirrorAsPrimary ? await readStoredKey(database) : await getEncryptionKey(database)
    if (!key) {
      if (await countStoredIdentities(database)) {
        const error = new Error('El almacén conserva fichas cifradas pero no su clave. No se sobrescribirán; importa una copia externa para recuperarlas.')
        error.code = 'local-identity-key-missing'
        throw error
      }
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await writeStoredKey(database, key)
    }
    const encrypted = await Promise.all(safeIdentities.map(async (identity) => ({
        // El código es global e inmutable. El grupo queda como metadato, pero
        // ya no forma parte de la identidad de la ficha local.
        key: canonicalRecordKey(identity.id),
        groupId,
        studentId: identity.id,
        ...(await encryptIdentity(key, identity)),
        updatedAt: new Date().toISOString(),
    })))
    await putIdentityRecords(database, encrypted)
    if (!usingMirrorAsPrimary) {
      try {
        await mirrorIdentityRecords(encrypted)
      } catch (error) {
        publishReplicaFailure(error)
      }
    }
  } finally {
    database.close()
  }
  scheduleLinkedIdentityFileWrite()
}

export function saveStudentIdentities(groupId, identities, options = {}) {
  // Impide que un autoguardado antiguo termine después que otro más reciente
  // y vuelva a dejar en disco una versión anterior de la ficha.
  return runLocalIdentityMutation(() => saveStudentIdentitiesNow(groupId, identities, options))
}

async function deleteStudentIdentitiesNow(groupId, studentIds) {
  if (!studentIds.length) return
  const ids = new Set(studentIds.filter(Boolean))
  async function deleteFrom(open) {
    const database = await open()
    try {
      const records = await readIdentityRecordsByStudentIds(database, [...ids])
      await deleteIdentityRecordKeys(database, records.map((record) => record.key))
    } finally {
      database.close()
    }
  }
  const results = await Promise.allSettled([deleteFrom(openDatabase), deleteFrom(openMirrorDatabase)])
  if (results.every((result) => result.status === 'rejected')) throw results[0].reason
  const partialFailure = results.find((result) => result.status === 'rejected')
  if (partialFailure) publishReplicaFailure(partialFailure.reason)
}

export async function deleteStudentIdentities(groupId, studentIds) {
  await runLocalIdentityMutation(() => deleteStudentIdentitiesNow(groupId, studentIds))
  await writeLinkedIdentityFile({ mergeExternal: false })
}

export async function deleteStudentIdentitiesForGroup(group, studentIds) {
  await deleteStudentIdentities(group?.id || '', studentIds)
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
  await localIdentityMutation
  let database
  let usingMirrorAsPrimary = false
  try {
    database = await openDatabase()
  } catch {
    database = await openMirrorDatabase()
    usingMirrorAsPrimary = true
  }
  try {
    const localKey = usingMirrorAsPrimary ? await readStoredKey(database) : await getEncryptionKey(database)
    if (!localKey && await countStoredIdentities(database)) {
      throw new Error('Las fichas están cifradas, pero falta su clave local. No se creará una copia incompleta.')
    }
    let primaryRecords = await readIdentityRecords(database)
    if (localKey) primaryRecords = await migrateStoredIdentityRecords(database, localKey, primaryRecords)
    let mirrorRecords = []
    if (!usingMirrorAsPrimary) {
      try {
        const mirror = await openMirrorDatabase()
        try {
          mirrorRecords = await readIdentityRecords(mirror)
          if (localKey) mirrorRecords = await migrateStoredIdentityRecords(mirror, localKey, mirrorRecords)
        } finally {
          mirror.close()
        }
      } catch (error) {
        publishReplicaFailure(error)
      }
    }
    const records = [...newestIdentityRecords([...mirrorRecords, ...primaryRecords]).values()]
      .filter((record) => record.groupId !== GLOBAL_IDENTITY_SCOPE)
    const decoded = await decodeIdentityRecords(records, (record) => decryptIdentity(localKey, record))
    if (decoded.failures.length) {
      throw new Error(`${identityRecoveryMessage({ recovered: decoded.identities.length, failed: decoded.failures.length })} Recupera esas fichas antes de exportar una copia nueva.`)
    }
    const mergedIdentities = identityMapFromDecodedRecords(decoded.records)
    const newestSourceByStudent = new Map()
    decoded.records
      .sort((left, right) => String(right.source?.updatedAt || '').localeCompare(String(left.source?.updatedAt || '')))
      .forEach(({ source }) => {
        if (!newestSourceByStudent.has(source.studentId)) newestSourceByStudent.set(source.studentId, source)
      })
    return [...mergedIdentities.values()].map((identity) => {
      const source = newestSourceByStudent.get(identity.id)
      return {
        key: canonicalRecordKey(identity.id),
        groupId: source?.groupId || 'unknown',
        studentId: identity.id,
        identitySchemaVersion: CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION,
        updatedAt: source?.updatedAt || null,
        privateData: Object.fromEntries(Object.entries(identity).filter(([field]) => field !== 'id')),
      }
    })
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
  const validIdentities = Array.isArray(payload?.identities)
    ? payload.identities.filter(validTransferRecord).map(migrateTransferredStudentIdentity)
    : []
  const identities = [...newestIdentityRecords(validIdentities.map((record) => ({
    ...record,
    key: canonicalRecordKey(record.studentId),
  }))).values()]
  let database
  let usingMirrorAsPrimary = false
  try {
    database = await openDatabase()
  } catch (primaryError) {
    database = await openMirrorDatabase()
    usingMirrorAsPrimary = true
    publishBackupStatus({
      state: 'error',
      message: `El almacén principal no está disponible; la importación se conservará en la réplica cifrada: ${primaryError?.message || 'error desconocido'}`,
    })
  }
  try {
    // La importación explícita de un archivo válido es también la vía de
    // recuperación cuando el navegador ha perdido la CryptoKey local. Antes
    // de reiniciar la clave se conserva una copia técnica de los cifrados.
    let localKey
    if (usingMirrorAsPrimary) {
      localKey = await readStoredKey(database)
      if (!localKey && await countStoredIdentities(database)) {
        throw new Error('La réplica conserva fichas cifradas pero no su clave. No se sobrescribirán.')
      }
      if (!localKey) {
        localKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        await writeStoredKey(database, localKey)
      }
    } else {
      localKey = await getEncryptionKeyForImport(database)
    }
    const primaryRecords = await readIdentityRecords(database)
    let mirrorRecords = []
    if (!usingMirrorAsPrimary) {
      try {
        const mirror = await openMirrorDatabase()
        try {
          mirrorRecords = await readIdentityRecords(mirror)
        } finally {
          mirror.close()
        }
      } catch (error) {
        publishReplicaFailure(error)
      }
    }
    const currentByKey = newestIdentityRecords([...mirrorRecords, ...primaryRecords])
    const imported = identities.filter((record) => {
      const current = currentByKey.get(canonicalRecordKey(record.studentId))
      return !current || String(record.updatedAt || '').localeCompare(String(current.updatedAt || '')) >= 0
    })
    const encrypted = await Promise.all(imported.map(async (record) => ({
      key: canonicalRecordKey(record.studentId),
      groupId: record.groupId,
      studentId: record.studentId,
      ...(await encryptIdentity(localKey, { ...record.privateData, id: record.studentId })),
      updatedAt: record.updatedAt || new Date().toISOString(),
    })))
    if (encrypted.length) {
      await putIdentityRecords(database, encrypted)
      try {
        if (usingMirrorAsPrimary) return { records: encrypted.length, students: new Set(identities.map((record) => record.studentId)).size }
        await mirrorIdentityRecords(encrypted)
      } catch (error) {
        publishReplicaFailure(error)
      }
    }
    return { records: encrypted.length, students: new Set(identities.map((record) => record.studentId)).size }
  } finally {
    database.close()
  }
}

function importTransferPayloadSafely(payload) {
  return runLocalIdentityMutation(() => importTransferPayload(payload))
}

async function linkedFileSetting() {
  let primary = null
  let mirror = null
  try {
    primary = await openDatabase()
  } catch {}
  try {
    mirror = await openMirrorDatabase()
  } catch {}
  if (!primary && !mirror) throw new Error('No se puede abrir ningún almacén local.')
  try {
    const [primarySetting, mirrorSetting] = await Promise.all([
      primary ? readSetting(primary, LINKED_FILE_SETTING_ID).catch(() => null) : null,
      mirror ? readSetting(mirror, LINKED_FILE_SETTING_ID).catch(() => null) : null,
    ])
    const setting = primarySetting || mirrorSetting
    if (setting) {
      await Promise.allSettled([
        !primarySetting && primary ? writeSetting(primary, setting) : Promise.resolve(),
        !mirrorSetting && mirror ? writeSetting(mirror, setting) : Promise.resolve(),
      ])
    }
    return setting
  } finally {
    primary?.close()
    mirror?.close()
  }
}

async function saveLinkedFileSetting(setting) {
  const value = { id: LINKED_FILE_SETTING_ID, ...setting }
  const writes = await Promise.allSettled([
    (async () => {
      const database = await openDatabase()
      try { await writeSetting(database, value) } finally { database.close() }
    })(),
    (async () => {
      const mirror = await openMirrorDatabase()
      try { await writeSetting(mirror, value) } finally { mirror.close() }
    })(),
  ])
  if (writes.every((result) => result.status === 'rejected')) throw writes[0].reason
  const partialFailure = writes.find((result) => result.status === 'rejected')
  if (partialFailure) publishReplicaFailure(partialFailure.reason)
}

async function linkedFilePermission(handle, request = false) {
  if (!handle?.queryPermission) return false
  const options = { mode: 'readwrite' }
  if (await handle.queryPermission(options) === 'granted') return true
  return request && await handle.requestPermission(options) === 'granted'
}

let linkedFileWriteTimer = null
let linkedFileOperation = Promise.resolve()
let linkedFileWriteShouldMerge = true

function runLinkedFileOperation(operation) {
  const next = linkedFileOperation.then(operation, operation)
  linkedFileOperation = next.catch(() => {})
  return next
}

async function writeLinkedIdentityFile({ mergeExternal = true } = {}) {
  return runLinkedFileOperation(async () => {
    const setting = await linkedFileSetting()
    if (!setting?.handle || !setting?.key || !setting?.salt) return false
    if (!await linkedFilePermission(setting.handle)) {
      publishBackupStatus({
        state: 'error',
        message: 'La copia externa no tiene permiso de escritura. Abre el perfil y pulsa «Sincronizar» para reactivarla.',
      })
      return false
    }
    if (mergeExternal) {
      const currentContents = await (await setting.handle.getFile()).text()
      if (currentContents.trim()) {
        const currentBundle = parseTransferBundle(currentContents)
        await importTransferPayloadSafely(await decryptTransferBundle(currentBundle, setting.key))
      }
    }
    const serialized = await serializeTransferBundle(setting.key, base64ToBytes(setting.salt))
    const writable = await setting.handle.createWritable()
    await writable.write(serialized)
    await writable.close()
    const lastSyncedAt = new Date().toISOString()
    await saveLinkedFileSetting({ ...setting, lastSyncedAt })
    publishBackupStatus({ state: 'saved', lastSyncedAt })
    return true
  })
}

function scheduleLinkedIdentityFileWrite({ mergeExternal = true } = {}) {
  // Una eliminación debe dominar sobre cualquier autoguardado pendiente. Si
  // se reimportase el archivo justo antes de escribir, la ficha borrada
  // reaparecería en la copia local.
  linkedFileWriteShouldMerge = linkedFileWriteShouldMerge && mergeExternal
  clearTimeout(linkedFileWriteTimer)
  linkedFileWriteTimer = setTimeout(() => {
    linkedFileWriteTimer = null
    const shouldMerge = linkedFileWriteShouldMerge
    linkedFileWriteShouldMerge = true
    writeLinkedIdentityFile({ mergeExternal: shouldMerge }).catch((error) => {
      publishBackupStatus({
        state: 'error',
        message: `No se ha podido actualizar la copia externa: ${error?.message || 'error desconocido'}`,
      })
    })
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
  const result = await importTransferPayloadSafely(await decryptTransferBundle(bundle, key))
  scheduleLinkedIdentityFileWrite()
  return result
}

export function supportsLinkedStudentIdentityFile() {
  return typeof globalThis.showSaveFilePicker === 'function'
}

export async function requestPersistentLocalStudentStorage() {
  if (!navigator.storage?.persist) return false
  return navigator.storage.persist()
}

async function persistentLocalStudentStorageStatus() {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false
}

export async function linkedStudentIdentityFileStatus() {
  const setting = await linkedFileSetting()
  const persistent = await persistentLocalStudentStorageStatus()
  if (!setting?.handle) return { supported: supportsLinkedStudentIdentityFile(), linked: false, permission: 'none', name: '', persistent }
  const permission = setting.handle.queryPermission
    ? await setting.handle.queryPermission({ mode: 'readwrite' })
    : 'denied'
  return {
    supported: supportsLinkedStudentIdentityFile(),
    linked: true,
    permission,
    name: setting.name || setting.handle.name || 'datos-alumnos.neope',
    lastSyncedAt: setting.lastSyncedAt || null,
    persistent,
  }
}

export async function inspectLocalStudentIdentityStorage() {
  let database = null
  let primaryOpenError = null
  let activeDatabaseWritable = false
  try {
    database = await openDatabase()
    activeDatabaseWritable = await databaseIsWritable(database)
  } catch (error) {
    primaryOpenError = error
    try {
      database = await openMirrorDatabase()
    } catch (mirrorError) {
      throw new Error(`No se puede abrir ni el almacén principal (${error?.name || 'error'}) ni la réplica (${mirrorError?.name || 'error'}).`)
    }
  }

  try {
    let records
    try {
      const recordsTransaction = database.transaction(IDENTITY_STORE, 'readonly')
      const recordsDone = transactionDone(recordsTransaction)
      records = await requestResult(recordsTransaction.objectStore(IDENTITY_STORE).getAll())
      await recordsDone
    } catch (error) {
      throw new Error(`No se pueden leer las fichas cifradas (${error?.name || 'error desconocido'}: ${error?.message || 'sin detalle'}).`)
    }

    let storedKey
    try {
      // La clave se lee en una transacción independiente. Algunos motores de
      // IndexedDB fallan al clonar CryptoKey dentro de una transacción que
      // también contiene registros binarios de otro object store.
      const keyTransaction = database.transaction(KEY_STORE, 'readonly')
      const keyDone = transactionDone(keyTransaction)
      storedKey = await requestResult(keyTransaction.objectStore(KEY_STORE).get(IDENTITY_KEY_ID))
      await keyDone
    } catch (error) {
      throw new Error(`No se puede abrir la clave de cifrado local (${error?.name || 'error desconocido'}: ${error?.message || 'sin detalle'}).`)
    }

    let mirrorRecords = primaryOpenError ? records : []
    let mirrorKey = primaryOpenError ? storedKey?.key || null : null
    let mirrorWritable = primaryOpenError ? activeDatabaseWritable : false
    if (!primaryOpenError) {
      try {
        const mirror = await openMirrorDatabase()
        try {
          ;[mirrorRecords, mirrorKey, mirrorWritable] = await Promise.all([
            readIdentityRecords(mirror),
            readStoredKey(mirror),
            databaseIsWritable(mirror),
          ])
        } finally {
          mirror.close()
        }
      } catch (error) {
        throw new Error(`No se puede comprobar la réplica local (${error?.name || 'error desconocido'}: ${error?.message || 'sin detalle'}).`)
      }
    }

    const reconciledRecords = [...newestIdentityRecords(primaryOpenError ? mirrorRecords : [...mirrorRecords, ...records]).values()]
    const usableKey = storedKey?.key || mirrorKey
    if (!usableKey) {
      return {
        total: reconciledRecords.length,
        readable: 0,
        unreadable: reconciledRecords.length,
        keyAvailable: false,
        primaryRecords: primaryOpenError ? 0 : records.length,
        mirrorRecords: mirrorRecords.length,
        primaryAvailable: !primaryOpenError,
        primaryWritable: primaryOpenError ? false : activeDatabaseWritable,
        mirrorWritable,
      }
    }
    let decoded
    try {
      decoded = await decodeIdentityRecords(reconciledRecords, (record) => decryptIdentity(usableKey, record))
    } catch (error) {
      throw new Error(`No se pueden comprobar los datos cifrados (${error?.name || 'error desconocido'}: ${error?.message || 'sin detalle'}).`)
    }
    return {
      total: decoded.total,
      readable: decoded.identities.length,
      unreadable: decoded.failures.length,
      keyAvailable: true,
      primaryRecords: primaryOpenError ? 0 : records.length,
      mirrorRecords: mirrorRecords.length,
      primaryAvailable: !primaryOpenError,
      primaryWritable: primaryOpenError ? false : activeDatabaseWritable,
      mirrorWritable,
    }
  } finally {
    database?.close()
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
    await importTransferPayloadSafely(await decryptTransferBundle(bundle, key))
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
  await requestPersistentLocalStudentStorage().catch(() => false)
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
    const result = await importTransferPayloadSafely(await decryptTransferBundle(bundle, setting.key))
    return result
  })
}

export async function unlinkStudentIdentityFile() {
  async function unlinkFrom(open) {
    const database = await open()
    try {
      const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
      const done = transactionDone(transaction)
      transaction.objectStore(SETTINGS_STORE).delete(LINKED_FILE_SETTING_ID)
      await done
    } finally {
      database.close()
    }
  }
  const results = await Promise.allSettled([unlinkFrom(openDatabase), unlinkFrom(openMirrorDatabase)])
  if (results.every((result) => result.status === 'rejected')) throw results[0].reason
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
    async function clearFrom(open) {
      const database = await open()
      try {
        const stores = database.objectStoreNames.contains(RECOVERY_STORE)
          ? [IDENTITY_STORE, RECOVERY_STORE]
          : [IDENTITY_STORE]
        const transaction = database.transaction(stores, 'readwrite')
        const done = transactionDone(transaction)
        transaction.objectStore(IDENTITY_STORE).clear()
        if (stores.includes(RECOVERY_STORE)) transaction.objectStore(RECOVERY_STORE).clear()
        await done
      } finally {
        database.close()
      }
    }
    const clears = await Promise.allSettled([clearFrom(openDatabase), clearFrom(openMirrorDatabase)])
    if (clears.every((result) => result.status === 'rejected')) throw clears[0].reason

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
