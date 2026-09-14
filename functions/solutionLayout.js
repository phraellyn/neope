const compactEnvironmentPattern = /\\begin\s*\{(matrizp|detp|sistemap)\}[\s\S]*?\\end\s*\{\1\}/g

// Los saltos de fila de LaTeX pueden llevar espacio opcional (`\\[5pt]`).
// El lookbehind evita confundirlos con los delimitadores de display `\[ ... \]`.
export function normalizeDisplayMathDelimiters(text) {
  return String(text || '').replace(
    /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (_, body) => `$$${body.trim()}$$`,
  )
}

export function hasLegacyDisplayMathDelimiters(text) {
  return /(?<!\\)\\\[|(?<!\\)\\\]/.test(String(text || ''))
}

function escapedAt(source, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function inMathModeAt(source, limit) {
  let inlineMath = false
  let displayMath = false
  let mathEnvironmentDepth = 0
  const mathEnvironment = /\\(begin|end)\s*\{(?:equation\*?|align\*?|gather\*?|multline\*?|displaymath|math)\}/y
  for (let cursor = 0; cursor < limit;) {
    if (source[cursor] === '%' && !escapedAt(source, cursor)) {
      const newline = source.indexOf('\n', cursor)
      cursor = newline === -1 ? limit : newline + 1
      continue
    }
    if (source[cursor] === '$' && !escapedAt(source, cursor)) {
      if (source[cursor + 1] === '$') {
        displayMath = !displayMath
        cursor += 2
      } else {
        inlineMath = !inlineMath
        cursor += 1
      }
      continue
    }
    if (source[cursor] === '\\') {
      mathEnvironment.lastIndex = cursor
      const environment = mathEnvironment.exec(source)
      if (environment && environment.index === cursor) {
        mathEnvironmentDepth += environment[1] === 'begin' ? 1 : -1
        mathEnvironmentDepth = Math.max(0, mathEnvironmentDepth)
        cursor = mathEnvironment.lastIndex
        continue
      }
    }
    cursor += 1
  }
  return inlineMath || displayMath || mathEnvironmentDepth > 0
}

// `aligned` no abre por sí mismo el modo matemático. Algunos modelos lo
// producen como bloque autónomo; lo envolvemos de forma determinista para que
// la corrección no dependa de una nueva llamada a la IA.
export function ensureAlignedInDisplayMath(text) {
  const source = String(text || '')
  const pattern = /\\begin\s*\{aligned\}[\s\S]*?\\end\s*\{aligned\}/g
  let result = ''
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    result += source.slice(cursor, match.index)
    result += inMathModeAt(source, match.index)
      ? match[0]
      : `$$\n${match[0]}\n$$`
    cursor = match.index + match[0].length
  }
  return `${result}${source.slice(cursor)}`
}

const latexAccentCharacters = Object.freeze({
  "'a": 'á', "'e": 'é', "'i": 'í', "'o": 'ó', "'u": 'ú',
  "'A": 'Á', "'E": 'É', "'I": 'Í', "'O": 'Ó', "'U": 'Ú',
  '"u': 'ü', '"U': 'Ü', '~n': 'ñ', '~N': 'Ñ',
})

// Las plantillas trabajan en UTF-8. Convertir estas formas heredadas mejora la
// legibilidad del código sin modificar los comandos matemáticos ordinarios.
export function normalizeLatexTextAccents(text) {
  return String(text || '')
    .replace(/\\(['"~])\s*(?:\{([A-Za-z])\}|([A-Za-z]))/g, (match, accent, braced, plain) => (
      latexAccentCharacters[`${accent}${braced || plain}`] || match
    ))
    .replace(/\\c\s*\{([cC])\}/g, (_, letter) => letter === 'C' ? 'Ç' : 'ç')
    .replace(/\\'\s*\{\\i\}/g, 'í')
    .normalize('NFC')
}

export function hasTrailingInfoCommand(text, expectedInfo) {
  const match = String(text || '').trim().match(/\\info\s*\{([^{}]*)\}\s*$/)
  return Boolean(match && match[1].trim() === String(expectedInfo || '').trim())
}

export function splitAlignedRows(body) {
  const rows = []
  const tokenPattern = /\\begin\s*\{[^}]+\}|\\end\s*\{[^}]+\}|\\\\/g
  let nestedDepth = 0
  let rowStart = 0

  for (const token of body.matchAll(tokenPattern)) {
    if (token[0] === '\\\\') {
      if (nestedDepth === 0) {
        rows.push(body.slice(rowStart, token.index))
        rowStart = token.index + token[0].length
      }
    } else if (token[0].startsWith('\\begin')) {
      nestedDepth += 1
    } else {
      nestedDepth = Math.max(0, nestedDepth - 1)
    }
  }
  rows.push(body.slice(rowStart))
  return rows
}

function compactEnvironments(row) {
  return [...row.matchAll(compactEnvironmentPattern)]
}

function lastJoinOperator(text) {
  const matches = [...text.matchAll(/=|\\(?:implies|iff|Longrightarrow|Rightarrow|cdot|times)(?![A-Za-z])/g)]
  return matches.at(-1) || null
}

function splitOverloadedRow(row) {
  const result = []
  let remaining = row

  for (let guard = 0; guard < 12; guard += 1) {
    const environments = compactEnvironments(remaining)
    if (environments.length <= 1) break

    const firstEnd = environments[0].index + environments[0][0].length
    const secondStart = environments[1].index
    const between = remaining.slice(firstEnd, secondStart)
    const operator = lastJoinOperator(between)

    if (!operator) {
      const before = remaining.slice(0, secondStart).trimEnd()
      const after = remaining.slice(secondStart).trimStart()
      const isEnumeration = /[,;]|\\text\s*\{/.test(between)
      result.push(before)
      remaining = isEnumeration
        ? `&\\quad{}${after}`
        : `&\\quad{}\\cdot ${after}`
      continue
    }

    const operatorStart = firstEnd + operator.index
    const operatorEnd = operatorStart + operator[0].length
    const before = remaining.slice(0, operatorStart).trimEnd()
    const after = remaining.slice(operatorEnd).trimStart()
    const isMultiplication = operator[0] === '\\cdot' || operator[0] === '\\times'

    if (isMultiplication) {
      result.push(before)
      remaining = `&\\quad{}${operator[0]} ${after}`
    } else {
      result.push(`${before}${operator[0]}`)
      remaining = `&${operator[0]}${after}`
    }
  }

  result.push(remaining)
  return result
}

export function splitOverloadedCompactRows(text) {
  return String(text || '').replace(
    /\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g,
    (match, body) => {
      const originalRows = splitAlignedRows(body)
      const rows = originalRows.flatMap(splitOverloadedRow)
      if (rows.length === originalRows.length) return match
      return `\\begin{aligned}${rows.join('\\\\\n')}\\end{aligned}`
    },
  )
}
