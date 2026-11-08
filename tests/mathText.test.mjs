import assert from 'node:assert/strict'
import { renderMathText } from '../src/utils/mathText.js'

const inline = renderMathText('Calcula $x^2$ y \\(y+1\\).')
assert.equal(inline.filter((part) => part.html).length, 2)
assert.match(inline[1].html, /katex/)
assert.equal(inline[0].text, 'Calcula ')
assert.ok(renderMathText('$$x^2$$ y \\[y^2\\]').every((part) => part.html || part.text === ' y '))
assert.deepEqual(renderMathText('Sin cerrar $x'), [{ text: 'Sin cerrar $x' }])
assert.deepEqual(renderMathText('Mala $\\notacommand{x}$'), [{ text: 'Mala ' }, { text: '$\\notacommand{x}$' }])
assert.equal(renderMathText('<img src=x onerror=alert(1)>')[0].text, '<img src=x onerror=alert(1)>')
assert.equal(renderMathText('Precio \\$5 y $x$').filter((part) => part.html).length, 1)
console.log('Texto matemático: fórmulas, errores y contenido literal verificados.')
