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
