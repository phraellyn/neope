import { createHash } from 'node:crypto'
import { codeForCompiler, exerciseRenderProfiles } from './exerciseRender.js'
export { codeForCompiler, exerciseRenderProfiles }
import { assertUniqueExercisePartIds } from './exercisePartIdentity.js'
import { criteriaCellText } from './criteriaLatex.js'

function numberText(value) {
  const number = Number(value) || 0
  return Number.isInteger(number) ? String(number) : String(number).replace('.', ',')
}

function solutionBlock(value) {
  const latex = String(value?.latex || '').trim()
  return latex ? `\\begin{solucion}\n${latex}\n\\end{solucion}` : ''
}

function answerBlock(value, index) {
  const latex = String(value?.latex || '').trim()
  if (!latex) return ''
  return `\\${index === 0 ? 'lsol' : 'sol'}{${latex}}`
}

function metadataCommand(command, value) {
  return Number(value) > 0 ? `\\${command}{${numberText(value)}}` : ''
}

function criteriaPartLabel(index) {
  return index < 26 ? String.fromCharCode(97 + index) : String(index + 1)
}

function criteriaTableBody(exercise) {
  const rows = []
  const appendRows = (label, criteria) => {
    const list = Array.isArray(criteria) ? criteria : []
    const groupRows = []
    list.forEach((criterion) => {
      const description = criteriaCellText(criterion?.description)
      if (!description) return
      const points = numberText(criterion?.points)
      groupRows.push({ label: groupRows.length === 0 ? label : '', description, points })
    })
    groupRows.forEach((row, index) => {
      const suffix = index === groupRows.length - 1 ? ' \\\\ \\hline' : ' \\\\ '
      rows.push(`${row.label} & ${row.description} & ${row.points}${suffix}`)
    })
  }
  const parts = Array.isArray(exercise.parts) ? exercise.parts : []
  if (parts.length) {
    appendRows('', exercise.gradingCriteria)
    parts.forEach((part, index) => appendRows(criteriaPartLabel(index), part.gradingCriteria))
  } else {
    appendRows('', exercise.gradingCriteria)
  }
  return rows.join('\n')
}

function criteriaCommand(exercise) {
  const body = criteriaTableBody(exercise)
  return body ? `\\criterios{\n${body}\n}` : ''
}

function mainLatex(exercise, { includeSolutions, includeAnswers, includeScore = true }) {
  const chunks = ['\\ej']
  const metadata = includeScore ? [
    metadataCommand('M', exercise.points),
    metadataCommand('T', exercise.durationMinutes),
  ].filter(Boolean).join(' ') : ''
  if (metadata) chunks[0] += ` ${metadata}\\\\`
  if (exercise.statement?.latex?.trim()) chunks.push(exercise.statement.latex.trim())
  if (includeAnswers && !exercise.parts?.length && exercise.answer?.latex?.trim()) {
    chunks.push(`\\lsol{${exercise.answer.latex.trim()}}`)
  }
  if (includeSolutions && exercise.workedSolution?.latex?.trim()) chunks.push(solutionBlock(exercise.workedSolution))
  return chunks.filter(Boolean).join('\n\n')
}

export function buildExerciseLatex(exercise, { includeSolutions = true, includeAnswers = true, preservePartsEnvironment = true, includeCriteria = includeSolutions, includeInfo = true } = {}) {
  const chunks = [mainLatex(exercise, { includeSolutions, includeAnswers, includeScore: true })]
  const parts = Array.isArray(exercise.parts) ? exercise.parts : []
  if (parts.length) {
    const storedEnvironment = exercise.partsEnvironment === 'apartadosc' ? 'apartadosc' : 'apartados'
    const environment = includeSolutions && !preservePartsEnvironment ? 'apartados' : storedEnvironment
    const body = parts.map((part, index) => {
      const metadata = [
        metadataCommand('p', part.points),
        metadataCommand('t', part.durationMinutes),
      ].filter(Boolean).join(' ')
      return [
        `% neope:part id=${part.id}`,
        `\\ap${metadata ? ` ${metadata}` : ''} ${part.statement?.latex || ''}`.trimEnd(),
        includeAnswers ? answerBlock(part.answer, index) : '',
        includeSolutions ? solutionBlock(part.workedSolution) : '',
      ].filter(Boolean).join('\n\n')
    }).join('\n\n')
    chunks.push(`\\begin{${environment}}\n${body}\n\\end{${environment}}`)
  }
  if (exercise.final?.trim()) chunks.push(exercise.final.trim())
  if (includeCriteria) {
    const criteria = criteriaCommand(exercise)
    if (criteria) chunks.push(criteria)
  }
  if (includeInfo && exercise.info?.trim()) chunks.push(`\\info{${exercise.info.trim()}}`)
  return chunks.filter(Boolean).join('\n\n')
}

function centeredStandaloneStatement(value = '') {
  const statement = String(value || '').trim()
  if (!/^\\(?:tikz\b|begin\s*\{tikzpicture\}|includegraphics\b)/.test(statement)) return statement
  return `\\begin{center}\n${statement}\n\\end{center}`
}

export function buildPartLatex(exercise, partId = null, { includeSolutions = false, includeAnswers = false } = {}) {
  if (!partId) {
    return [
      centeredStandaloneStatement(exercise.statement?.latex),
      includeSolutions ? solutionBlock(exercise.workedSolution) : '',
    ].filter(Boolean).join('\n\n')
  }
  const index = (exercise.parts || []).findIndex((part) => part.id === partId)
  const part = exercise.parts?.[index]
  if (!part) return ''
  return [
    centeredStandaloneStatement(part.statement?.latex),
    includeSolutions ? solutionBlock(part.workedSolution) : '',
  ].filter(Boolean).join('\n\n')
}

export function hasWorkedSolutions(exercise) {
  return Boolean(exercise.workedSolution?.latex?.trim()
    || (exercise.parts || []).some((part) => part.workedSolution?.latex?.trim()))
}

export function sourceHash(code, context = '') {
  return createHash('sha256').update(`${context}\u0000${code}`).digest('hex')
}

export function compilationArtifacts(exercise, exerciseId, revision) {
  assertUniqueExercisePartIds(exercise.parts || [])
  const root = `ejercicios/${exerciseId}/revisions/${revision}`
  const artifacts = []
  const add = (key, storagePath, code, current, profile) => artifacts.push({
    key,
    storagePath,
    code,
    current: current || null,
    profile,
  })

  add('pdf.statement', `${root}/statement.pdf`, buildExerciseLatex(exercise, {
    includeSolutions: false,
    includeAnswers: false,
    preservePartsEnvironment: true,
  }), exercise.pdf?.statement, exerciseRenderProfiles.statement)

  if (hasWorkedSolutions(exercise)) {
    add('pdf.solved', `${root}/solved.pdf`, buildExerciseLatex(exercise, {
      includeSolutions: true,
      includeAnswers: true,
      preservePartsEnvironment: false,
    }), exercise.pdf?.solved, exerciseRenderProfiles.solved)
  }

  add('statement.pdf', `${root}/parts/main/statement.pdf`, buildPartLatex(exercise), exercise.statement?.pdf, exerciseRenderProfiles.segment)
  if (exercise.workedSolution?.latex?.trim()) {
    add('workedSolution.pdf', `${root}/parts/main/worked-solution.pdf`, buildPartLatex(exercise, null, {
      includeSolutions: true,
      includeAnswers: true,
    }), exercise.workedSolution?.pdf, exerciseRenderProfiles.segment)
  }

  for (const part of exercise.parts || []) {
    const partRoot = `${root}/parts/${part.id}`
    add(`parts.${part.id}.statement.pdf`, `${partRoot}/statement.pdf`, buildPartLatex(exercise, part.id), part.statement?.pdf, exerciseRenderProfiles.segment)
    if (part.workedSolution?.latex?.trim()) {
      add(`parts.${part.id}.workedSolution.pdf`, `${partRoot}/worked-solution.pdf`, buildPartLatex(exercise, part.id, {
        includeSolutions: true,
        includeAnswers: true,
      }), part.workedSolution?.pdf, exerciseRenderProfiles.segment)
    }
  }
  return artifacts
}
