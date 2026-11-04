import { mathSubjects } from '../data/mathCurriculum.js'

function normalizeLevel(value) {
  return String(value || '').toLocaleLowerCase('es').replace(/[ºª°]/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/bachillerato|bachiller|bach/g, 'bto')
    .replace(/[^a-z0-9]+/g, '')
}

function sameLevel(value, target) {
  const candidate = normalizeLevel(value)
  const level = normalizeLevel(target)
  if (!candidate || !level) return false
  if (candidate === level) return true
  // A known level followed by one letter is a class group, such as 2º ESO B.
  return /^\d(?:eso|bto)$/.test(level) && candidate.startsWith(level)
    && /^[a-z]$/.test(candidate.slice(level.length))
}

export function documentMatchesGroupLevel(documentData = {}, group = {}) {
  const level = group.curso || group.level || group.nombre || group.name
  if (!normalizeLevel(level)) return false
  const subjectId = documentData.curriculum?.subjectId || documentData.subjectId || documentData.asignaturaId
  const subjectLevel = mathSubjects.find((subject) => subject.id === subjectId)?.course
  const explicit = documentData.curriculum?.course || documentData.curriculum?.level
    || documentData.campos?.level || documentData.campos?.nivel || documentData.level || documentData.course
    || subjectLevel
  if (explicit) return sameLevel(explicit, level)
  const groupField = documentData.campos?.course || documentData.campos?.curso || documentData.campos?.group || documentData.campos?.grupo
  if (sameLevel(groupField, level)) return true
  // Some older records store only a group name, e.g. "2º A". It identifies
  // the level only when it matches the actual destination group.
  return Boolean((documentData.groupContext?.id && documentData.groupContext.id === group.id)
    || (groupField && normalizeLevel(groupField) === normalizeLevel(group.nombre || group.name)))
}
