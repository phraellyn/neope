import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { watch } from 'vue'

const componentPath = resolve('src/components/GroupProgramming.vue')
let source = compileScript(parse(readFileSync(componentPath, 'utf8')).descriptor, { id: 'programming-navigation-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (!target.startsWith('.')) return statement
  if (target.endsWith('.vue')) return `const ${bindings.trim()} = {};`
  if (target.includes('/services/') || target.includes('/composables/useAppErrorToast')) {
    const names = bindings.replace(/[{}\s]/g, '').split(',').filter(Boolean)
    return names.map((name) => {
      if (name === 'loadAndSynchronizeProgrammingDays') return `const ${name} = async () => globalThis.__programmingTestDays;`
      if (name === 'showAppErrorToast') return `const ${name} = () => {};`
      return `const ${name} = async () => [];`
    }).join('\n')
  }
  const path = new URL(target.endsWith('.js') ? target : `${target}.js`, pathToFileURL(componentPath))
  return `import ${bindings} from ${JSON.stringify(path.href)}`
})
const runtimePath = resolve('tests/.programming-navigation-runtime.mjs')
writeFileSync(runtimePath, source)
const oldWarn = console.warn
console.warn = () => {}
try {
  const { default: component } = await import(pathToFileURL(runtimePath))
  const state = component.setup({ group: { id: 'group' }, teacherId: 'teacher', calendar: {}, templates: [] }, { expose() {}, emit() {} })
  const today = state.todayIso()
  globalThis.__programmingTestDays = [{ id: 'today', date: today, resources: [], contents: [] }]
  const viewport = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }), scrollTo({ top }) { this.scrollTop = top } }
  state.programmingViewport.value = viewport
  watch(state.loading, (loading) => {
    if (!loading) state.registerDayElement('today', { getBoundingClientRect: () => ({ top: 400 - viewport.scrollTop }) })
  }, { flush: 'post' })
  await state.load()
  assert.equal(state.focusedDayId.value, 'today')
  assert.equal(viewport.scrollTop, 388, 'The day is positioned after the loading view is replaced')
  assert.equal(state.showReturnToToday.value, false)
  viewport.scrollTop = 600
  state.updateReturnToToday()
  assert.equal(state.showReturnToToday.value, true)
  state.returnToToday('instant')
  assert.equal(viewport.scrollTop, 388)
  assert.equal(state.showReturnToToday.value, false)
  console.log('La programación abre en la sesión actual y permite volver después de desplazarse.')
} finally {
  delete globalThis.__programmingTestDays
  console.warn = oldWarn
  unlinkSync(runtimePath)
}
