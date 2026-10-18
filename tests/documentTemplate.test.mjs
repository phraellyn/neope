import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canonicalFieldKey, isInternalTemplate, migrateDocumentTemplate, readDocumentTemplate, renderTemplateWrapper, splitFinalDocumentCode, templateHeader } from '../src/utils/documentTemplate.js'

const internal = { archivo: 'ejercicio.tex', codigo: readFileSync(new URL('../ejercicio.tex', import.meta.url), 'utf8') }
assert.equal(isInternalTemplate(internal), true)
assert.equal(migrateDocumentTemplate(internal).codigo, internal.codigo)
assert.equal(migrateDocumentTemplate(internal).migrated, false)
assert.equal(canonicalFieldKey('asignatura'), 'subject')
assert.equal(canonicalFieldKey('includeSolutions'), 'includeSolutions')

const legacy = String.raw`% \newcommand{\falso}[1]{#1 %% título %%}
\documentclass{article}
\newcommand{\logo}[4]{
  #1 %% asignatura %%
  #4 / #2 / #3 %% grupo, título, fecha %%
}
\newcommand{\pie}[1]{#1 %% autor %%}
\newenvironment{ejercicios}{}{}
`
const upgraded = migrateDocumentTemplate({ archivo: 'examen.tex', nombre: 'Examen', codigo: legacy })
assert.equal(upgraded.migrated, true)
assert.equal(migrateDocumentTemplate(upgraded).migrated, false)
const metadata = readDocumentTemplate(upgraded.codigo)
assert.equal(metadata.content, 'exercises')
assert.equal(metadata.assessment, true)
assert.equal(metadata.fields.some((field) => field.command === 'falso'), false)
const values = { subject: 'Matemáticas', title: 'Prueba', date: '12/10/26', course: '2ºBTO B', autor: 'Profesor' }
assert.equal(templateHeader(metadata, (field) => values[field.key]), String.raw`\logo{Matemáticas}{Prueba}{12/10/26}{2ºBTO B}
\pie{Profesor}`)

const custom = String.raw`% neope:document {"version":2,"content":"code","assessment":false,"command":"cabecera"}
% neope:field {"key":"title","argument":1}
\documentclass{article}
%%% previo: \begin{document}\begin{preview}
%%% previo: {{header}}
%%% final: \end{preview}\end{document}
`
const customMetadata = readDocumentTemplate(custom)
const finalCode = [custom, renderTemplateWrapper(customMetadata.before, customMetadata, () => 'Título'), 'Contenido.', customMetadata.after].join('\n')
const split = splitFinalDocumentCode(finalCode)
assert.match(split.preamble, /\\documentclass\{article\}/)
assert.equal(split.body, String.raw`\begin{preview}
\cabecera{Título}
Contenido.
\end{preview}`)
// A manual preamble edit must reach the compiler, independent of the template.
assert.match(splitFinalDocumentCode(finalCode.replace('{article}', '{book}')).preamble, /\\documentclass\{book\}/)
const oldCode = String.raw`\input{../examen}
\providecommand{\extra}{}
\begin{document}
Texto
\end{document}`
assert.match(splitFinalDocumentCode(oldCode, '\\documentclass{article}').preamble, /\\documentclass\{article\}/)
assert.equal(splitFinalDocumentCode(oldCode, 'preamble').body, 'Texto')
assert.throws(() => splitFinalDocumentCode('Texto incompleto'), /begin/)
assert.throws(() => readDocumentTemplate('% neope:document {"content":"otro"}'), /content/)

const collection = readDocumentTemplate(migrateDocumentTemplate({ archivo: 'coleccion.tex', nombre: 'Colección', codigo: legacy }).codigo)
assert.equal(collection.fields.find((field) => field.key === 'level').argument, 4)
assert.equal(collection.fields.some((field) => field.key === 'course'), false)
assert.equal(collection.fields.find((field) => field.key === 'date').hidden, true)
assert.equal(collection.fields.find((field) => field.key === 'includeSolutions').default, false)
const notes = readDocumentTemplate(migrateDocumentTemplate({ archivo: 'apuntes.tex', nombre: 'Apuntes', codigo: '\\documentclass{article}' }).codigo)
assert.equal(notes.content, 'code')
assert.equal(notes.fields.some((field) => field.key === 'title'), true)
assert.match(notes.before, /title/)
console.log('Plantillas: conversión, campos, comandos, envolturas y código final correctos.')
