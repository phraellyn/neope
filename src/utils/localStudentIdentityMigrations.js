export const CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION = 1

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const migrations = new Map([
  [0, (legacyData) => ({
    schemaVersion: 1,
    data: isObject(legacyData) ? clone(legacyData) : {},
  })],
])

/** Crea el sobre cifrado actual conservando también los campos desconocidos. */
export function studentIdentityEnvelope(privateData = {}) {
  return {
    schemaVersion: CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION,
    data: isObject(privateData) ? clone(privateData) : {},
  }
}

/**
 * Convierte tanto el JSON histórico (campos en la raíz) como cualquier versión
 * conocida del sobre a la versión vigente. Nunca acepta silenciosamente una
 * versión futura que esta aplicación no sabe interpretar.
 */
export function migrateStudentIdentityEnvelope(payload) {
  const isEnvelope = isObject(payload)
    && Number.isInteger(Number(payload.schemaVersion))
    && isObject(payload.data)
  let envelope = isEnvelope
    ? { schemaVersion: Number(payload.schemaVersion), data: clone(payload.data) }
    : { schemaVersion: 0, data: isObject(payload) ? clone(payload) : {} }
  const originalVersion = envelope.schemaVersion

  if (originalVersion > CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION) {
    throw new Error(`La ficha local usa una versión futura (${originalVersion}) que esta versión de Neope no puede abrir.`)
  }
  while (envelope.schemaVersion < CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION) {
    const migration = migrations.get(envelope.schemaVersion)
    if (!migration) throw new Error(`No existe una migración segura desde la versión ${envelope.schemaVersion}.`)
    envelope = migration(envelope.data)
  }
  return { envelope, migrated: originalVersion !== envelope.schemaVersion, originalVersion }
}

export function migrateTransferredStudentIdentity(record = {}) {
  const declaredVersion = Number(record.identitySchemaVersion)
  const payload = Number.isInteger(declaredVersion) && declaredVersion > 0
    ? { schemaVersion: declaredVersion, data: record.privateData }
    : record.privateData
  const { envelope, migrated, originalVersion } = migrateStudentIdentityEnvelope(payload)
  return {
    ...record,
    identitySchemaVersion: envelope.schemaVersion,
    privateData: envelope.data,
    migrated,
    originalVersion,
  }
}
