import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createRenderer, nextTick } from 'vue'

const componentPath = resolve('src/components/Gradebook.vue')
let source = compileScript(parse(readFileSync(componentPath, 'utf8')).descriptor, { id: 'gradebook-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (!target.startsWith('.')) return statement
  if (target.endsWith('.vue')) return `const ${bindings.trim()} = {};`
  if (target.includes('/services/')) {
    const names = bindings.replace(/[{}\s]/g, '').split(',').filter(Boolean)
    return names.map((name) => {
      if (name === 'loadStudentIdentitiesForGroup') return `const ${name} = async () => new Map([['student', { nombre: '', nombreCorto: '' }]]);`
      if (name === 'studentIdentityDiagnostics') return `const ${name} = () => ({ failed: false });`
      return `const ${name} = async () => [];`
    }).join('\n')
  }
  const path = new URL(target.endsWith('.js') ? target : `${target}.js`, pathToFileURL(componentPath))
  return `import ${bindings} from ${JSON.stringify(path.href)}`
})
const runtimePath = resolve('tests/.gradebook-configuration-runtime.mjs')
writeFileSync(runtimePath, source)
const oldWarn = console.warn
console.warn = () => {}
try {
  const { default: component } = await import(pathToFileURL(runtimePath))
  const renderer = createRenderer({
    createElement: (type) => ({ type }), createText: (text) => ({ text }), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode() {}, nextSibling() {},
  })
  const group = { id: 'group', nombre: '2 ESO A', alumnos: [{ id: 'student' }], evaluaciones: { estructura: [
    { id: 'item', type: 'item', nombre: 'Prueba' }, { id: 'target', type: 'group', nivel: 2, nombre: 'Grupo', children: [] },
  ], resultados: {}, pesos: {} } }
  const vm = renderer.createApp(component, { group, configurationMode: true }).mount({})
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0))
  await nextTick()
  const state = vm.$.setupState
  assert.deepEqual(vm.getStudentChanges(), { identities: false, roster: false })
  state.moveItemIntoGroup('item', 'target')
  assert.equal(state.localGroup.evaluaciones.estructura[0].children[0].id, 'item')
  assert.deepEqual(vm.getStudentChanges(), { identities: false, roster: false }, 'Moving columns must not require saving student identities')
  vm.addStudent()
  assert.deepEqual(vm.getStudentChanges(), { identities: true, roster: true }, 'Adding a student must still validate and save their identity')
  const appSource = readFileSync(resolve('src/App.vue'), 'utf8')
  const saveSource = appSource.slice(appSource.indexOf('async function saveGradebook('), appSource.indexOf('async function toggleGradebookConfiguration('))
  let identityWrites = 0
  let cloudWrites = 0
  const scope = {
    gradebookSavePromise: null, gradebookDirty: { value: true }, gradebookValid: { value: false },
    firestoreError: { value: '' }, isSavingGradebook: { value: false }, currentTeacherId: { value: 'teacher' },
    teacherGroups: { value: [{ id: 'group', alumnos: [] }] },
    gradebookRef: { value: {
      getStudentChanges: () => ({ identities: false, roster: false }), getRevision: () => 1,
      getGroup: () => ({ id: 'group', alumnos: [] }), persistLocalIdentities: async () => { identityWrites += 1 },
      markSaved: () => { scope.gradebookDirty.value = false },
    } },
    saveGroup: async (group) => { cloudWrites += 1; return group },
    scheduleGradebookAccessCodeSync: () => new Promise(() => {}),
  }
  const save = Function('scope', `with (scope) { ${saveSource}; return saveGradebook }`)(scope)
  assert.equal(await save({ includeIdentities: true }), true, 'Existing missing names cannot block a structure-only change')
  assert.equal(cloudWrites, 1)
  assert.equal(identityWrites, 0)
  scope.gradebookDirty.value = true
  scope.gradebookRef.value.getStudentChanges = () => ({ identities: true, roster: true })
  assert.equal(await save({ includeIdentities: true }), false, 'Invalid newly changed identities must still block their save')
  assert.equal(cloudWrites, 1)
  console.log('La agrupación de columnas no modifica identidades; añadir alumnos sí.')
} finally {
  console.warn = oldWarn
  unlinkSync(runtimePath)
}
