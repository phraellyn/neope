const DATABASE_NAME = 'neope-private-data'
const DATABASE_VERSION = 1
const IDENTITY_STORE = 'student-identities'
const KEY_STORE = 'crypto-keys'
const IDENTITY_KEY_ID = 'student-identities-v1'

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
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        const identities = database.createObjectStore(IDENTITY_STORE, { keyPath: 'key' })
        identities.createIndex('groupId', 'groupId', { unique: false })
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
    return new Map(identities.map((identity) => [identity.id, identity]))
  } finally {
    database.close()
  }
}

export async function saveStudentIdentities(groupId, identities) {
  if (!identities.length) return
  const database = await openDatabase()
  try {
    const key = await getEncryptionKey(database)
    const encrypted = await Promise.all(identities.map(async (identity) => ({
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
