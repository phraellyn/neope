import assert from 'node:assert/strict'

import {
  analyzeExerciseLatex,
  aggregateExerciseStructure,
  buildExerciseLatex,
  exerciseDocumentStructure,
  exerciseStructureFromDocument,
  mergeExerciseStructure,
} from '../src/utils/exerciseStructure.js'
import {
  codeForCompiler,
  compilationArtifacts,
  exerciseRenderProfiles,
} from '../functions/exerciseCompilation.js'

const source = String.raw`\ej\M{2,5}\T{12}\\
Enunciado global.
\begin{apartadosc}
\ap\p{1}\t{5} Primer apartado.
\lsol{uno}
\begin{solucion}
Desarrollo uno.
\end{solucion}

\ap\p{1,5}\t{7} Segundo apartado.
\sol{dos}
\begin{solucion}
Desarrollo dos.
\end{solucion}
\end{apartadosc}
\info{Origen}`

const analysis = analyzeExerciseLatex(source, {})
assert.equal(analysis.valid, true)
assert.equal(analysis.structure.apartados.length, 2)
assert.equal(analysis.structure.tiempo, 12)
assert.deepEqual(analysis.structure.apartados.map((part) => part.tiempo), [5, 7])

const structure = mergeExerciseStructure(analysis.structure, {})
const document = exerciseDocumentStructure(structure, {}, 1)
const restored = exerciseStructureFromDocument(document)
const rebuilt = buildExerciseLatex(restored, {
  includeSolutions: true,
  includeAnswers: true,
  preserveApartadosEnvironment: true,
})

assert.match(rebuilt, /\\begin\{apartadosc\}/)
assert.match(rebuilt, /\\lsol\{uno\}/)
assert.match(rebuilt, /\\sol\{dos\}/)
assert.match(rebuilt, /\\info\{Origen\}/)
assert.match(rebuilt, /\\T\{12\}/)
assert.match(rebuilt, /\\t\{5\}/)
assert.match(rebuilt, /\\t\{7\}/)

const documentLatex = buildExerciseLatex(restored, {
  includeSolutions: true,
  includeAnswers: true,
  preserveApartadosEnvironment: true,
  includeDurationMetadata: false,
})
assert.match(documentLatex, /\\M\{2,5\}/)
assert.match(documentLatex, /\\p\{1\}/)
assert.doesNotMatch(documentLatex, /\\T\{12\}/)
assert.doesNotMatch(documentLatex, /\\t\{5\}/)
assert.doesNotMatch(documentLatex, /\\t\{7\}/)

const artifacts = compilationArtifacts(document, 'demo', 1)
assert.equal(artifacts.length, 7)
assert.ok(artifacts.some((artifact) => artifact.key === 'pdf.statement'))
assert.ok(artifacts.some((artifact) => artifact.key === 'pdf.solved'))
assert.ok(artifacts.some((artifact) => artifact.key.endsWith('.statement.pdf')))
assert.ok(artifacts.some((artifact) => artifact.key.endsWith('.workedSolution.pdf')))

const statementArtifact = artifacts.find((artifact) => artifact.key === 'pdf.statement')
const solvedArtifact = artifacts.find((artifact) => artifact.key === 'pdf.solved')
const segmentArtifact = artifacts.find((artifact) => artifact.key.endsWith('.statement.pdf'))

assert.equal(statementArtifact.profile, exerciseRenderProfiles.statement)
assert.equal(solvedArtifact.profile, exerciseRenderProfiles.solved)
assert.equal(segmentArtifact.profile, exerciseRenderProfiles.segment)

const statementCompilerCode = codeForCompiler(statementArtifact.code, statementArtifact.profile)
assert.match(statementCompilerCode, /\\begin\{ejercicios\}/)
assert.match(statementCompilerCode, /\\ej/)
assert.doesNotMatch(statementCompilerCode, /\\refstepcounter\{ejercicio\}/)
assert.doesNotMatch(statementCompilerCode, /\\T\{12\}/)
assert.doesNotMatch(statementCompilerCode, /\\t\{5\}/)

const segmentCompilerCode = codeForCompiler(segmentArtifact.code, segmentArtifact.profile)
assert.match(segmentCompilerCode, /\\begin\{minipage\}\{8\.5cm\}/)
assert.doesNotMatch(segmentCompilerCode, /\\begin\{ejercicios\}/)
assert.doesNotMatch(segmentCompilerCode, /\\(?:ej|ap)\b/)

const aggregatedConcepts = aggregateExerciseStructure({
  contenidos: ['concepto-obsoleto'],
  contenidosGenerales: ['compartido'],
  apartados: [
    { id: 'a', contenidos: ['primero'] },
    { id: 'b', contenidos: ['segundo'] },
  ],
})
assert.deepEqual(aggregatedConcepts.apartados[0].contenidos, ['compartido', 'primero'])
assert.deepEqual(aggregatedConcepts.apartados[1].contenidos, ['compartido', 'segundo'])
assert.deepEqual(aggregatedConcepts.contenidos, ['compartido', 'primero', 'segundo'])
assert.equal(aggregatedConcepts.contenidos.includes('concepto-obsoleto'), false)

console.log(`exercise integration: ok (${artifacts.length} artifacts)`)
