// Exercise the component's actual setup state and compilation flow, with only
// browser I/O and Firebase I/O replaced. No teacher data is touched.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { nextTick } from 'vue'

const componentPath = resolve('src/components/DocumentCreator.vue')
let source = compileScript(parse(readFileSync(componentPath, 'utf8')).descriptor, { id: 'workflow-test' }).content
source = source.replace(/import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/g, (statement, bindings, quote, target) => {
  if (!target.startsWith('.')) return statement
  if (target.endsWith('.vue')) return `const ${bindings.trim()} = {};`
  if (target.includes('/services/')) {
    const names = bindings.replace(/[{}\s]/g, '').split(',')
    return names.map((name) => `const ${name} = ${name === 'auth' ? '{ currentUser: { getIdToken: async () => "test-token" } }' : '(async () => { throw new Error("Unexpected Firebase operation"); })'};`).join('\n')
  }
  const path = new URL(target.endsWith('.js') ? target : `${target}.js`, pathToFileURL(componentPath))
  return `import ${bindings} from ${JSON.stringify(path.href)}`
})
const runtimePath = resolve('tests/.document-creator-runtime.mjs')
writeFileSync(runtimePath, source)
const oldFetch = globalThis.fetch
const oldWindow = globalThis.window
const oldCancelAnimationFrame = globalThis.cancelAnimationFrame
const oldRequestAnimationFrame = globalThis.requestAnimationFrame
const oldWarn = console.warn
const requests = []
globalThis.window = { confirm: () => true, cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1 }
globalThis.cancelAnimationFrame = () => {}
globalThis.requestAnimationFrame = () => 1
globalThis.fetch = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) })
  if (url.endsWith('/preambles')) return new Response('{}', { status: 200 })
  if (url.endsWith('/compile')) return new Response('%PDF-test', { status: 200, headers: { 'Content-Type': 'application/pdf' } })
  throw new Error(`Unexpected request: ${url}`)
}
console.warn = (message, ...args) => { if (!String(message).startsWith('[Vue warn]')) oldWarn(message, ...args) }
try {
  const { default: component } = await import(pathToFileURL(runtimePath))
  const makeTemplate = (id, label) => ({ id, archivo: `${id}.tex`, nombre: id, codigo: String.raw`% neope:document {"version":2,"content":"code","assessment":false,"command":""}
% neope:field {"key":"subject","label":"${label}","type":"subject","formOnly":true}
% neope:field {"key":"title","label":"Título","formOnly":true}
\documentclass{article}
%%% previo: \begin{document}
%%% previo: {{title}}
%%% final: \end{document}` })
  const props = { templates: [makeTemplate('a', 'Asignatura'), makeTemplate('b', 'Materia'), { id: 'internal', archivo: 'ejercicio.tex', codigo: '\\documentclass{article}' }], exercises: [], conceptNodes: [], subjectSelections: {}, exerciseCounts: {}, teacherProfile: { centros: [] }, groups: [], compilerBaseUrl: '/compiler-api/v1', aiModel: 'test', aiModelOptions: [], libraryQuery: '', hasMoreExercises: false, loadingMoreExercises: false }
  const state = component.setup(props, { expose() {}, emit() {} })
  state.newDocument()
  assert.equal(state.documentTemplates.value.length, 2, 'Internal template must be hidden')
  state.selectTemplate(state.documentTemplates.value[0])
  state.addTemplateToQueue(state.documentTemplates.value[1])
  assert.equal(state.requiresExercises.value, false)
  assert.equal(state.contentWorkspaceMode.value, 'latex')
  assert.equal(state.unifiedFields.value.filter((field) => field.key === 'subject').length, 1, 'Shared fields use their semantic key')
  state.fieldValues.subject = 'Matemáticas'
  state.fieldValues.title = 'Título inicial'
  state.sourceLatexCode.value = 'Contenido inicial.'
  state.currentStep.value = 3
  await state.compileDocument(true)
  assert.deepEqual(state.previewDocuments.value.map((entry) => entry.templateKey), ['a', 'b'])
  state.openFinalCode('a')
  state.editingFinalCode.value = state.editingFinalCode.value.replace('{article}', '{book}').replace('Contenido inicial.', 'Contenido editado.')
  state.fieldValues.title = 'Otro título'
  assert.match(state.activeDocumentCode(state.selectedTemplates.value[0]), /Contenido editado/)
  await state.compileEditingFinalCode()
  assert.equal(state.editingCodeIsCompiled.value, true)
  assert.match(requests.filter((entry) => entry.url.endsWith('/preambles')).at(-1).body.content, /\\documentclass\{book\}/)
  assert.match(requests.filter((entry) => entry.url.endsWith('/compile')).at(-1).body.code, /Contenido editado/)
  assert.deepEqual(state.previewDocuments.value.map((entry) => entry.templateKey), ['a', 'b'], 'Compiling one result preserves the other and their order')
  const saved = {
    id: 'saved', plantillas: props.templates.slice(0, 2).map((template) => ({ ...template, key: template.id })), campos: { ...state.fieldValues },
    content: state.serializeDocumentContent(state.documentContent.value),
    codigos: Object.fromEntries(state.previewDocuments.value.map((entry) => [entry.templateKey, entry.code])),
    pdfs: state.previewDocuments.value.map((entry) => ({ templateKey: entry.templateKey, url: entry.url, path: '' })),
    pdf: { url: state.previewDocuments.value[0].url }, assessment: { evaluable: false },
  }
  state.editDocument(saved)
  assert.match(state.activeDocumentCode(state.selectedTemplates.value[0]), /Contenido editado/)
  state.openFinalCode('a')
  state.regenerateFinalCode()
  assert.doesNotMatch(state.editingFinalCode.value, /Contenido editado/)
  assert.match(state.editingFinalCode.value, /Otro título/)
  assert.equal(state.editingCodeIsCompiled.value, false)
  await state.viewDocument(saved)
  state.openFinalCode('a')
  assert.match(state.editingFinalCode.value, /Contenido editado/)
  assert.equal(state.mode.value, 'viewer')
  props.templates = []
  state.editDocument(saved)
  assert.equal(state.selectedTemplates.value.length, 2, 'Saved preambles allow reopening when templates are removed')
  const bankTemplate = makeTemplate('bank', 'Asignatura')
  bankTemplate.codigo = bankTemplate.codigo.replace('"content":"code"', '"content":"exercises"') + String.raw`
% neope:field {"key":"includeInfo","type":"checkbox","default":true,"formOnly":true}
% neope:field {"key":"includeAnswers","type":"checkbox","default":true,"formOnly":true}
% neope:field {"key":"includeSolutions","type":"checkbox","default":false,"formOnly":true}
\newcommand{\sol}[1]{#1}
\newcommand{\lsol}[1]{#1}
\newcommand{\info}[1]{#1}
\newenvironment{solucion}{}{}`
  const exercise = { id: 'exercise', enunciado: String.raw`\ej \M{1}\\ Calcula $1+1$.
\lsol{2}
\begin{solucion}Sumamos y obtenemos dos.\end{solucion}
\info{Origen}`, curriculum: { course: '2ºBTO', subjectId: '2bto-matematicas-ii' } }
  const bank = component.setup({ ...props, templates: [bankTemplate], exercises: [exercise] }, { expose() {}, emit() {} })
  bank.selectTemplate(bank.documentTemplates.value[0])
  bank.documentCurriculum.value = { course: '2ºBTO', subjectId: '2bto-matematicas-ii', conceptIds: [] }
  assert.equal(bank.requiresExercises.value, true)
  assert.equal(bank.matchingExercises.value.length, 1)
  bank.exerciseQueue.value = [bank.createExerciseDocumentBlock('exercise')]
  const documentBody = () => bank.generatedCodeForTemplate(bank.selectedTemplates.value[0]).split('\\begin{document}').at(-1)
  assert.match(documentBody(), /\\lsol\{2\}/)
  assert.match(documentBody(), /\\info\{Origen\}/)
  assert.doesNotMatch(documentBody(), /\\begin\{solucion\}/)
  bank.fieldValues.includeInfo = false
  bank.fieldValues.includeAnswers = false
  bank.fieldValues.includeSolutions = true
  assert.doesNotMatch(documentBody(), /\\lsol\{2\}|\\info\{Origen\}/)
  assert.match(documentBody(), /\\begin\{solucion\}/)
  const examTemplate = makeTemplate('exam', 'Asignatura')
  examTemplate.codigo = examTemplate.codigo.replace('"assessment":false', '"assessment":true') + String.raw`
% neope:field {"key":"level","type":"level","formOnly":true}
% neope:field {"key":"course","type":"group","formOnly":true}
% neope:field {"key":"date","type":"date","formOnly":true}`
  const contextual = component.setup({ ...props, templates: [examTemplate], groups: [{ id: 'group', nombre: '2ºBTO B', curso: '2ºBTO', asignatura: 'Matemáticas II', subjectId: '2bto-matematicas-ii' }] }, { expose() {}, emit() {} })
  contextual.newDocumentWithContext({ groupId: 'group', date: '2026-10-12' })
  contextual.selectTemplate(contextual.documentTemplates.value[0])
  assert.equal(contextual.fieldValues.level, '2ºBTO')
  assert.equal(contextual.fieldValues.course, '2ºBTO B')
  assert.equal(contextual.fieldValues.date, '2026-10-12')
  contextual.fieldValues.level = '1ºESO'
  contextual.onFieldInput(contextual.unifiedFields.value.find((field) => field.key === 'level'))
  assert.equal(contextual.fieldValues.course, '', 'Changing level clears an incompatible group')
  const notesTemplate = makeTemplate('notes', 'Asignatura')
  notesTemplate.codigo = notesTemplate.codigo.replace('%%% previo: \\begin{document}', '%%% previo: \\begin{document}\\begin{preview}')
    .replace('%%% final: \\end{document}', '%%% final: \\end{preview}\\end{document}')
  const notes = component.setup({ ...props, templates: [notesTemplate] }, { expose() {}, emit() {} })
  notes.selectTemplate(notes.documentTemplates.value[0])
  notes.fieldValues.title = 'Análisis'
  const oldNotesSource = String.raw`\input{../teoria}
\begin{document}
\begin{preview}
Contenido recuperado.
\end{preview}
\end{document}`
  notes.sourceLatexCode.value = oldNotesSource
  notes.currentStep.value = 3
  await notes.compileDocument(true)
  const compiledBody = requests.filter((entry) => entry.url.endsWith('/compile')).at(-1).body.code
  assert.doesNotMatch(compiledBody, /\\input\{\.\.\/teoria\}|\\begin\{document\}/)
  assert.equal((compiledBody.match(/\\begin\{preview\}/g) || []).length, 1)
  assert.match(compiledBody, /Contenido recuperado/)
  // Reproduce a stored final code assembled by the old broken path.
  notes.finalCodes.notes = notes.generatedCodeForTemplate(notes.selectedTemplates.value[0]).replace('Contenido recuperado.', oldNotesSource)
  notes.openFinalCode('notes')
  assert.doesNotMatch(notes.editingFinalCode.value, /\\input\{\.\.\/teoria\}/)
  assert.match(notes.editingFinalCode.value, /Contenido recuperado/)
  await notes.compileEditingFinalCode()
  assert.equal(notes.editingCodeIsCompiled.value, true)
  const brokenSaved = { id: 'broken', plantillas: [{ ...notesTemplate, key: 'notes' }], campos: { ...notes.fieldValues }, content: notes.serializeDocumentContent(notes.documentContent.value), codigos: { notes: notes.generatedCodeForTemplate(notes.selectedTemplates.value[0]).replace('Contenido recuperado.', oldNotesSource) }, pdfs: [{ templateKey: 'notes', url: 'https://example.invalid/old.pdf' }], pdf: { url: 'https://example.invalid/old.pdf' } }
  notes.editDocument(brokenSaved)
  notes.openFinalCode('notes')
  assert.doesNotMatch(notes.editingFinalCode.value, /\\input\{\.\.\/teoria\}/)
  assert.equal(notes.editingCodeIsCompiled.value, false, 'Recovered code must be compiled before treating an old PDF as current')
  await nextTick()
  console.log('Creador: campos compartidos, código por resultado, recompilación, regeneración y reapertura correctos.')
} finally {
  globalThis.fetch = oldFetch
  globalThis.window = oldWindow
  globalThis.cancelAnimationFrame = oldCancelAnimationFrame
  globalThis.requestAnimationFrame = oldRequestAnimationFrame
  console.warn = oldWarn
  unlinkSync(runtimePath)
}
