export function normalizeCriteriaUnicode(value) {
  const source = String(value || '').replace(/√\s*(\{[^{}]*\}|\([^()]*\)|[A-Za-z0-9](?:²|³)?)/g, (_, radicand) => {
    const normalized = radicand.replace(/²/g, '^{2}').replace(/³/g, '^{3}')
    return `\\ensuremath{\\sqrt{${normalized}}}`
  })
  return source.replace(/[ℝℤℚℕℂ∞→←↔≤≥≠∈∉±×·−≈²³⁺⁻]/g, (character) => ({
    'ℝ': '\\ensuremath{\\mathbb{R}}', 'ℤ': '\\ensuremath{\\mathbb{Z}}',
    'ℚ': '\\ensuremath{\\mathbb{Q}}', 'ℕ': '\\ensuremath{\\mathbb{N}}',
    'ℂ': '\\ensuremath{\\mathbb{C}}', '∞': '\\ensuremath{\\infty}',
    '→': '\\ensuremath{\\to}', '←': '\\ensuremath{\\leftarrow}',
    '↔': '\\ensuremath{\\leftrightarrow}', '≤': '\\ensuremath{\\leq}',
    '≥': '\\ensuremath{\\geq}', '≠': '\\ensuremath{\\ne}',
    '∈': '\\ensuremath{\\in}', '∉': '\\ensuremath{\\notin}',
    '±': '\\ensuremath{\\pm}', '×': '\\ensuremath{\\times}',
    '·': '\\ensuremath{\\cdot}', '−': '-', '≈': '\\ensuremath{\\approx}',
    '²': '\\ensuremath{{}^{2}}', '³': '\\ensuremath{{}^{3}}',
    '⁺': '\\ensuremath{{}^{+}}', '⁻': '\\ensuremath{{}^{-}}',
  })[character] || character)
}

function escaped(source, index) {
  let count = 0
  while (index > 0 && source[--index] === '\\') count += 1
  return count % 2 === 1
}

function argumentEnd(source, start) {
  if (source[start] !== '{') return start
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (escaped(source, index)) continue
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && --depth === 0) return index + 1
  }
  return start
}

const mathCommands = new Set(['frac', 'dfrac', 'tfrac', 'sqrt', 'mathbb', 'mathbf', 'mathrm', 'text', 'to', 'rightarrow', 'leftarrow', 'infty', 'pm', 'mp', 'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'in', 'notin', 'setminus', 'cup', 'cap', 'cdot', 'times', 'approx', 'lim', 'sin', 'cos', 'tan', 'ln', 'log'])

// Los criterios son campos de texto que admiten LaTeX explícito. Protegemos
// sus caracteres de tabla y reconocemos fórmulas simples sin modificar las
// expresiones que el profesor ya ha delimitado con $...$.
export function criteriaCellText(value) {
  const source = normalizeCriteriaUnicode(String(value || '')
    .replace(/\b([RZQNC])\\\{([^{}]*?)(?:\\)?\}/g, (_, set, elements) => `\\ensuremath{\\mathbb{${set}}\\setminus\\{${elements}\\}}`)
    .replace(/(?<!\\)\\\{([^{}]*?)(?<!\\)\}/g, '\\{$1\\}'))
    .trim().replace(/\r?\n/g, ' ')
  let inMath = false
  let result = ''
  for (let index = 0; index < source.length;) {
    const character = source[index]
    if (character === '$' && !escaped(source, index)) {
      inMath = !inMath
      result += character
      index += 1
      continue
    }
    if (character === '\\') {
      const command = /^\\([A-Za-z@]+\*?|.)/.exec(source.slice(index))
      if (command) {
        let end = index + command[0].length
        while (end < source.length) {
          let opening = end
          while (/\s/.test(source[opening] || '') && opening < source.length) opening += 1
          const closing = argumentEnd(source, opening)
          if (closing === opening) break
          end = closing
        }
        const latex = source.slice(index, end)
        result += !inMath && mathCommands.has(command[1]) ? `\\ensuremath{${latex}}` : latex
        index = end
        continue
      }
    }
    if (!inMath && /[A-Za-z0-9]/.test(character)) {
      const token = /^[A-Za-z0-9()[\]{}.,+*/^_=\-]+/.exec(source.slice(index))?.[0] || character
      let depth = 0
      let balanced = true
      for (const symbol of token) {
        if (symbol === '{') depth += 1
        if (symbol === '}' && --depth < 0) balanced = false
      }
      if (/\^|=/.test(token) && !/[_^](?:[.,]*)$/.test(token) && balanced && depth === 0) {
        const expression = token.replace(/[.,]+$/, '')
        result += `\\ensuremath{${expression}}${token.slice(expression.length)}`
      } else result += token.replace(/[_{}^]/g, (symbol) => symbol === '^' ? '\\textasciicircum{}' : `\\${symbol}`)
      index += token.length
      continue
    }
    if (!inMath && '&%#_{}'.includes(character)) result += `\\${character}`
    else if (!inMath && character === '^') result += '\\textasciicircum{}'
    else result += character
    index += 1
  }
  return result
}
