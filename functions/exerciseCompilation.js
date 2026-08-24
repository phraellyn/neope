import { createHash } from 'node:crypto'
import { normalizeDisplayMathDelimiters } from './solutionLayout.js'

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

export function buildExerciseLatex(exercise, { includeSolutions = true, includeAnswers = true, preservePartsEnvironment = true } = {}) {
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
  if (exercise.info?.trim()) chunks.push(`\\info{${exercise.info.trim()}}`)
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

export const exerciseRenderProfiles = Object.freeze({
  segment: 'segment',
  statement: 'statement',
  solved: 'solved',
})

function segmentTemplate(code) {
  return `\\noindent
\\hspace*{2.5mm}
\\begin{minipage}{8.5cm}
\\vspace*{2.5mm}
${code.trim()}
\\par
\\vspace*{2.5mm}
\\end{minipage}
\\hspace*{2.5mm}`
}

function completeExerciseTemplate(code) {
  return `\\begin{ejercicios}\n${code.trim()}\n\\end{ejercicios}`
}

export function codeForCompiler(code = '', profile = exerciseRenderProfiles.statement) {
  const normalized = normalizeDisplayMathDelimiters(code)
    .replace(/(\\ej\b(?:\s*\\(?:M|P)\s*\{[^{}]*\})?\s*)\\T\s*\{[^{}]*\}/g, '$1')
    .replace(/(\\ap\b(?:\s*\\p\s*\{[^{}]*\})?\s*)\\t\s*\{[^{}]*\}/g, '$1')
    .replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => (
      `\\begin{aligned}${body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')}\\end{aligned}`
    ))
  const body = profile === exerciseRenderProfiles.segment
    ? segmentTemplate(normalized)
    : completeExerciseTemplate(normalized)
  return `\\shorthandoff{<>}\n${body}`
}

export function sourceHash(code, context = '') {
  return createHash('sha256').update(`${context}\u0000${code}`).digest('hex')
}

export function compilationArtifacts(exercise, exerciseId, revision) {
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
