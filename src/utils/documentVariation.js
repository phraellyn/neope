import { executableLatex } from './latexDocumentSource.js'
export { terminalVariationConcepts, uniqueConceptIds } from '../../functions/documentVariationPlan.js'

export function flattenVariationBlocks(blocks = []) {
  return blocks.flatMap((block) => block.type === 'tool' ? flattenVariationBlocks(block.children || []) : [block])
}

export function replaceVariationBlocks(blocks, replacements) {
  return blocks.map((block) => block.type === 'tool'
    ? { ...block, children: replaceVariationBlocks(block.children || [], replacements) }
    : { ...block, ...(replacements.get(block.blockId) || {}) })
}

// The ranges leave the preamble, global tools, environments and page boundaries intact.
export function documentExerciseRanges(code, { commands = [], environments = [] } = {}) {
  const source = executableLatex(String(code || ''))
  const body = /\\begin\s*\{document\}/.exec(source)
  const from = body ? body.index + body[0].length : 0
  const boundaries = new Set(['salto', 'newpage', 'clearpage', 'obligatorios', 'optativos', ...commands])
  const toolEnvironments = new Set(environments)
  const stack = []
  const ranges = []
  let active = null
  let braces = 0
  const finish = (to) => {
    if (!active) return
    const end = active.from + code.slice(active.from, to).trimEnd().length
    ranges.push({ from: active.from, to: end, code: code.slice(active.from, end) })
    active = null
  }
  const tokens = /\\(?:begin|end)\s*\{[^}]+\}|\\[A-Za-z@]+\b|\\[^A-Za-z@]|[{}]/g
  tokens.lastIndex = from
  for (let match; (match = tokens.exec(source));) {
    const token = match[0]
    const environment = /^\\(begin|end)\s*\{([^}]+)\}/.exec(token)
    if (environment) {
      if (environment[1] === 'begin') {
        if (active && braces === active.braces && toolEnvironments.has(environment[2]) && stack.length === active.depth) finish(match.index)
        stack.push(environment[2])
      } else {
        if (active && stack.length <= active.depth) finish(match.index)
        stack.pop()
        if (environment[2] === 'document') break
      }
    } else if (token === '{') braces += 1
    else if (token === '}') braces -= 1
    else if (token === '\\ej' && braces === 0) {
      finish(match.index)
      active = { from: match.index, depth: stack.length, braces }
    } else if (active && braces === active.braces && stack.length === active.depth && boundaries.has(token.slice(1))) finish(match.index)
  }
  finish(source.length)
  return ranges
}

export function documentVariationEdits(code, originals, options) {
  const ranges = documentExerciseRanges(code, options)
  if (ranges.length !== originals.length) throw new Error('El código final y los ejercicios del documento no coinciden. Revisa su estructura antes de crear la variación.')
  const marked = originals.map((original) => {
    const escaped = original.slotId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`^% neope:document-block id=${escaped} begin\\r?\\n[\\s\\S]*?^% neope:document-block id=${escaped} end[^\\r\\n]*`, 'm').exec(code)
    return match ? { slotId: original.slotId, from: match.index, to: match.index + match[0].length, marked: true } : null
  })
  if (marked.every(Boolean)) return marked
  const masked = executableLatex(code)
  const body = /\\begin\s*\{document\}/.exec(masked)
  let cursor = body ? body.index + body[0].length : 0
  const exact = originals.map((original) => {
    const fragment = String(original.code || '').trim()
    const exerciseOffset = /\\ej\b/.exec(fragment)?.index ?? -1
    let start = fragment ? code.indexOf(fragment, cursor) : -1
    while (start >= 0 && (exerciseOffset < 0 || !masked.startsWith('\\ej', start + exerciseOffset))) start = code.indexOf(fragment, start + fragment.length)
    if (start < 0) return null
    cursor = start + fragment.length
    return { slotId: original.slotId, from: start, to: cursor }
  })
  if (exact.every(Boolean)) return exact
  return ranges.map((range, index) => ({ ...range, slotId: originals[index].slotId, fallback: true }))
}

export function variationBlockCode(slotId, code) {
  if (!/^[A-Za-z0-9:_-]+$/.test(slotId)) throw new Error('Identificador de bloque no válido para preservar el código.')
  return `% neope:document-block id=${slotId} begin\n${code}\n% neope:document-block id=${slotId} end`
}

// Each template can have different column layouts: use the breaks present in
// that template's original exercise, not those from another rendered version.
export function matchTemplateColumnBreaks(generated, original) {
  const pattern = /\\(?:newcolumn|columnbreak)\b(?:\s*\[[^\]\r\n]*\])?/g
  const sourceBreaks = [...executableLatex(original).matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ''))
  const generatedBreaks = [...executableLatex(generated).matchAll(pattern)]
  if (sourceBreaks.length === 0) {
    let code = generated
    for (const match of generatedBreaks.reverse()) code = code.slice(0, match.index) + code.slice(match.index + match[0].length)
    return code
  }
  if (sourceBreaks.join('|') !== generatedBreaks.map((match) => match[0].replace(/\s+/g, '')).join('|')) {
    throw new Error('Los saltos de columna de esta plantilla no coinciden con los del ejercicio original. Revisa el ejercicio antes de generar la copia.')
  }
  return generated
}

export function variationCommandBlocks(code, command = 'criterios') {
  const source = executableLatex(code)
  const starts = [...source.matchAll(new RegExp(`\\\\${command}\\s*\\{`, 'g'))]
  return starts.flatMap((match) => {
    const opening = match.index + match[0].lastIndexOf('{')
    let depth = 1
    for (let index = opening + 1; index < source.length; index += 1) {
      if (source[index] === '\\' && /[{}\\%]/.test(source[index + 1] || '')) { index += 1; continue }
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      if (!depth) return [code.slice(match.index, index + 1)]
    }
    throw new Error(`El comando \\${command} contiene un argumento sin cerrar.`)
  })
}

export function applyDocumentVariationEdits(code, edits, replacementFor) {
  let result = code
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    const replacement = replacementFor(edit.slotId, edit)
    if (typeof replacement !== 'string' || !replacement.trim()) throw new Error('Falta un ejercicio generado para reconstruir el documento.')
    result = result.slice(0, edit.from) + replacement + result.slice(edit.to)
  }
  return result
}
