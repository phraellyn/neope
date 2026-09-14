import assert from 'node:assert/strict'
import {
  ADMIN_EMAIL,
  authSessionMatches,
  hasAuthorizedRole,
  needsAdministratorBootstrap,
  normalizedAuthEmail,
} from '../src/utils/authSession.js'

assert.equal(normalizedAuthEmail(' CARLOS.S@EDUCA.MADRID.ORG '), ADMIN_EMAIL)
assert.equal(hasAuthorizedRole({ role: 'teacher' }), true)
assert.equal(hasAuthorizedRole({ role: 'student' }), true)
assert.equal(hasAuthorizedRole({ role: 'admin' }), false)
assert.equal(needsAdministratorBootstrap({ email: ADMIN_EMAIL }, {}), true)
assert.equal(needsAdministratorBootstrap({ email: ADMIN_EMAIL }, { role: 'teacher', admin: false }), true)
assert.equal(needsAdministratorBootstrap({ email: ADMIN_EMAIL }, { role: 'teacher', admin: true }), false)
assert.equal(needsAdministratorBootstrap({ email: 'profesor@example.com' }, {}), false)
assert.equal(authSessionMatches({ currentUser: { uid: 'a' } }, { uid: 'a' }), true)
assert.equal(authSessionMatches({ currentUser: { uid: 'b' } }, { uid: 'a' }), false)

console.log('authSession: ok')
