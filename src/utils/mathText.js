import katex from 'katex'

// El texto fuera de las fórmulas sigue siendo texto, nunca HTML interpretado.
export function renderMathText(value) {
  const text = String(value ?? '')
  const pattern = /(?<!\\)(\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\])/g
  const parts = []
  let position = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > position) parts.push({ text: text.slice(position, match.index) })
    const expression = match[2] ?? match[3] ?? match[4] ?? match[5]
    try {
      parts.push({ html: katex.renderToString(expression, { displayMode: match[2] !== undefined || match[5] !== undefined, throwOnError: true, trust: false, strict: 'ignore' }) })
    } catch {
      parts.push({ text: match[0] })
    }
    position = match.index + match[0].length
  }
  if (position < text.length) parts.push({ text: text.slice(position) })
  return parts
}
