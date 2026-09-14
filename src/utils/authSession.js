export const ADMIN_EMAIL = 'carlos.s@educa.madrid.org'
export const AUTHORIZED_ROLES = Object.freeze(['teacher', 'student'])

export function normalizedAuthEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function hasAuthorizedRole(claims) {
  return AUTHORIZED_ROLES.includes(claims?.role)
}

export function needsAdministratorBootstrap(user, claims) {
  return normalizedAuthEmail(user?.email) === ADMIN_EMAIL
    && (claims?.role !== 'teacher' || claims?.admin !== true)
}

export function authSessionMatches(auth, user) {
  return Boolean(user?.uid && auth?.currentUser?.uid === user.uid)
}
