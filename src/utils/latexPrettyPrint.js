const compactEnvironments = new Set([
  'aligned', 'alignedat', 'array', 'bmatrix', 'Bmatrix', 'cases', 'det', 'detp',
  'gather', 'gather*', 'gathered', 'matrix', 'matrix*', 'matriz', 'matrizb',
  'matrizp', 'matrizv', 'pmatrix', 'pmatrix*', 'smallmatrix', 'split', 'Vmatrix',
  'vmatrix',
])

const verbatimEnvironments = new Set(['Verbatim', 'lstlisting', 'minted', 'verbatim'])

function environmentTokens(line) {
  return [...line.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/g)].map((match) => ({
    type: match[1],
    name: match[2].trim(),
  }))
}

function removeEnvironment(stack, name) {
  const index = stack.lastIndexOf(name)
  if (index >= 0) stack.splice(index, 1)
}

export function prettyPrintLatex(source) {
  const indent = '    '
  const stack = []
  const output = []
  let pendingBlankLine = false
  let verbatimEnvironment = null

  for (const originalLine of String(source || '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = originalLine.trim()

    if (verbatimEnvironment) {
      const closesVerbatim = environmentTokens(originalLine)
        .some(({ type, name }) => type === 'end' && name === verbatimEnvironment)
      if (!closesVerbatim) {
        output.push(originalLine)
        continue
      }
      removeEnvironment(stack, verbatimEnvironment)
      output.push(`${indent.repeat(stack.length)}${trimmed}`)
      verbatimEnvironment = null
      continue
    }

    if (!trimmed) {
      if (output.length && !stack.some((name) => compactEnvironments.has(name))) pendingBlankLine = true
      continue
    }

    const tokens = environmentTokens(trimmed)
    const leadingEnds = []
    let remainingPrefix = trimmed
    while (true) {
      const match = remainingPrefix.match(/^\\end\s*\{([^{}]+)\}\s*/)
      if (!match) break
      const name = match[1].trim()
      leadingEnds.push(name)
      removeEnvironment(stack, name)
      remainingPrefix = remainingPrefix.slice(match[0].length)
    }

    if (pendingBlankLine) {
      const closesCompactBlock = leadingEnds.some((name) => compactEnvironments.has(name))
      if (!closesCompactBlock && output.at(-1) !== '') output.push('')
      pendingBlankLine = false
    }

    output.push(`${indent.repeat(stack.length)}${trimmed}`)

    let skippedLeadingEnds = 0
    for (const token of tokens) {
      if (token.type === 'end' && skippedLeadingEnds < leadingEnds.length) {
        skippedLeadingEnds += 1
        continue
      }
      if (token.type === 'begin') {
        stack.push(token.name)
        if (verbatimEnvironments.has(token.name)) verbatimEnvironment = token.name
      } else removeEnvironment(stack, token.name)
    }
  }

  return output.join('\n')
}
