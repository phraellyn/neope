function executableSource(value) {
  const source = String(value || '')
  const masked = source.split('')
  const blank = (from, to) => { for (let index = from; index < to; index += 1) if (!'\r\n'.includes(source[index])) masked[index] = ' ' }
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '%') {
      const length = source.slice(index).search(/[\r\n]/)
      const end = length < 0 ? source.length : index + length
      blank(index, end); index = end - 1
    } else if (source[index] === '\\') {
      const literal = /^\\begin\s*\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}/.exec(source.slice(index))
      const verb = /^\\verb\*?([^A-Za-z\s])/.exec(source.slice(index))
      if (literal) {
        const end = new RegExp(`\\\\end\\s*\\{${literal[1].replace('*', '\\*')}\\}`).exec(source.slice(index + literal[0].length))
        const stop = end ? index + literal[0].length + end.index + end[0].length : source.length
        blank(index, stop); index = stop - 1
      } else if (verb) {
        const end = source.indexOf(verb[1], index + verb[0].length)
        const stop = end < 0 ? source.length : end + 1
        blank(index, stop); index = stop - 1
      } else index += /^\\(?:[A-Za-z@]+|.)/.exec(source.slice(index))?.[0].length - 1 || 0
    }
  }
  return masked.join('')
}

export function imageReferenceName(value) {
  return String(value || '').trim().replace(/^\.\//, '').split(/[\\/]/).at(-1).replace(/\.(?:png|jpe?g|webp|pdf)$/i, '')
}

export function graphicReferences(value) {
  const source = executableSource(value)
  return [...source.matchAll(/\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g)].map((match) => ({
    name: imageReferenceName(match[1]), rawName: match[1], from: match.index, to: match.index + match[0].length,
    argumentFrom: match.index + match[0].lastIndexOf('{') + 1,
    argumentTo: match.index + match[0].lastIndexOf('}'),
  }))
}

export function replaceGraphicReference(value, fromName, toName) {
  let source = String(value || '')
  for (const reference of graphicReferences(source).filter((entry) => entry.name === imageReferenceName(fromName)).reverse()) {
    source = source.slice(0, reference.argumentFrom) + toName + source.slice(reference.argumentTo)
  }
  return source
}

export function tikzFigures(value) {
  const source = executableSource(value)
  return [...source.matchAll(/\\begin\s*\{tikzpicture\}(?:\[[^\]]*\])?[\s\S]*?\\end\s*\{tikzpicture\}/g)].map((match, index) => ({ id: `tikz-${index}`, kind: 'tikz', from: match.index, to: match.index + match[0].length, code: String(value).slice(match.index, match.index + match[0].length), label: `Figura LaTeX ${index + 1}` }))
}

export function versionImageFiles(exercise, version = exercise) {
  return Array.isArray(version?.archivos) ? version.archivos : Array.isArray(exercise?.archivos) ? exercise.archivos : []
}

export function referencedImageFiles(code, files = []) {
  const references = new Set(graphicReferences(code).map((entry) => entry.name))
  return files.filter((file) => references.has(imageReferenceName(file.latexName || file.compilerName || file.nombre)))
}

export function imageAssetsSignature(files = []) {
  return JSON.stringify(files.map((file) => [file.id || '', file.compilerName || '', file.path || '', file.url || '']).sort((left, right) => left.join(':').localeCompare(right.join(':'))))
}
