function skipComment(source, cursor) {
  const newline = source.indexOf('\n', cursor)
  return newline < 0 ? source.length : newline + 1
}

function commandAt(source, cursor) {
  return /^\\(?:[A-Za-z@]+\*?|[^\r\n])/.exec(source.slice(cursor))?.[0] || ''
}

function argumentAt(source, cursor) {
  while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor += 1
  if (source[cursor] !== '{') return null
  const start = cursor
  let depth = 0
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '%') { cursor = skipComment(source, cursor) - 1; continue }
    if (source[cursor] === '\\') { cursor += Math.max(1, commandAt(source, cursor).length) - 1; continue }
    if (source[cursor] === '{') depth += 1
    if (source[cursor] === '}' && --depth === 0) return { value: source.slice(start + 1, cursor), end: cursor + 1 }
  }
  return null
}

function environmentEnd(source, cursor, name) {
  let depth = 1
  while (cursor < source.length) {
    if (source[cursor] === '%') { cursor = skipComment(source, cursor); continue }
    const command = source[cursor] === '\\' ? commandAt(source, cursor) : ''
    if (command === '\\begin' || command === '\\end') {
      const argument = argumentAt(source, cursor + command.length)
      if (argument?.value.trim() === name) {
        depth += command === '\\begin' ? 1 : -1
        if (depth === 0) return argument.end
      }
    }
    cursor += command.length || 1
  }
  throw new Error('El entorno solucion generado está incompleto.')
}

// Comparación de la fuente, excluyendo únicamente los campos que puede añadir
// una solución. Las fórmulas, dibujos, puntuaciones y enunciados siguen intactos.
function statementSource(value) {
  const source = String(value || '')
  let result = ''
  let braceDepth = 0
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor]
    if (character === '%') { cursor = skipComment(source, cursor); continue }
    const command = character === '\\' ? commandAt(source, cursor) : ''
    if (command === '\\verb' || command === '\\verb*') {
      const delimiter = source[cursor + command.length]
      const end = delimiter ? source.indexOf(delimiter, cursor + command.length + 1) : -1
      if (end < 0) throw new Error('Hay un comando verb incompleto.')
      result += source.slice(cursor, end + 1)
      cursor = end + 1
      continue
    }
    if (braceDepth === 0 && command === '\\begin') {
      const argument = argumentAt(source, cursor + command.length)
      const name = argument?.value.trim()
      if (name === 'solucion') { cursor = environmentEnd(source, argument.end, name); continue }
      if (['verbatim', 'Verbatim', 'lstlisting', 'minted'].includes(name)) {
        const closing = `\\end{${name}}`
        const end = source.indexOf(closing, argument.end)
        if (end < 0) throw new Error('Hay un entorno literal incompleto.')
        result += source.slice(cursor, end + closing.length)
        cursor = end + closing.length
        continue
      }
    }
    if (braceDepth === 0 && ['\\sol', '\\lsol', '\\esol', '\\csol', '\\info', '\\criterios'].includes(command)) {
      const argument = argumentAt(source, cursor + command.length)
      if (argument) { cursor = argument.end; continue }
    }
    if (command) { result += command; cursor += command.length; continue }
    if (character === '{') braceDepth += 1
    if (character === '}') braceDepth -= 1
    result += character
    cursor += 1
  }
  return result.replace(/\s+/g, ' ').trim()
}

export function validateExerciseSolutionSource(original, generated) {
  const markers = (source) => [...String(source || '').matchAll(/^[ \t]*%[ \t]*neope:part[ \t]+id=([A-Za-z0-9_-]+)/gm)].map((match) => match[1])
  const originalIds = markers(original)
  if (new Set(originalIds).size !== originalIds.length) return ['El ejercicio original tiene identificadores de apartado repetidos.']
  if (originalIds.join('|') !== markers(generated).join('|')) return ['La IA ha cambiado las identidades o el orden de los apartados.']
  try {
    return statementSource(original) === statementSource(generated)
      ? []
      : ['La IA ha modificado el enunciado, sus datos o sus apartados. Debe copiar el original literalmente y añadir únicamente soluciones; si una afirmación es falsa, debe explicarlo en la solución sin cambiarla.']
  } catch (error) {
    return [error.message]
  }
}
