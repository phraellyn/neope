import assert from 'node:assert/strict'

import { prettyPrintLatex } from '../src/utils/latexPrettyPrint.js'

const source = String.raw`\ej\M{2,5}\T{10}\\

Texto del enunciado.
\begin{apartados}
\ap Primer apartado.
\end{apartados}`

const formatted = prettyPrintLatex(source)
assert.match(formatted, /^\\ej\\M\{2,5\}\\T\{10\}\\\\\nTexto del enunciado\./)
assert.doesNotMatch(formatted, /\\salto/)
assert.equal((formatted.match(/\\ej/g) || []).length, 1)
assert.equal((formatted.match(/\\ap/g) || []).length, 1)

const explicitPageBreak = `${source}\n\\salto`
assert.equal((prettyPrintLatex(explicitPageBreak).match(/\\salto/g) || []).length, 1)

console.log('latex pretty print: ok')
