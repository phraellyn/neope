import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { appendShortAnswers, canonicalFieldKey, ensureShortAnswerTikzCompatibility, ensureTikzPaddingCompatibility, isInternalTemplate, migrateDocumentTemplate, readDocumentTemplate, renderTemplateWrapper, splitFinalDocumentCode, templateHeader, upgradeExerciseCollectionHeader } from '../src/utils/documentTemplate.js'

const answersBody = String.raw`\begin{ejercicios}
\ej Enunciado. \lsol{$x=1$}
\ej \begin{apartados}\ap Enunciado. \sol{$2$}\end{apartados}
\end{ejercicios}`
const answersInside = answersBody.replace('\\end{ejercicios}', '\n\\soluciones\n\\end{ejercicios}')
assert.equal(appendShortAnswers(answersBody, { enabled: true, supported: true }), answersInside)
assert.equal(appendShortAnswers(answersBody, { enabled: false, supported: true }), answersBody)
assert.equal(appendShortAnswers(answersBody, { enabled: true, supported: false }), answersBody)
assert.equal(appendShortAnswers(answersInside, { enabled: true, supported: true }), answersInside)
const movedAnswers = appendShortAnswers(`${answersBody}\n\\soluciones`, { enabled: true, supported: true })
assert.match(movedAnswers, /\\soluciones\s*\\end\{ejercicios\}/)
assert.equal((movedAnswers.match(/\\soluciones\b/g) || []).length, 1)
const movedBreak = appendShortAnswers(`${answersBody}\n\\columnbreak\n\\soluciones`, { enabled: true, supported: true })
assert.match(movedBreak, /\\columnbreak\s*\\soluciones\s*\\end\{ejercicios\}/)
const inlineBreak = appendShortAnswers(`${answersBody}\\columnbreak\\soluciones`, { enabled: true, supported: true })
assert.match(inlineBreak, /\\columnbreak\s*\\soluciones\s*\\end\{ejercicios\}/)
assert.equal(appendShortAnswers(answersBody, { enabled: true, supported: true, after: '\\soluciones\n\\end{document}' }), answersBody)
assert.equal(appendShortAnswers('% \\sol{oculta}', { enabled: true, supported: true }), '% \\sol{oculta}')
assert.equal(appendShortAnswers('% \\soluciones\n\\lsol{$1$}', { enabled: true, supported: true }), '% \\soluciones\n\\lsol{$1$}')

const tikzPaddingDocument = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\lsol{\tikz[scale=0.45,padding=0]{\draw (0,0) -- (2,0);}}
\soluciones
\end{document}`
const fixedPaddingDocument = ensureTikzPaddingCompatibility(tikzPaddingDocument)
assert.match(fixedPaddingDocument, /\\tikzset\{padding\/\.style=\{inner sep=#1\}\}/)
assert.ok(fixedPaddingDocument.indexOf('\\tikzset') < fixedPaddingDocument.indexOf('\\begin{document}'))
assert.equal(ensureTikzPaddingCompatibility(fixedPaddingDocument), fixedPaddingDocument)
assert.equal(ensureTikzPaddingCompatibility(tikzPaddingDocument.replace('padding=0', 'inner sep=0')), tikzPaddingDocument.replace('padding=0', 'inner sep=0'))
assert.equal(ensureTikzPaddingCompatibility(tikzPaddingDocument.replace('\\usepackage{tikz}', '')), tikzPaddingDocument.replace('\\usepackage{tikz}', ''))
const legacyArrows = String.raw`\documentclass{article}
\def\sol#1{\g@addto@macro\soluciones{#1}}
\def\lsol#1{\g@addto@macro\soluciones{#1}}
\begin{document}
\lsol{\tikz{\draw[->] (0,0) -- (1,0);}}
\soluciones
\end{document}`
const fixedArrows = ensureShortAnswerTikzCompatibility(legacyArrows)
assert.match(fixedArrows, /\\def\\lsol\{\\begingroup\\shorthandoff\{<>\}/)
assert.equal(ensureShortAnswerTikzCompatibility(fixedArrows), fixedArrows)
assert.equal(ensureShortAnswerTikzCompatibility(legacyArrows.replace('->', '--')), legacyArrows.replace('->', '--'))
assert.equal(ensureShortAnswerTikzCompatibility(legacyArrows.replaceAll('\\g@addto@macro', '\\othermacro')), legacyArrows.replaceAll('\\g@addto@macro', '\\othermacro'))

const internal = { archivo: 'ejercicio.tex', codigo: readFileSync(new URL('../ejercicio.tex', import.meta.url), 'utf8') }
const standardCollection = readFileSync(new URL('../templates/ejercicios.tex', import.meta.url), 'utf8')
assert.match(standardCollection, /at \(0\.95,-0\.27\) \{\\sffamily\\large\\bfseries #2\}/, 'La segunda línea contiene el título sin repetir el nivel')
const oldCollection = { archivo: 'ejercicios.tex', codigo: String.raw`% neope:document {"version":2,"content":"exercises"}
\newcommand{\logo}[4]{
\node at (13.0,0.55) {#4};
}
\newenvironment{ejercicios}{}{}` }
const upgradedCollection = upgradeExerciseCollectionHeader(oldCollection, standardCollection)
assert.match(upgradedCollection.codigo, /\\newcommand\{\\logo\}\[5\]/)
assert.equal(readDocumentTemplate(upgradedCollection.codigo).fields.find((field) => field.key === 'center')?.argument, 5)
assert.equal(upgradeExerciseCollectionHeader({ ...oldCollection, archivo: 'otra.tex' }, standardCollection).codigo, oldCollection.codigo)
assert.equal(upgradeExerciseCollectionHeader({ ...oldCollection, codigo: oldCollection.codigo.replace('13.0,0.55', '12.0,0.55') }, standardCollection).codigo.includes('\\logo}[4]'), true)
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
