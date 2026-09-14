export async function decodeIdentityRecords(records, decrypt) {
  const results = await Promise.all((records || []).map(async (record) => {
    try {
      return {
        ok: true,
        source: record,
        identity: {
          id: record.studentId,
          ...(await decrypt(record)),
        },
      }
    } catch (error) {
      return {
        ok: false,
        failure: {
          key: String(record?.key || ''),
          groupId: String(record?.groupId || ''),
          studentId: String(record?.studentId || ''),
          reason: String(error?.name || error?.code || 'decrypt-error'),
        },
      }
    }
  }))

  return {
    identities: results.filter((result) => result.ok).map((result) => result.identity),
    records: results.filter((result) => result.ok).map((result) => ({
      source: result.source,
      identity: result.identity,
    })),
    failures: results.filter((result) => !result.ok).map((result) => result.failure),
    total: results.length,
  }
}

export function identityRecoveryMessage(diagnostics) {
  const failed = Number(diagnostics?.failed) || 0
  const recovered = Number(diagnostics?.recovered) || 0
  if (!failed) return ''
  const records = failed === 1 ? 'una ficha local' : `${failed} fichas locales`
  return recovered
    ? `Se han recuperado ${recovered} fichas, pero no se ha podido descifrar ${records}. Los registros afectados se conservarán sin sobrescribir.`
    : `No se ha podido descifrar ${records}. Los registros permanecen guardados y no se sobrescribirán.`
}

export function newestIdentityRecords(records = []) {
  const result = new Map()
  records.forEach((record) => {
    if (!record?.key) return
    const previous = result.get(record.key)
    if (!previous || String(record.updatedAt || '').localeCompare(String(previous.updatedAt || '')) >= 0) {
      result.set(record.key, record)
    }
  })
  return result
}

/**
 * Vincula datos personales y alumnos exclusivamente mediante el código
 * pseudónimo. Nunca se usan el orden, el nombre ni coincidencias aproximadas.
 */
export function identitiesForExactStudentIds(identities, studentIds = []) {
  const allowed = new Set(studentIds.filter(Boolean))
  return new Map(
    [...(identities || new Map()).entries()]
      .filter(([studentId]) => allowed.has(studentId)),
  )
}

export function canonicalStudentIdentityKey(studentId) {
  return `student:${String(studentId || '')}`
}
