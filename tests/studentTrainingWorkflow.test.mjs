import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'

const path = resolve('src/components/StudentTraining.vue')
let source = compileScript(parse(readFileSync(path, 'utf8')).descriptor, { id: 'student-training-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (target === 'firebase/functions') return 'const httpsCallable = (_, name) => async (data) => ({ data: await globalThis.__trainingCall(name, data) });'
  if (!target.startsWith('.')) return statement
  if (target.endsWith('.vue')) return `const ${bindings.trim()} = {};`
  if (target.includes('/services/firebase')) return 'const functions = {};'
  if (target.includes('/utils/studentTrainingAudio')) return 'const unlockTrainingAudio = () => {};'
  return `import ${bindings} from ${JSON.stringify(new URL(target.endsWith('.js') ? target : `${target}.js`, pathToFileURL(path)).href)}`
})
const runtime = resolve('tests/.student-training-runtime.mjs')
writeFileSync(runtime, source)
const oldWarn = console.warn
console.warn = () => {}
let phase = 'none'
const calls = []
const segments = [{ id: 'p1', criteria: [{ id: 'c1', description: 'Resultado', points: 1 }] }]
globalThis.__trainingCall = async (name, data) => {
  calls.push({ name, data })
  if (name === 'loadStudentTraining') return { nodes: [{ id: 'a' }, { id: 'a1', parentId: 'a' }, { id: 'b' }], progress: {}, session: null }
  if (name === 'startStudentTraining') { phase = 'active'; return { id: 's', status: phase, timer: {}, selectedConceptIds: data.selectedConceptIds } }
  if (name === 'getStudentTrainingPdf') { assert.equal(data.kind, phase === 'review' ? 'solved' : 'statement'); return { data: btoa('%PDF-test') } }
  if (name === 'updateStudentTraining') {
    if (data.action === 'reveal') { phase = 'review'; return { session: { id: 's', status: phase, segments } } }
    if (data.action === 'complete') { assert.deepEqual(data.criteriaIds, ['p1:c1']); phase = 'complete'; return { session: null } }
  }
  throw new Error(`Unexpected request ${name}`)
}
try {
  const { default: component } = await import(pathToFileURL(runtime))
  const state = component.setup({ group: { id: 'group', subjectId: 'subject' } }, { expose() {}, emit() {} })
  await new Promise((done) => setTimeout(done, 0))
  state.toggleConcept('a1')
  assert.deepEqual(state.selected.value, ['a1'])
  assert.ok(state.displayedSelection.value.includes('a'), 'Ancestors are visible but are not explicitly selected')
  assert.equal(state.selected.value.includes('a'), false)
  await state.start()
  assert.equal(state.session.value.status, 'active')
  await state.action('reveal')
  assert.equal(state.session.value.status, 'review')
  state.selectedCriteria.value = ['p1:c1']
  await state.action('complete')
  assert.equal(state.session.value, null)
  assert.equal(calls.filter((call) => call.name === 'startStudentTraining').length, 1)
  state.clearPdf()
  console.log('Flujo del alumno: selección explícita, enunciado, solución y autoevaluación correctos.')
} finally {
  delete globalThis.__trainingCall
  console.warn = oldWarn
  unlinkSync(runtime)
}
