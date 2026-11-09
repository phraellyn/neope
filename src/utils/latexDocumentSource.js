// Preserve offsets while ignoring comments and literal LaTeX examples.
export function executableLatex(source, { onLiteral = () => {} } = {}) {
  const masked = source.split('')
  const blank = (start, end) => {
    for (let index = start; index < end; index += 1) if (!['\n', '\r'].includes(source[index])) masked[index] = ' '
  }
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '%') {
      let end = source.indexOf('\n', index)
      const carriage = source.indexOf('\r', index)
      if (carriage >= 0 && (end < 0 || carriage < end)) end = carriage
      if (end < 0) end = source.length
      blank(index, end)
      index = end - 1
    } else if (source[index] === '\\') {
      const literal = /^\\begin\s*\{(verbatim\*?|Verbatim\*?|lstlisting|minted|alltt|comment)\}/.exec(source.slice(index))
      const verb = /^\\verb\*?([^A-Za-z\s])/.exec(source.slice(index))
      if (literal) {
        const endPattern = new RegExp(`\\\\end\\s*\\{${literal[1].replace('*', '\\*')}\\}`)
        const end = endPattern.exec(source.slice(index + literal[0].length))
        const stop = end ? index + literal[0].length + end.index + end[0].length : source.length
        onLiteral(index, stop)
        blank(index, stop)
        index = stop - 1
      } else if (verb) {
        const end = source.indexOf(verb[1], index + verb[0].length)
        const stop = end < 0 ? source.length : end + 1
        onLiteral(index, stop)
        blank(index, stop)
        index = stop - 1
      } else if (['%', '\\'].includes(source[index + 1])) {
        index += 1
      }
    }
  }
  return masked.join('')
}

function documentBounds(source) {
  const tokens = [...executableLatex(source).matchAll(/\\(begin|end)\s*\{document\}/g)]
  const first = tokens.findIndex((token) => token[1] === 'begin')
  if (first < 0) return null
  let depth = 0
  for (const token of tokens.slice(first)) {
    depth += token[1] === 'begin' ? 1 : -1
    if (depth === 0) return { begin: tokens[first], end: token }
  }
  throw new Error('El documento LaTeX de origen contiene \\begin{document}, pero falta su \\end{document}.')
}

function unwrapPreview(source) {
  const executable = executableLatex(source)
  const begin = /^\s*\\begin\s*\{preview\}/.exec(executable)
  const end = /\\end\s*\{preview\}\s*$/.exec(executable)
  if (!begin || !end || end.index < begin[0].length) return source.trim()
  return source.slice(begin[0].length, end.index).trim()
}

function repairLegacyBody(source, stripPreview) {
  // Only legacy preamble references immediately followed by a nested document
  // are removed. Content includes, comments and examples are kept intact.
  const executable = executableLatex(source)
  const references = [...executable.matchAll(/\\input\s*\{(?:\.\.\/)+[^}]+\}\s*(?=\\begin\s*\{document\})/g)]
  let repaired = source
  for (const reference of references.reverse()) {
    const tail = source.slice(reference.index + reference[0].length)
    const bounds = documentBounds(tail)
    if (!bounds) continue
    let body = tail.slice(bounds.begin.index + bounds.begin[0].length, bounds.end.index)
    body = repairLegacyBody(body, stripPreview)
    if (stripPreview) body = unwrapPreview(body)
    const stop = reference.index + reference[0].length + bounds.end.index + bounds.end[0].length
    repaired = repaired.slice(0, reference.index) + body + repaired.slice(stop)
  }
  return repaired
}

export function documentSourceContent(code = '', { stripPreview = false } = {}) {
  const source = String(code)
  const bounds = documentBounds(source)
  let body = bounds ? source.slice(bounds.begin.index + bounds.begin[0].length, bounds.end.index) : source
  body = repairLegacyBody(body, stripPreview)
  return stripPreview ? unwrapPreview(body) : body.trim()
}

export function repairNestedLegacyDocument(code = '') {
  const source = String(code)
  let bounds
  try { bounds = documentBounds(source) } catch { return source }
  if (!bounds) return source
  const bodyStart = bounds.begin.index + bounds.begin[0].length
  const body = source.slice(bodyStart, bounds.end.index)
  const repaired = repairLegacyBody(body, true)
  if (repaired === body) return source
  return source.slice(0, bodyStart) + repaired + source.slice(bounds.end.index)
}

// Preserve the exact saved preamble and wrappers while exposing only the body
// between the template's opening and closing material for editing.
export function editableDocumentParts(code = '', { before = '', after = '', headerCommand = '' } = {}) {
  const source = String(code)
  const bounds = documentBounds(source)
  if (!bounds) return { prefix: '', content: source, suffix: '' }
  const bodyStart = bounds.begin.index + bounds.begin[0].length
  const bodyEnd = bounds.end.index
  const beforeCode = String(before)
  const afterCode = String(after)
  const beforeBegin = /\\begin\s*\{document\}/.exec(executableLatex(beforeCode))
  const afterEnd = /\\end\s*\{document\}/.exec(executableLatex(afterCode))
  const opening = (beforeBegin ? beforeCode.slice(beforeBegin.index + beforeBegin[0].length) : beforeCode).trim()
  const closing = (afterEnd ? afterCode.slice(0, afterEnd.index) : afterCode).trim()
  let start = bodyStart
  let end = bodyEnd
  while (start < end && /\s/.test(source[start])) start += 1
  while (end > start && /\s/.test(source[end - 1])) end -= 1
  if (opening && source.startsWith(opening, start)) {
    start += opening.length
    while (start < end && /\s/.test(source[start])) start += 1
  } else if (headerCommand && opening.includes(`\\${headerCommand}`)) {
    // An older saved header may use different arguments or field values. Keep
    // it intact but hide it if it is the first standalone command in the body.
    const header = new RegExp(`^\\\\${String(headerCommand).replace(/[^A-Za-z@]/g, '')}(?![A-Za-z@])`).exec(source.slice(start, end))
    if (header) {
      let cursor = start + header[0].length
      let count = 0
      while (cursor < end) {
        let next = cursor
        while (next < end && /[ \t]/.test(source[next])) next += 1
        if (source[next] !== '{') break
        let depth = 1
        let at = next + 1
        while (at < end && depth) {
          if (source[at] === '\\') { at += 2; continue }
          if (source[at] === '{') depth += 1
          if (source[at] === '}') depth -= 1
          at += 1
        }
        if (depth) break
        cursor = at
        count += 1
      }
      if (count) {
        start = cursor
        while (start < end && /\s/.test(source[start])) start += 1
      }
    }
  }
  if (closing && source.slice(start, end).endsWith(closing)) {
    end -= closing.length
    while (end > start && /\s/.test(source[end - 1])) end -= 1
  }
  return { prefix: source.slice(0, start), content: source.slice(start, end), suffix: source.slice(end) }
}
