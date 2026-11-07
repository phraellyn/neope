import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileScript, parse } from 'vue/compiler-sfc'

const componentPath = resolve('src/components/AuthGateway.vue')
let source = compileScript(parse(readFileSync(componentPath, 'utf8')).descriptor, { id: 'auth-gateway-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (target === 'firebase/auth') return 'const sendPasswordResetEmail = () => {}; const signInWithCustomToken = () => {}; const signInWithEmailAndPassword = () => { throw new Error("Unexpected teacher login") };'
  if (target === 'firebase/functions') return 'const httpsCallable = () => { throw new Error("Unexpected network call") };'
  if (target.includes('/services/firebase')) return 'const auth = {}; const functions = {}; const isLocalStudentDemo = false;'
  if (target.includes('/composables/useAppErrorToast')) return 'const showAppErrorToast = () => {};'
  return statement
})
const runtime = resolve('tests/.auth-gateway-runtime.mjs')
writeFileSync(runtime, source)
const oldWarn = console.warn
console.warn = () => {}
try {
  const { default: component } = await import(pathToFileURL(runtime))
  const state = component.setup({}, { expose() {} })
  state.email.value = 'ABC234'
  state.password.value = 'temporary-password'
  await state.teacherLogin()
  assert.equal(state.mode.value, 'student')
  assert.equal(state.studentCode.value, 'ABC234')
  assert.equal(state.studentClaimed.value, null)
  assert.equal(state.password.value, '')
  assert.match(state.notice.value, /código de alumno/)
  console.log('Un código introducido en el acceso de profesor abre la entrada de alumno.')
} finally {
  console.warn = oldWarn
  unlinkSync(runtime)
}
