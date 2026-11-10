import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'

const path = resolve('src/components/LatexErrorList.vue')
const runtime = resolve('tests/.latex-error-copy-runtime.mjs')
writeFileSync(runtime, compileScript(parse(readFileSync(path, 'utf8')).descriptor, { id: 'latex-error-copy-test' }).content)
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = globalThis.document
const oldWarn = console.warn
const copied = []
console.warn = () => {}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (value) => copied.push(value) } } })
try {
  const { default: component } = await import(pathToFileURL(runtime))
  const state = component.setup({ diagnostics: [{ id: 'e', location: 'Línea 4', message: 'Llave sin cerrar' }], log: 'Registro completo\nContexto LaTeX', stale: false }, { emit() {}, expose() {} })
  await state.copyText(state.diagnosticText({ location: 'Línea 4', message: 'Llave sin cerrar' }))
  assert.equal(copied[0], 'Línea 4: Llave sin cerrar')
  state.copyAll()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.match(copied[1], /Línea 4: Llave sin cerrar/)
  assert.match(copied[1], /Registro completo\nContexto LaTeX/)
  navigator.clipboard.writeText = async () => { throw new Error('Bloqueado') }
  let fallbackValue = ''
  globalThis.document = { createElement: () => ({ style: {}, select() { fallbackValue = this.value }, remove() {} }), body: { appendChild() {} }, execCommand: () => true }
  await state.copyText('Copia alternativa')
  assert.equal(fallbackValue, 'Copia alternativa')
  clearTimeout(state.copyStatusTimer)
  console.log('Errores LaTeX: copia individual, registro y alternativa verificados.')
} finally {
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  else delete globalThis.navigator
  if (originalDocument) globalThis.document = originalDocument
  else delete globalThis.document
  console.warn = oldWarn
  unlinkSync(runtime)
}
