import { computed, onBeforeUnmount, reactive } from 'vue'
import { replaceVariationBlocks, uniqueConceptIds } from '../utils/documentVariation.js'

export function useDocumentVariation({ model, call, prepare, sourceFor, visualReferences, snapshotFor, compileExercise, compileDocuments, accept, fingerprint, onBusy }) {
  const state = reactive({
    visible: false, busy: false, phase: 'configure', mode: 'cloned', instructions: '', error: '', progress: '',
    course: '', subjectId: '', context: null, plan: null, rows: [], previews: [], selected: '', selectedPreview: '',
  })
  let operation = 0
  const revoke = (entry) => { if (entry?.url?.startsWith('blob:')) URL.revokeObjectURL(entry.url) }
  function clearPreviews() { state.previews.forEach(revoke); state.previews = [] }
  function clearRows() {
    state.rows.forEach((row) => { revoke(row.preview); (row.artifacts || []).forEach(revoke) })
    state.rows = []
  }
  function setBusy(value, message = '') { state.busy = value; state.progress = message; onBusy?.(value) }
  const missingConcepts = computed(() => {
    const covered = new Set(state.rows.filter((row) => row.snapshot && !row.error).flatMap((row) => row.coveredConceptIds || []))
    return (state.plan?.conceptIds || []).filter((id) => !covered.has(id))
  })
  const canAccept = computed(() => !state.busy && state.rows.length > 0
    && state.rows.every((row) => row.snapshot && row.preview?.url && !row.error)
    && state.previews.length === state.context?.templates.length && !missingConcepts.value.length)

  async function open() {
    if (state.busy) return
    const run = ++operation
    clearRows(); clearPreviews()
    state.visible = true; state.error = ''; state.phase = 'configure'; state.plan = null
    state.instructions = ''; state.context = null
    setBusy(true, 'Comprobando el documento original…')
    try {
      const context = await prepare()
      if (run !== operation) return
      state.context = context
      state.course = state.context.curriculum.course || ''
      state.subjectId = state.context.curriculum.subjectId || ''
    } catch (error) { if (run === operation) state.error = error.message || 'No se ha podido preparar el documento.' }
    finally { if (run === operation) setBusy(false) }
  }

  function payload() {
    const context = state.context
    const selected = context.subjectSelections?.[state.subjectId] || []
    const allowed = new Set([...selected, ...context.curriculum.conceptIds, ...context.slots.flatMap((slot) => slot.conceptIds)])
    const parents = new Map(context.concepts.map((node) => [node.id, node.parentId]))
    for (const id of [...allowed]) {
      let parent = parents.get(id)
      const seen = new Set()
      while (parent && !seen.has(parent)) { seen.add(parent); allowed.add(parent); parent = parents.get(parent) }
    }
    return {
      model: model.value, mode: state.mode, course: state.course, subjectId: state.subjectId,
      conceptIds: context.curriculum.conceptIds,
      concepts: selected.length ? context.concepts.filter((node) => allowed.has(node.id)) : context.concepts,
      slots: context.slots.map((slot) => ({ slotId: slot.slotId, sourceExerciseId: slot.sourceExerciseId, latex: slot.latex, conceptIds: slot.conceptIds, partCount: slot.structure.apartados.length })),
    }
  }

  async function buildRow(row) {
    const run = operation
    const context = state.context
    row.busy = true; row.error = ''; clearPreviews()
    try {
      let response = row.pendingResponse
      if (!response || row.pendingPrompt !== `${state.instructions}\n${row.instructions}` || row.pendingModel !== model.value) {
        const reference = row.choice.origin === 'new' ? null : await sourceFor(row.choice, row.original, context)
        if (run !== operation) return
        const images = reference ? await visualReferences(reference, context) : []
        if (run !== operation) return
        response = await call('generateDocumentExerciseVariation', {
          ...payload(), slots: undefined,
          ...row.choice, latex: row.original.latex, referenceImages: images,
          instructions: [state.instructions, row.instructions].filter(Boolean).join('\n'),
          contractCriteria: [
            ...(row.original.structure.gradingCriteria || []).map((criterion) => ({ ...criterion, partId: 'exercise' })),
            ...row.original.structure.apartados.flatMap((part) => (part.gradingCriteria || []).map((criterion) => ({ ...criterion, partId: part.id }))),
          ],
          previousProposals: row.history.slice(-3), latexCapabilities: state.context.capabilities,
        }, 280000)
        if (run !== operation) return
        row.pendingResponse = response; row.pendingPrompt = `${state.instructions}\n${row.instructions}`; row.pendingModel = model.value
      }
      const snapshot = snapshotFor(response, row, context)
      const compiled = await compileExercise(snapshot, context)
      if (run !== operation) { (compiled.artifacts || []).forEach(revoke); return }
      revoke(row.preview); (row.artifacts || []).forEach(revoke)
      row.snapshot = snapshot
      row.coveredConceptIds = response.coveredConceptIds
      row.preview = { blob: compiled.blob, url: URL.createObjectURL(compiled.blob) }
      row.artifacts = compiled.artifacts || []
      row.history.push(response.enunciado)
      row.pendingResponse = null
    } catch (error) { if (run === operation) row.error = error.message || 'No se ha podido generar el ejercicio.' }
    finally { row.busy = false }
  }

  function draftBlocks() {
    const replacements = new Map(state.rows.filter((row) => row.snapshot).map((row) => [row.original.slotId, {
      exerciseId: row.snapshot.id, version: 0, snapshot: row.snapshot, generated: true, metrics: row.original.metrics,
    }]))
    return replaceVariationBlocks(state.context.blocks, replacements)
  }

  async function refreshDocuments() {
    const run = operation
    if (state.rows.some((row) => !row.snapshot || row.error)) return
    state.progress = 'Compilando la copia completa…'
    const entries = await compileDocuments(draftBlocks(), state.context)
    if (run !== operation) { entries.forEach(revoke); return }
    clearPreviews(); state.previews = entries
    state.selectedPreview = entries[0]?.templateKey || ''
  }

  async function generate() {
    if (state.busy || !state.context) return
    const run = operation
    setBusy(true, state.mode === 'variant' ? 'Buscando ejercicios que cubran el mapa de conceptos…' : 'Preparando el clonado…')
    state.error = ''; clearRows(); clearPreviews()
    try {
      const response = await call('planDocumentVariation', payload(), 190000)
      if (run !== operation) return
      state.plan = response
      state.rows = state.context.slots.map((original, index) => ({
        original, choice: state.plan.slots.find((slot) => slot.slotId === original.slotId),
        label: `Ejercicio ${index + 1}`, instructions: '', error: '', busy: false, snapshot: null,
        preview: null, artifacts: [], history: [], coveredConceptIds: [], pendingResponse: null,
      }))
      if (state.rows.some((row) => !row.choice)) throw new Error('La planificación no incluye todos los ejercicios originales.')
      state.phase = 'preview'; state.selected = state.rows[0]?.original.slotId || ''
      // Sequential requests avoid unbounded billable work and permit retrying just the failed slot.
      for (const [index, row] of state.rows.entries()) {
        if (run !== operation) return
        state.progress = `Generando ${index + 1} de ${state.rows.length}…`
        await buildRow(row)
      }
      if (run !== operation) return
      await refreshDocuments()
    } catch (error) { if (run === operation) state.error = error.message || 'No se ha podido generar la copia.' }
    finally { if (run === operation) setBusy(false) }
  }

  async function regenerate(row, changeReference = false) {
    if (state.busy || !row) return
    const run = operation
    setBusy(true, `Regenerando ${row.label.toLowerCase()}…`); state.error = ''
    try {
      if (changeReference && state.mode === 'variant') {
        const response = await call('planDocumentVariation', {
          ...payload(), conceptIds: row.choice.requiredConceptIds,
          slots: [{ ...payload().slots.find((slot) => slot.slotId === row.original.slotId), conceptIds: row.choice.requiredConceptIds }],
          excludedIds: uniqueConceptIds([row.choice.exerciseId, ...state.rows.filter((item) => item !== row).map((item) => item.choice.exerciseId), ...state.context.slots.map((item) => item.sourceExerciseId)]),
        }, 190000)
        if (run !== operation) return
        row.choice = response.slots[0]
      }
      row.pendingResponse = null
      await buildRow(row)
      if (run !== operation) return
      await refreshDocuments()
    } catch (error) { if (run === operation) state.error = error.message || 'No se ha podido regenerar el ejercicio.' }
    finally { if (run === operation) setBusy(false) }
  }

  async function retryDocumentPreview() {
    if (state.busy) return
    const run = operation
    setBusy(true, 'Recompilando la copia…'); state.error = ''
    try { await refreshDocuments() } catch (error) { if (run === operation) state.error = error.message }
    finally { if (run === operation) setBusy(false) }
  }

  async function acceptCopy() {
    if (!canAccept.value) return
    if (fingerprint() !== state.context.fingerprint) { state.error = 'El documento original ha cambiado. Vuelve a iniciar la copia para incluir esos cambios.'; return }
    setBusy(true, 'Preparando la copia editable…')
    try {
      await accept({ blocks: draftBlocks(), rows: state.rows, previews: state.previews, context: state.context, plan: state.plan, mode: state.mode })
      // Ownership of the accepted blob URLs passes to the document editor.
      state.previews = []; state.rows.forEach((row) => { row.artifacts = [] }); clearRows()
      state.visible = false
    } catch (error) { state.error = error.message || 'No se ha podido aceptar la copia.' }
    finally { setBusy(false) }
  }

  function close() {
    operation += 1; clearRows(); clearPreviews(); state.visible = false; state.context = null; setBusy(false)
  }
  onBeforeUnmount(() => { operation += 1; clearRows(); clearPreviews() })
  return { state, missingConcepts, canAccept, open, generate, regenerate, retryDocumentPreview, acceptCopy, close }
}
