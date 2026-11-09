import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStudentAccessCardsPdf } from '../src/utils/studentAccessCards.js'

const alphabet = '123456789'
const codeFor = (index) => `ABC${alphabet[Math.floor(index / 81) % 9]}${alphabet[Math.floor(index / 9) % 9]}${alphabet[index % 9]}`
const students = Array.from({ length: 31 }, (_, index) => ({ id: codeFor(index), nombre: index === 0 ? 'Álvarez Núñez, Inés' : `Alumno número ${index + 1}` }))
students.splice(1, 0, null, { id: 'DEF123', nombre: '' }, { id: 'GHJ123', nombre: '张伟' }, { id: 'KLM123', nombre: 'Nombre '.repeat(250) }, { id: 'MNP123', get nombre() { throw new Error('Ficha inaccesible') } })
const font = readFileSync(new URL('../src/assets/fonts/DejaVuSans.ttf', import.meta.url)).toString('base64')
const originalFetch = globalThis.fetch
globalThis.fetch = () => { throw new Error('La generación del PDF no debe usar la red') }
let result
try { result = createStudentAccessCardsPdf(students, font) } finally { globalThis.fetch = originalFetch }
assert.equal(result.count, 31)
assert.deepEqual(result.omitted, ['(sin código)', 'DEF123', 'GHJ123', 'KLM123', 'MNP123'])
assert.equal(result.pdf.getNumberOfPages(), 2, 'Cada página contiene como máximo 30 tarjetas')
const bytes = new Uint8Array(result.pdf.output('arraybuffer'))
assert.ok(bytes.length > 1000)
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const loading = getDocument({ data: bytes, useSystemFonts: false })
const document = await loading.promise
const first = await (await document.getPage(1)).getTextContent()
const text = first.items.map((item) => item.str).join(' ')
assert.match(text, /Álvarez Núñez, Inés/, 'Se conservan nombres y acentos')
assert.match(text, /ABC111/, 'El código se muestra sin cambios')
assert.match(text, /Alumno número 2/, 'Las fichas posteriores a las omitidas también aparecen')
await loading.destroy()
const empty = createStudentAccessCardsPdf([{ id: 'DEF123', nombre: '' }], font)
assert.equal(empty.pdf, null)
console.log('Tarjetas locales: privacidad, nombres, omisiones y paginación verificadas.')
