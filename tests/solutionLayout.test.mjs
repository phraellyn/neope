import assert from 'node:assert/strict'

import {
  ensureAlignedInDisplayMath,
  hasLegacyDisplayMathDelimiters,
  hasTrailingInfoCommand,
  normalizeDisplayMathDelimiters,
  normalizeLatexTextAccents,
  splitAlignedRows,
  splitOverloadedCompactRows,
} from '../functions/solutionLayout.js'

const bareAligned = String.raw`Antes
\begin{aligned}A&=B\\&=C\end{aligned}
Después`
assert.equal(
  ensureAlignedInDisplayMath(bareAligned),
  String.raw`Antes
$$
\begin{aligned}A&=B\\&=C\end{aligned}
$$
Después`,
)
const wrappedAligned = String.raw`$$\begin{aligned}A&=B\end{aligned}$$`
assert.equal(ensureAlignedInDisplayMath(wrappedAligned), wrappedAligned)
const equationAligned = String.raw`\begin{equation}\begin{aligned}A&=B\end{aligned}\end{equation}`
assert.equal(ensureAlignedInDisplayMath(equationAligned), equationAligned)
assert.equal(
  normalizeLatexTextAccents(String.raw`Informaci\'on, Matem\'{a}ticas, ping\"uino y ni\~no.`),
  'Información, Matemáticas, pingüino y niño.',
)

const matrix = (value) => `\\begin{matrizp}${value}&0\\\\0&${value}\\end{matrizp}`

assert.equal(splitAlignedRows(`A&=${matrix('1')}\\\\&=${matrix('2')}`).length, 2)

const equalityChain = `$$\\begin{aligned}A^{-1}&=${matrix('1')}=${matrix('2')}\\end{aligned}$$`
const splitEquality = splitOverloadedCompactRows(equalityChain)
assert.equal((splitEquality.match(/\\begin\{matrizp\}/g) || []).length, 2)
assert.equal(splitAlignedRows(splitEquality.match(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/)[1]).length, 2)
assert.match(splitEquality, /=\\\\\n&=/)

const productAndResult = `$$\\begin{aligned}C^2&=${matrix('1')}\\cdot${matrix('2')}=${matrix('3')}\\end{aligned}$$`
const splitProduct = splitOverloadedCompactRows(productAndResult)
const productRows = splitAlignedRows(splitProduct.match(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/)[1])
assert.equal(productRows.length, 3)
assert.ok(productRows.every((row) => (row.match(/\\begin\{matrizp\}/g) || []).length <= 1))
assert.match(productRows[1].trimStart(), /^&\\quad\{\}\\cdot/)

const alreadyValid = `$$\\begin{aligned}A&=${matrix('1')}=\\\\&=${matrix('2')}\\end{aligned}$$`
assert.equal(splitOverloadedCompactRows(alreadyValid), alreadyValid)

const implicitProduct = `$$\\begin{aligned}A^2&=${matrix('1')} ${matrix('2')}\\end{aligned}$$`
const splitImplicitProduct = splitOverloadedCompactRows(implicitProduct)
const implicitRows = splitAlignedRows(splitImplicitProduct.match(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/)[1])
assert.equal(implicitRows.length, 2)
assert.match(implicitRows[1].trimStart(), /^&\\quad\{\}\\cdot/)

const transposedProduct = `$$\\begin{aligned}C&=${matrix('1')}^t ${matrix('2')}\\end{aligned}$$`
const splitTransposedProduct = splitOverloadedCompactRows(transposedProduct)
assert.match(splitTransposedProduct, /\\end\{matrizp\}\^t\\\\\n&\\quad\{\}\\cdot/)

const legacyDisplay = String.raw`Texto antes \[
  A=B
\] texto después.`
assert.equal(normalizeDisplayMathDelimiters(legacyDisplay), 'Texto antes $$A=B$$ texto después.')
assert.equal(hasLegacyDisplayMathDelimiters(legacyDisplay), true)

const spacedRows = String.raw`\begin{array}{lc}x+1,&x<2\\[5pt]2x-1,&x>2\end{array}`
assert.equal(normalizeDisplayMathDelimiters(spacedRows), spacedRows)
assert.equal(hasLegacyDisplayMathDelimiters(spacedRows), false)

const infoWithRegexCharacters = String.raw`\ej Ejercicio
\info{Junio 2019 (coincidencias) -- B1}`
assert.equal(hasTrailingInfoCommand(infoWithRegexCharacters, 'Junio 2019 (coincidencias) -- B1'), true)
assert.equal(hasTrailingInfoCommand(`${infoWithRegexCharacters}\nTexto posterior`, 'Junio 2019 (coincidencias) -- B1'), false)

console.log('solution layout: ok')
