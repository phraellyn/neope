import { executableLatex } from './latexDocumentSource.js'

function escaped(source, index) {
  let slashes = 0
  while (index > 0 && source[--index] === '\\') slashes += 1
  return slashes % 2 === 1
}

// Solo cambia la sangría. Conserva cada salto físico (también CRLF), las
// líneas vacías, los espacios finales, los comentarios y todos los comandos.
export function prettyPrintLatex(value) {
  const source = String(value ?? '')
  const literals = []
  const masked = executableLatex(source, { onLiteral: (from, to) => literals.push({ from, to }) })
  const pieces = source.split(/(\r\n|\r|\n)/)
  const environments = []
  let braces = 0
  let offset = 0
  let previousComment = false
  let unsafeSpacing = false
  let literalIndex = 0
  for (let index = 0; index < pieces.length; index += 2) {
    const line = pieces[index]
    const code = masked.slice(offset, offset + line.length)
    while (literals[literalIndex]?.to <= offset) literalIndex += 1
    const literal = literals[literalIndex]
    const protectedLine = literal && literal.from <= offset + line.length && literal.to > offset
    if (/\\(?:obeyspaces|obeylines|catcode)\b/.test(code)) unsafeSpacing = true

    const leading = code.match(/^[ \t]*/)?.[0].length || 0
    const prefix = code.slice(leading)
    const closures = prefix.match(/^(?:(?:\\end\s*\{[^{}]+\}|\})[ \t]*)+/)?.[0] || ''
    const closingCount = [...closures.matchAll(/\\end\s*\{[^{}]+\}|\}/g)].length
    const depth = Math.max(0, environments.length + braces - closingCount)
    if (line.trim() && !protectedLine && !previousComment && !unsafeSpacing) {
      pieces[index] = '    '.repeat(Math.min(depth, 24)) + line.replace(/^[ \t]*/, '')
    }

    for (const match of code.matchAll(/\\(begin|end)\s*\{([^{}]+)\}|[{}]/g)) {
      if (escaped(code, match.index)) continue
      if (match[1] === 'begin') environments.push(match[2])
      else if (match[1] === 'end') {
        const opening = environments.lastIndexOf(match[2])
        if (opening >= 0) environments.splice(opening, 1)
      } else if (match[0] === '{') braces += 1
      else braces = Math.max(0, braces - 1)
    }
    previousComment = [...line.matchAll(/%/g)].some((match) => !escaped(line, match.index))
    offset += line.length + (pieces[index + 1]?.length || 0)
  }
  return pieces.join('')
}
