import assert from 'node:assert/strict'
import { documentSourceContent, repairNestedLegacyDocument } from '../src/utils/latexDocumentSource.js'

const oldSource = String.raw`\input{../teoria}

\begin{document}
\begin{preview}
Análisis: $f(x)=x^2$.
\end{preview}
\end{document}`
assert.equal(documentSourceContent(oldSource, { stripPreview: true }), 'Análisis: $f(x)=x^2$.')
assert.equal(documentSourceContent(oldSource), String.raw`\begin{preview}
Análisis: $f(x)=x^2$.
\end{preview}`)
const fullSource = oldSource.replace('\\input{../teoria}', '\\documentclass{article}\n\\usepackage{amsmath}')
assert.equal(documentSourceContent(fullSource, { stripPreview: true }), 'Análisis: $f(x)=x^2$.')
assert.equal(documentSourceContent('Texto sin envoltura.'), 'Texto sin envoltura.')
assert.equal(documentSourceContent('\\input{contenido.tex}'), '\\input{contenido.tex}')
const literal = String.raw`😀 Ejemplo de código:
% \begin{document}
\begin{verbatim}
\input{../teoria}
\begin{document}
\end{document}
\end{verbatim}
\verb|\begin{document}|`
assert.equal(documentSourceContent(literal), literal)
assert.equal(repairNestedLegacyDocument(literal), literal)

const damaged = String.raw`\documentclass{book}
\newcommand{\miComando}{Contenido propio}
\begin{document}
\begin{preview}
\noindent\textbf{Análisis}\par
` + oldSource + String.raw`
\end{preview}
\end{document}`
const repaired = repairNestedLegacyDocument(damaged)
assert.equal((repaired.match(/\\begin\{document\}/g) || []).length, 1)
assert.equal((repaired.match(/\\begin\{preview\}/g) || []).length, 1)
assert.doesNotMatch(repaired, /\\input\{\.\.\/teoria\}/)
assert.match(repaired, /\\documentclass\{book\}/)
assert.match(repaired, /\\newcommand\{\\miComando\}/)
assert.match(repaired, /textbf\{Análisis\}/)
assert.match(repaired, /f\(x\)=x\^2/)
assert.equal(repairNestedLegacyDocument(repaired), repaired)
assert.equal(repairNestedLegacyDocument(fullSource), fullSource, 'Valid final code is never rebuilt from the template')
assert.equal(repairNestedLegacyDocument('\\begin{document}\nBorrador incompleto'), '\\begin{document}\nBorrador incompleto')
assert.throws(() => documentSourceContent('\\begin{document}\nTexto'), /falta/)
const pages = String.raw`\begin{preview}Página 1\end{preview}\begin{preview}Página 2\end{preview}`
assert.equal(documentSourceContent(pages, { stripPreview: true }), String.raw`Página 1\end{preview}\begin{preview}Página 2`)
console.log('LaTeX de origen: documentos antiguos, preview, contenido literal y recuperación correctos.')
