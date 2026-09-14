import assert from 'node:assert/strict'
import {
  CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION,
  migrateStudentIdentityEnvelope,
  migrateTransferredStudentIdentity,
  studentIdentityEnvelope,
} from '../src/utils/localStudentIdentityMigrations.js'

const legacy = {
  nombre: 'ALUMNO, Prueba',
  foto: 'data:image/png;base64,AAAA',
  campoFuturo: { contenido: 'se conserva' },
}
const migrated = migrateStudentIdentityEnvelope(legacy)
assert.equal(migrated.originalVersion, 0)
assert.equal(migrated.migrated, true)
assert.equal(migrated.envelope.schemaVersion, CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION)
assert.deepEqual(migrated.envelope.data, legacy)

const current = studentIdentityEnvelope(legacy)
const unchanged = migrateStudentIdentityEnvelope(current)
assert.equal(unchanged.migrated, false)
assert.deepEqual(unchanged.envelope, current)

const transferred = migrateTransferredStudentIdentity({
  groupId: 'grupo-1',
  studentId: 'Abc123',
  privateData: legacy,
})
assert.equal(transferred.identitySchemaVersion, CURRENT_STUDENT_IDENTITY_SCHEMA_VERSION)
assert.deepEqual(transferred.privateData, legacy)

assert.throws(
  () => migrateStudentIdentityEnvelope({ schemaVersion: 99, data: legacy }),
  /versión futura/,
)

console.log('Local student identity migrations: OK')
