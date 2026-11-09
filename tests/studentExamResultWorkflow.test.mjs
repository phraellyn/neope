import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { reactive, nextTick } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'

const path = resolve('src/components/StudentExamResult.vue')
let source = compileScript(parse(readFileSync(path, 'utf8')).descriptor, { id: 'student-exam-result-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (target === 'firebase/functions') return 'const httpsCallable = () => async () => { globalThis.__examCalls++; return { data: { pdf: { data: btoa("%PDF-test") }, matrix: null } } };'
  if (target === 'vuetify') return 'const useDisplay = () => ({ width: { value: 400 } });'
  if (!target.startsWith('.')) return statement
  if (target.endsWith('.vue')) return `const ${bindings.trim()} = {};`
  if (target.includes('/services/firebase')) return 'const functions = {};'
  return `import ${bindings} from ${JSON.stringify(new URL(target.endsWith('.js') ? target : `${target}.js`, pathToFileURL(path)).href)}`
})
const runtime = resolve('tests/.student-exam-result-runtime.mjs')
writeFileSync(runtime, source)
const oldWarn = console.warn
console.warn = () => {}
globalThis.__examCalls = 0
try {
  const { default: component } = await import(pathToFileURL(runtime))
  const props = reactive({ groupId: 'group', itemId: 'exam', title: 'Examen', grade: '8', date: '', expanded: false })
  const state = component.setup(props, { emit() {}, expose() {} })
  await nextTick()
  assert.equal(globalThis.__examCalls, 0, 'A result does not download its PDF while collapsed')
  props.expanded = true
  await nextTick()
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(globalThis.__examCalls, 1)
  assert.ok(state.pdfUrl.value)
  props.expanded = false
  await nextTick()
  assert.equal(state.pdfUrl.value, '', 'Closing releases the downloaded PDF')
  console.log('Resultados: descarga bajo demanda y cierre de la tarjeta verificados.')
} finally {
  delete globalThis.__examCalls
  console.warn = oldWarn
  unlinkSync(runtime)
}
