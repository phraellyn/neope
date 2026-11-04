import assert from 'node:assert/strict'
import { ref } from 'vue'
import { planDocumentVariation } from '../functions/documentVariationPlan.js'
import { columnBreakSignature, documentVariationHandlers } from '../functions/documentVariations.js'
import { applyDocumentVariationEdits, documentExerciseRanges, documentVariationEdits, matchTemplateColumnBreaks, replaceVariationBlocks, variationBlockCode, variationCommandBlocks } from '../src/utils/documentVariation.js'
import { useDocumentVariation } from '../src/composables/useDocumentVariation.js'

const slots = [{ slotId: 'first', sourceExerciseId: 'old-a', conceptIds: ['a'], partCount: 0, latex: '\\ej Original A' }, { slotId: 'second', sourceExerciseId: 'old-b', conceptIds: ['b'], partCount: 2, latex: '\\ej Original B' }]
const plan = planDocumentVariation({ slots, mode: 'variant', conceptIds: ['a', 'b', 'c'], candidates: [{ exerciseId: 'a-and-c', version: 0, conceptIds: ['a', 'c'], partCount: 0 }, { exerciseId: 'old-b', conceptIds: ['b'], partCount: 2 }] })
assert.equal(plan.slots[0].exerciseId, 'a-and-c')
assert.equal(plan.slots[1].origin, 'new', 'Original exercises are not mistaken for new bank selections')
assert.deepEqual(new Set(plan.slots.flatMap((slot) => slot.requiredConceptIds)), new Set(['a', 'b', 'c']))
assert.deepEqual(planDocumentVariation({ slots, mode: 'cloned' }).slots.map((slot) => slot.origin), ['cloned', 'cloned'])
const redistributed = planDocumentVariation({ mode: 'variant', slots: [{ ...slots[0], conceptIds: ['a', 'b'] }, { ...slots[1], conceptIds: ['c'] }], candidates: [{ exerciseId: 'ac', conceptIds: ['a', 'c'] }, { exerciseId: 'b', conceptIds: ['b'] }] })
assert.equal(redistributed.newCount, 0, 'A variant can redistribute topics instead of unnecessarily creating new exercises')
assert.deepEqual(new Set(redistributed.slots.flatMap((slot) => slot.requiredConceptIds)), new Set(['a', 'b', 'c']))
const tree = [{ type: 'tool', blockId: 'optional', toolId: 'choice', args: { count: 1 }, children: [{ type: 'exercise', blockId: 'first', exerciseId: 'old-a', section: 'optional', pageBreakBefore: true, metrics: { puntuacion: 4 } }] }]
const replaced = replaceVariationBlocks(tree, new Map([['first', { exerciseId: 'new-a', snapshot: { id: 'new-a' } }]]))
assert.deepEqual(replaced[0].args, tree[0].args)
assert.equal(replaced[0].children[0].section, 'optional')
assert.equal(replaced[0].children[0].pageBreakBefore, true)
assert.equal(replaced[0].children[0].metrics.puntuacion, 4)
assert.equal(tree[0].children[0].exerciseId, 'old-a')

const code = String.raw`\documentclass{article}
\newcommand{\ejemplo}{Texto con \ej dentro de una definición}
\begin{document}
Instrucciones intactas.
\begin{ejercicios}
\ej Primero.
\salto
\begin{optativos}
\ej Segundo.
\end{optativos}
\end{ejercicios}
Pie intacto.
\end{document}`
const edits = documentVariationEdits(code, [{ slotId: 'first', code: '\\ej No coincide' }, { slotId: 'second', code: '\\ej Tampoco' }], { environments: ['optativos'] })
assert.equal(edits.length, 2)
const changed = applyDocumentVariationEdits(code, edits, (id) => variationBlockCode(id, `\\ej Variante ${id}.`))
assert.match(changed, /Instrucciones intactas\./)
assert.match(changed, /\\salto\n\\begin\{optativos\}/)
assert.match(changed, /\\end\{optativos\}\n\\end\{ejercicios\}\nPie intacto\./)
const secondEdits = documentVariationEdits(changed, [{ slotId: 'first' }, { slotId: 'second' }])
assert.equal(secondEdits.every((edit) => edit.marked), true)
const regenerated = applyDocumentVariationEdits(changed, secondEdits, (id) => variationBlockCode(id, `\\ej Otra ${id}.`))
assert.equal((regenerated.match(/id=first begin/g) || []).length, 1, 'Regeneration must not nest duplicate markers')
assert.equal(documentExerciseRanges(regenerated).length, 2)
assert.throws(() => documentVariationEdits(regenerated.replace('Pie intacto.', '\\ej Añadido manualmente.'), [{ slotId: 'first' }, { slotId: 'second' }]), /no coinciden/, 'An extra manual exercise cannot silently remain unchanged')
const commented = '\\begin{document}\n% \\ej Original\n\\ej Original\n\\end{document}'
const uncommentedEdit = documentVariationEdits(commented, [{ slotId: 'only', code: '\\ej Original' }])
assert.match(applyDocumentVariationEdits(commented, uncommentedEdit, () => '\\ej Nuevo'), /% \\ej Original\n\\ej Nuevo/)
assert.deepEqual(variationCommandBlocks(String.raw`% \criterios{comentario}
\criterios{a & $\frac{1}{2}$ & 1 \\ \hline}`), [String.raw`\criterios{a & $\frac{1}{2}$ & 1 \\ \hline}`])

let queryCount = 0
let attempts = 0
const handler = documentVariationHandlers({
  db: { collection: () => ({ where: (field, operation, value) => ({ get: async () => {
    assert.equal(field, 'curriculum.subjectId'); assert.equal(value, 'subject'); queryCount += 1
    return { docs: [{ id: 'bank-a', data: () => ({ enunciado: '\\ej Banco', curriculum: { conceptIds: ['a'] } }) }] }
  } }) }) },
  resolveModel: async () => ({ id: 'test', label: 'Test', reasoningEffort: 'minimal' }), apiKey: () => 'unused',
  choiceContent: (choice) => choice?.message?.content,
  validateVariation: () => [],
  requestModel: async () => { attempts += 1; return { payload: { choices: [{ message: { content: JSON.stringify({ enunciado: '\\ej \\M{2} Calcula $4+4$.', coveredConceptIds: attempts === 1 ? [] : ['a'], criteria: [], partConcepts: [] }) } }] } } },
})
const backendPlan = await handler.plan({ data: { mode: 'variant', subjectId: 'subject', model: 'test', slots: [slots[0]], conceptIds: ['a'] } })
assert.equal(queryCount, 1)
assert.equal(backendPlan.slots[0].exerciseId, 'bank-a')
assert.equal(backendPlan.slots[0].variationId, null, 'The root exercise id is not a variation id')
const result = await handler.generate({ data: { model: 'test', origin: 'new', latex: '\\ej \\M{2} Calcula $2+2$.', requiredConceptIds: ['a'] } })
assert.equal(attempts, 2, 'A proposal with missing coverage must be repaired before it is returned')
assert.deepEqual(result.coveredConceptIds, ['a'])
const originalColumns = String.raw`\ej
\begin{apartadosc}
\ap Primero \newcolumn
\ap Segundo
\end{apartadosc}`
assert.notEqual(columnBreakSignature(originalColumns), columnBreakSignature(originalColumns.replace('\\newcolumn', '') + '\n\\newcolumn'), 'A column break must not move outside its environment')
assert.equal(columnBreakSignature('\\ej % \\newcolumn\nTexto'), '')
assert.equal(matchTemplateColumnBreaks('\\ej Apartados\n\\newcolumn', '\\ej Apartados'), '\\ej Apartados\n')
assert.equal(matchTemplateColumnBreaks('\\ej \\begin{multicols}{2}A\\newcolumn B\\end{multicols}', '\\ej \\begin{multicols}{2}X\\newcolumn Y\\end{multicols}'), '\\ej \\begin{multicols}{2}A\\newcolumn B\\end{multicols}')
assert.throws(() => matchTemplateColumnBreaks('\\ej Texto', '\\ej \\columnbreak'), /saltos de columna/)
let columnAttempts = 0
const columnHandler = documentVariationHandlers({
  db: {}, resolveModel: async () => ({ id: 'test', label: 'Test' }), apiKey: () => 'unused',
  choiceContent: (choice) => choice.message.content, validateVariation: () => [],
  requestModel: async () => ({ payload: { choices: [{ message: { content: JSON.stringify({ enunciado: ++columnAttempts === 1 ? '\\ej Variante\n\\newcolumn' : '\\ej Variante corregida', coveredConceptIds: [], criteria: [], partConcepts: [] }) } }] } }),
})
assert.equal((await columnHandler.generate({ data: { latex: '\\ej Original', origin: 'cloned' } })).enunciado, '\\ej Variante corregida')
assert.equal(columnAttempts, 2, 'A spurious column break must trigger a repair')

let generationCalls = 0
let accepted
const controller = useDocumentVariation({
  model: ref('test'), fingerprint: () => 'original',
  prepare: async () => ({ fingerprint: 'original', curriculum: { conceptIds: ['a'] }, templates: [{}], concepts: [], blocks: [{ type: 'exercise', blockId: 'first', exerciseId: 'old-a' }], slots: [{ ...slots[0], structure: { apartados: [] }, metrics: { puntuacion: 2 } }] }),
  call: async (name) => name === 'planDocumentVariation' ? { conceptIds: ['a'], slots: [{ slotId: 'first', origin: 'cloned', requiredConceptIds: ['a'] }] } : (generationCalls += 1, { enunciado: `\\ej Propuesta ${generationCalls}`, coveredConceptIds: ['a'], model: 'test' }),
  sourceFor: async () => ({}), visualReferences: async () => [],
  snapshotFor: (response) => ({ id: 'new-a', enunciado: response.enunciado }),
  compileExercise: async () => ({ blob: new Blob(['%PDF-test']), artifacts: [] }),
  compileDocuments: async () => [{ templateKey: 'test', url: URL.createObjectURL(new Blob(['%PDF-document'])) }],
  accept: async (draft) => { accepted = draft },
})
await controller.open(); await controller.generate()
assert.equal(controller.canAccept.value, true)
await controller.regenerate(controller.state.rows[0])
assert.equal(generationCalls, 2, 'Individual regeneration must request just that slot')
await controller.acceptCopy()
assert.equal(accepted.blocks[0].exerciseId, 'new-a')
assert.equal(controller.state.visible, false)
accepted.previews.forEach((entry) => URL.revokeObjectURL(entry.url))
console.log('Variaciones: cobertura, selección del banco, estructura, revisión, regeneración y aceptación verificadas sin llamadas de pago.')
