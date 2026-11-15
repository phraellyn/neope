import assert from 'node:assert/strict'
import { renderMathText } from '../src/utils/mathText.js'

const parts = renderMathText('Hola 😊\n¿Cuánto vale $x^2$?\n$$\\frac{1}{2}$$')
assert.equal(parts[0].text, 'Hola 😊\n¿Cuánto vale ')
assert.match(parts[1].html, /katex/)
assert.equal(parts[2].text, '?\n')
assert.match(parts[3].html, /katex-display/)
const invalid = renderMathText('Texto $\\comandoInexistente{x}$ final')
assert.equal(invalid[1].text, '$\\comandoInexistente{x}$')
assert.equal(renderMathText('<img src=x onerror=alert(1)>')[0].text, '<img src=x onerror=alert(1)>')
assert.equal(renderMathText('Un salto\ny emojis 🎓')[0].text, 'Un salto\ny emojis 🎓')
console.log('Mensajes: fórmulas, texto, saltos y errores de sintaxis verificados.')
