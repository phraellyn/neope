import { executableLatex } from './latexDocumentSource.js'

const linesOf = (value) => String(value || '').split(/\r\n|\r|\n/)
const lineKey = (line) => String(line || '').trim().replace(/\s+/g, ' ')

export function diagnoseLatexStructure(value) {
  const source = String(value || '')
  const masked = executableLatex(source)
  const braces = []
  const environments = []
  const problems = []
  const add = (offset, message) => {
    const line = linesOf(source.slice(0, offset)).length
    problems.push({ id: `structure-${offset}-${problems.length}`, line, column: 1, location: `Línea ${line}`, message, severity: 'error' })
  }
  for (const token of masked.matchAll(/\\(begin|end)\s*\{([^{}]+)\}|[{}]/g)) {
    let slashes = 0
    for (let index = token.index - 1; index >= 0 && masked[index] === '\\'; index -= 1) slashes += 1
    if (slashes % 2) continue
    if (token[1] === 'begin') environments.push({ name: token[2], offset: token.index })
    else if (token[1] === 'end') {
      const opening = environments.pop()
      if (opening?.name !== token[2]) add(token.index, `Se cierra ${token[2]}, pero ${opening ? `estaba abierto ${opening.name}` : 'no hay un entorno abierto'}.`)
    } else if (token[0] === '{') braces.push(token.index)
    else if (braces.length) braces.pop()
    else add(token.index, 'Esta llave de cierre no tiene una llave de apertura.')
  }
  braces.forEach((offset) => add(offset, 'Falta cerrar la llave abierta en esta línea.'))
  environments.forEach(({ name, offset }) => add(offset, `Falta cerrar el entorno ${name}.`))
  return problems.sort((left, right) => left.line - right.line)
}

// Los números del log incluyen el preámbulo y las envolturas del servidor.
// Se localiza la línea por su contenido y contexto; nunca se aplica un
// desplazamiento supuesto ni se señala una coincidencia ambigua.
export function locateLatexSourceLine(source, compiledSource, compilerLine, { bodyOnly = false } = {}) {
  const original = linesOf(source)
  const compiled = linesOf(compiledSource)
  const at = Number(compilerLine) - 1
  if (at < 0 || at >= compiled.length) return null
  if (bodyOnly) {
    const executable = executableLatex(String(compiledSource || ''))
    const begin = /\\begin\s*\{document\}/.exec(executable)
    const end = [...executable.matchAll(/\\end\s*\{document\}/g)].at(-1)
    const firstLine = begin ? linesOf(executable.slice(0, begin.index)).length : 0
    const lastLine = end ? linesOf(executable.slice(0, end.index)).length : compiled.length + 1
    if (compilerLine <= firstLine || compilerLine >= lastLine) return null
  }
  let first = 0
  let last = original.length
  const marker = compiled.slice(0, at + 1).join('\n').match(/%\s*neope:part\s+id=([A-Za-z0-9_-]+)(?![\s\S]*%\s*neope:part\s+id=)/)?.[1]
  if (marker) {
    const index = original.findIndex((line) => new RegExp(`%\\s*neope:part\\s+id=${marker}(?:\\s|$)`).test(line))
    if (index >= 0) {
      first = index
      const next = original.findIndex((line, cursor) => cursor > index && /%\s*neope:part\s+id=/.test(line))
      if (next >= 0) last = next
    }
  }
  const key = lineKey(compiled[at])
  const candidates = []
  for (let index = first; index < last; index += 1) if (lineKey(original[index]) === key) candidates.push(index)
  if (candidates.length === 1 && key) return candidates[0] + 1
  let best = null
  let score = 0
  let ambiguous = false
  for (const candidate of candidates) {
    let current = 0
    for (let distance = 1; distance <= 6; distance += 1) {
      for (const direction of [-1, 1]) {
        const neighbor = lineKey(compiled[at + direction * distance])
        if (neighbor && neighbor === lineKey(original[candidate + direction * distance])) current += 7 - distance
      }
    }
    if (current > score) { best = candidate + 1; score = current; ambiguous = false }
    else if (current === score) ambiguous = true
  }
  return score > 0 && !ambiguous ? best : null
}

export function parseLatexDiagnostics(value, { source = '', compiledSource = source, bodyOnly = false } = {}) {
  const log = String(value || '').split(/\n\n(?:LaTeX enviado al compilador|Contexto LaTeX|La línea \d+ corresponde)/)[0]
  if (!log.trim()) return []
  const problems = []
  for (const match of log.matchAll(/(?:^|\n)([^\r\n]*?\.(?:tex|sty|cls|bib)):(\d+)(?::(\d+))?:[ \t]*([^\r\n]+)/g)) {
    problems.push({ file: match[1].trim().replace(/^\(+/, ''), compilerLine: Number(match[2]), column: Number(match[3]) || 1, message: match[4].trim() })
  }
  for (const match of log.matchAll(/^![ \t]*([^\r\n]+)([\s\S]*?)(?=^!|(?![\s\S]))/gm)) {
    const location = /(?:^|\n)l\.(\d+)\b/.exec(match[2])
    if (location) problems.push({ file: 'document.tex', compilerLine: Number(location[1]), column: 1, message: match[1].trim() })
  }
  if (!problems.length) problems.push({ file: '', compilerLine: null, column: 1, message: log.split('\n').find((line) => line.trim())?.trim().slice(0, 400) || 'No se ha podido compilar el código LaTeX.' })
  const seen = new Set()
  return problems.filter((problem) => {
    const key = `${problem.compilerLine}:${problem.message.replace(/^LaTeX Error:\s*/i, '').replace(/[.\s]+$/, '')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((problem, index) => {
    const file = problem.file.split(/[\\/]/).at(-1)
    const localFile = !file || ['document.tex', 'main.tex'].includes(file)
    const line = localFile && problem.compilerLine
      ? locateLatexSourceLine(source, compiledSource, problem.compilerLine, { bodyOnly })
      : null
    return { ...problem, id: `latex-${index}-${problem.compilerLine || 'general'}`, severity: 'error', line, location: line ? `Línea ${line}` : problem.compilerLine ? `${file || 'Código compilado'}, línea ${problem.compilerLine}` : 'Compilación' }
  })
}

export function compilerDocumentSource(preamble, body) {
  return `${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`
}
