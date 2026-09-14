export function shortStudentName(fullName = '') {
  const parts = String(fullName).split(',')
  if (parts.length < 2) return ''
  return parts.slice(1).join(',').trim()
}

export function sourceGroupOptions(groupName = '') {
  const match = String(groupName).trim().match(/\s+([A-Z](?:\s*\+\s*[A-Z])+)$|^([A-Z](?:\s*\+\s*[A-Z])+)$/iu)
  const suffix = match?.[1] || match?.[2] || ''
  return [...new Set(suffix.split('+').map((value) => value.trim().toLocaleUpperCase('es-ES')).filter(Boolean))]
}

export function normalizedSourceGroup(value, options = []) {
  const normalized = String(value || '').trim().toLocaleUpperCase('es-ES')
  return options.includes(normalized) ? normalized : (options[0] || '')
}

export function nextSourceGroup(value, options = []) {
  if (!options.length) return ''
  const current = options.indexOf(normalizedSourceGroup(value, options))
  return options[(current + 1) % options.length]
}
