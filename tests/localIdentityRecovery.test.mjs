import assert from 'node:assert/strict'
import {
  canonicalStudentIdentityKey,
  decodeIdentityRecords,
  identityRecordsForExactStudentIds,
  identitiesForExactStudentIds,
  identityRecoveryMessage,
  newestIdentityRecords,
  studentIdFromIdentityRecord,
} from '../src/utils/localIdentityRecovery.js'

const records = [
  { key: 'grupo:a', groupId: 'grupo', studentId: 'a', payload: { nombre: 'Ana' } },
  { key: 'grupo:b', groupId: 'grupo', studentId: 'b', payload: null },
  { key: 'grupo:c', groupId: 'grupo', studentId: 'c', payload: { nombre: 'Carlos' } },
]

const decoded = await decodeIdentityRecords(records, async (record) => {
  if (!record.payload) throw new DOMException('No se puede descifrar', 'OperationError')
  return record.payload
})

assert.deepEqual(decoded.identities, [
  { id: 'a', nombre: 'Ana' },
  { id: 'c', nombre: 'Carlos' },
])
assert.equal(decoded.failures.length, 1)
assert.equal(decoded.failures[0].studentId, 'b')
assert.equal(decoded.failures[0].reason, 'OperationError')
assert.equal(decoded.total, 3)
assert.match(identityRecoveryMessage({ recovered: 2, failed: 1 }), /recuperado 2 fichas/u)
assert.match(identityRecoveryMessage({ recovered: 0, failed: 2 }), /permanecen guardados/u)
assert.equal(identityRecoveryMessage({ recovered: 3, failed: 0 }), '')

const newest = newestIdentityRecords([
  { key: 'g:a', studentId: 'a', updatedAt: '2026-09-11T10:00:00.000Z', value: 'old' },
  { key: 'g:a', studentId: 'a', updatedAt: '2026-09-11T11:00:00.000Z', value: 'new' },
  { key: 'g:b', studentId: 'b', updatedAt: '2026-09-11T09:00:00.000Z' },
])
assert.equal(newest.get('g:a').value, 'new')
assert.equal(newest.size, 2)

const exact = identitiesForExactStudentIds(new Map([
  ['aB3xY9', { id: 'aB3xY9', nombre: 'ALFA, Ana' }],
  ['zK7pQ2', { id: 'zK7pQ2', nombre: 'BETA, Bruno' }],
]), ['zK7pQ2'])
assert.deepEqual([...exact.keys()], ['zK7pQ2'])
assert.equal(exact.get('zK7pQ2').nombre, 'BETA, Bruno')
assert.equal(exact.has('aB3xY9'), false)
assert.equal(canonicalStudentIdentityKey('aB3xY9'), 'student:aB3xY9')
assert.equal(canonicalStudentIdentityKey('aB3xY9'), canonicalStudentIdentityKey('aB3xY9', 'otro-grupo'))

assert.equal(studentIdFromIdentityRecord({ studentId: 'aB3xY9', key: 'student:otro' }), 'aB3xY9')
assert.equal(studentIdFromIdentityRecord({ key: 'grupo-antiguo:aB3xY9' }), 'aB3xY9')
assert.deepEqual(identityRecordsForExactStudentIds([
  { key: 'student:aB3xY9', payload: 1 },
  { key: 'grupo-antiguo:Z7mP2q', payload: 2 },
  { key: 'student:fuera', studentId: 'fuera', payload: 3 },
], ['aB3xY9', 'Z7mP2q']), [
  { key: 'student:aB3xY9', studentId: 'aB3xY9', payload: 1 },
  { key: 'grupo-antiguo:Z7mP2q', studentId: 'Z7mP2q', payload: 2 },
])

assert.deepEqual(identityRecordsForExactStudentIds([
  { key: 'student:aB3xY9', studentId: 123456, payload: 1 },
], ['123456']), [
  { key: 'student:aB3xY9', studentId: '123456', payload: 1 },
])

console.log('localIdentityRecovery: ok')
