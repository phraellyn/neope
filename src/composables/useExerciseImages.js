import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyPdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { functions } from '../services/firebase'
import { archivedImage, generatedImageFile, graphicReferences, referencedImageFiles, replaceGraphicReference, revokePendingImage, tikzFigures, versionImageFiles } from '../utils/exerciseImages'

let pdfJsPromise
async function loadPdfJs() {
  const legacy = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || /Safari/.test(navigator.userAgent || '') && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(navigator.userAgent || '')
    || typeof Promise.withResolvers !== 'function' || typeof AbortSignal.any !== 'function'
  pdfJsPromise ||= legacy ? import('pdfjs-dist/legacy/build/pdf.mjs') : import('pdfjs-dist')
  const pdfJs = await pdfJsPromise
  pdfJs.GlobalWorkerOptions.workerSrc = legacy ? legacyPdfWorkerUrl : pdfWorkerUrl
  return pdfJs
}

async function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se ha podido leer una imagen de referencia.'))
    reader.readAsDataURL(blob)
  })
}

function referenceUrl(url) {
  if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return url
  try {
    const parsed = new URL(url)
    return parsed.hostname === 'firebasestorage.googleapis.com' ? `/firebase-storage${parsed.pathname}${parsed.search}` : url
  } catch { return url }
}

async function pdfReferences(url, limit = 1, allPages = false) {
  const { getDocument } = await loadPdfJs()
  const task = getDocument({ url: referenceUrl(url) })
  try {
    const pdf = await task.promise
    if (allPages && pdf.numPages > limit) throw new Error('El ejercicio ocupa demasiadas páginas para enviar todas sus figuras. Reduce la selección antes de generar la variante.')
    const images = []
    for (let index = 1; index <= Math.min(pdf.numPages, limit); index += 1) {
      const page = await pdf.getPage(index)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width, 1800 / base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      images.push(canvas.toDataURL('image/png'))
    }
    return images
  } finally { await task.destroy() }
}

export function useExerciseImages({ exercise, selectedVersion, model, teacherReady, configuredModels, compileCandidate, applyCode, nextImageNumber }) {
  const catalog = ref([])
  const catalogLoading = ref(false)
  const catalogError = ref('')
  const checkedAt = ref('')
  const busy = ref(false)
  const dialog = ref(false)
  const error = ref('')
  const candidate = ref(null)
  const targetVersion = ref(null)
  const sourceCode = ref('')
  const renderedOriginal = ref('')
  const form = reactive({ target: '', instructions: '', imageModel: '', imageMode: 'auto', experimental: false })
  const generationDialog = ref(false)
  const targets = ref([])
  let exerciseIdentity = null
  let applying = false
  let catalogReloadRequested = false

  const imageModels = computed(() => configuredModels.value.flatMap((configured) => {
    const entry = catalog.value.find((known) => known.id === configured.openRouterId)
    if (!entry?.outputModalities.includes('image') || entry.rasterOutput === false) return []
    return [{ title: configured.nombre || entry.name, value: entry.id,
      subtitle: entry.imageReferences ? `Genera imágenes · Hasta ${entry.imageReferenceLimit} referencias` : 'Genera imágenes',
      canReadImages: entry.inputModalities.includes('image'), canGenerateImages: true, capabilitiesKnown: true, imageReferences: entry.imageReferences }]
  }))
  const selectedTarget = computed(() => targets.value.find((entry) => entry.id === form.target) || null)
  const selectedImageModel = computed(() => catalog.value.find((entry) => entry.id === form.imageModel))
  const regenerationModels = computed(() => imageModels.value.filter((entry) => !selectedTarget.value?.file || entry.imageReferences))
  const usesTikz = computed(() => selectedTarget.value?.kind === 'tikz' || !regenerationModels.value.length)
  const comparisonImage = computed(() => selectedTarget.value?.file?.url || renderedOriginal.value)
  const candidateNeedsRegeneration = computed(() => Boolean(candidate.value && (candidate.value.instructions !== form.instructions.trim() || candidate.value.model !== (usesTikz.value ? model.value : form.imageModel))))
  const activeVersion = () => selectedVersion.value === 0 ? exercise.value : exercise.value.variaciones[selectedVersion.value - 1]

  async function loadCatalog() {
    if (!teacherReady.value) return
    if (catalogLoading.value) { catalogReloadRequested = true; return }
    catalogLoading.value = true; catalogError.value = ''
    try {
      const response = await httpsCallable(functions, 'listAiModelCapabilities', { timeout: 65000 })({})
      catalog.value = response.data?.models || []
      checkedAt.value = response.data?.checkedAt || ''
      if (!imageModels.value.some((entry) => entry.value === form.imageModel)) {
        const configured = configuredModels.value.find((entry) => imageModels.value.some((known) => known.value === entry.openRouterId))
        form.imageModel = imageModels.value.find((entry) => entry.value === model.value)?.value || configured?.openRouterId || imageModels.value[0]?.value || ''
      }
    } catch (failure) { catalogError.value = failure.message || 'No se han podido consultar las capacidades de los modelos.' }
    finally {
      catalogLoading.value = false
      if (catalogReloadRequested) { catalogReloadRequested = false; loadCatalog() }
    }
  }
  watch(teacherReady, (ready) => { if (ready) loadCatalog(); else { catalog.value = []; catalogError.value = '' } }, { immediate: true })
  watch(() => JSON.stringify(configuredModels.value.map((entry) => entry.openRouterId)), () => loadCatalog())
  watch([imageModels, model], ([options, selected]) => {
    if (options.some((entry) => entry.value === selected)) form.imageModel = selected
    else if (!options.some((entry) => entry.value === form.imageModel)) form.imageModel = options[0]?.value || ''
  })

  async function referenceImages(version = exercise.value, code = version.enunciado || '', { includePreview = true } = {}) {
    const files = referencedImageFiles(code, versionImageFiles(exercise.value, version)).filter((file) => /^image\//.test(file.type || '') || file.type === 'application/pdf')
    if (files.length > 4) throw new Error('Este ejercicio contiene más de cuatro imágenes. Genera una variante a partir de una selección más pequeña.')
    const result = []
    for (const file of files) {
      let dataUrl = file.pendingDataUrl
      if (!dataUrl) {
        if (file.type === 'application/pdf') dataUrl = (await pdfReferences(file.url))[0]
        else {
          const response = await fetch(referenceUrl(file.url))
          if (!response.ok) throw new Error(`No se ha podido cargar la imagen ${file.compilerName} (HTTP ${response.status}).`)
          dataUrl = await blobDataUrl(await response.blob())
        }
      }
      result.push({ name: file.compilerName, dataUrl })
    }
    const missingGraphics = graphicReferences(code).some((reference) => !files.some((file) => file.latexName === reference.name))
    const needsRenderedReference = tikzFigures(code).length || /\\tikz\b/.test(code) || missingGraphics || files.some((file) => file.type === 'application/pdf')
    if (includePreview && needsRenderedReference) {
      const hasSolutions = /\\begin\s*\{solucion\}/.test(code)
      const currentPreview = hasSolutions ? version.previewPdf?.resuelto || version.pdf?.resuelto : version.previewPdf?.enunciado || version.pdf?.enunciado
      let preview = version.renderedLatex?.trim() === code.trim() ? currentPreview : ''
      let temporaryUrl
      try {
        if (!preview) {
          temporaryUrl = URL.createObjectURL(await compileCandidate(code, versionImageFiles(exercise.value, version)))
          preview = temporaryUrl
        }
        // The rendered pages contain all the figures, including PDF page selections.
        result.length = 0
        const pages = await pdfReferences(preview, 4, true)
        pages.forEach((dataUrl, index) => result.push({ name: `Ejercicio original renderizado · página ${index + 1}`, dataUrl }))
      } finally { if (temporaryUrl) URL.revokeObjectURL(temporaryUrl) }
    }
    return result
  }

  function discardCandidate() {
    if (candidate.value?.file) revokePendingImage(candidate.value.file)
    if (candidate.value?.pdfUrl) URL.revokeObjectURL(candidate.value.pdfUrl)
    candidate.value = null
  }

  async function prepareVariationImage(plan, version, references) {
    if (!plan?.needed) return null
    const response = await httpsCallable(functions, 'generateExerciseImage', { timeout: 245000 })({
      imageModel: form.imageModel, enunciado: version.enunciado, imagePrompt: plan.prompt,
      instructions: form.instructions,
      referenceImages: selectedImageModel.value?.imageReferences ? references : [],
    })
    return generatedImageFile(response.data, { latexName: `imagen${nextImageNumber()}`, variantId: version.id })
  }

  async function openRegeneration() {
    if (busy.value) return
    if (!catalog.value.length) await loadCatalog()
    const version = activeVersion()
    if (!version) return
    targetVersion.value = version; sourceCode.value = version.enunciado || ''
    exerciseIdentity = exercise.value
    const files = referencedImageFiles(sourceCode.value, versionImageFiles(exercise.value, version))
    targets.value = [
      ...files.map((file) => ({ id: file.id || file.path, kind: 'raster', label: file.latexName, file })),
      ...tikzFigures(sourceCode.value),
    ]
    if (!targets.value.length) targets.value = [{ id: 'new', kind: 'new', label: 'Añadir una imagen nueva' }]
    form.target = targets.value[0].id
    if (targets.value[0].file && !selectedImageModel.value?.imageReferences) form.imageModel = imageModels.value.find((entry) => entry.imageReferences)?.value || ''
    form.instructions = targets.value[0].file?.generation?.instructions || ''
    renderedOriginal.value = ''
    error.value = ''; discardCandidate(); dialog.value = true
  }

  async function generateCandidate() {
    if (busy.value || !targetVersion.value || !selectedTarget.value) return
    busy.value = true; error.value = ''; discardCandidate()
    let file = null
    try {
      const target = selectedTarget.value
      const version = targetVersion.value
      const references = await referenceImages(version, sourceCode.value)
      if (target.kind === 'tikz') renderedOriginal.value = references[0]?.dataUrl || ''
      let code = sourceCode.value
      let result
      if (usesTikz.value) {
        const response = await httpsCallable(functions, 'regenerateExerciseTikz', { timeout: 185000 })({ model: model.value, enunciado: sourceCode.value, figureCode: target.code, createFigure: target.kind !== 'tikz', imageName: target.file?.latexName || '', instructions: form.instructions, referenceImages: references })
        result = response.data
        if (target.kind === 'tikz') code = code.slice(0, target.from) + result.code + code.slice(target.to)
        else if (target.file) {
          for (const reference of graphicReferences(code).filter((entry) => entry.name === target.file.latexName).reverse()) code = code.slice(0, reference.from) + result.code + code.slice(reference.to)
        } else code = `${code}\n\n\\begin{center}\n${result.code}\n\\end{center}`
      } else {
        if (!form.imageModel) throw new Error('Selecciona un generador de imágenes.')
        if (target.file && !selectedImageModel.value?.imageReferences) throw new Error('Para regenerar esta imagen, selecciona un generador que admita referencias.')
        const selectedReferences = target.file ? references.filter((entry) => entry.name === target.file.compilerName) : references
        if (target.file && !selectedReferences.length) selectedReferences.push(...references)
        const response = await httpsCallable(functions, 'generateExerciseImage', { timeout: 245000 })({ imageModel: form.imageModel, enunciado: sourceCode.value, imagePrompt: target.file?.generation?.prompt || '', instructions: form.instructions, referenceImages: selectedImageModel.value?.imageReferences ? selectedReferences : [] })
        result = response.data
        file = await generatedImageFile(result, { latexName: `imagen${nextImageNumber()}`, variantId: version.id || 'original' })
        code = target.file ? replaceGraphicReference(code, target.file.latexName, file.latexName) : `${code}\n\n\\begin{center}\\includegraphics[width=0.8\\linewidth]{${file.latexName}}\\end{center}`
      }
      const files = [...versionImageFiles(exercise.value, version).filter((entry) => !target.file || entry.id !== target.file.id), ...(file ? [file] : [])]
      const blob = await compileCandidate(code, files)
      if (exercise.value !== exerciseIdentity || version.enunciado !== sourceCode.value) throw new Error('El ejercicio ha cambiado durante la generación. Vuelve a generar la propuesta sobre la versión actual.')
      candidate.value = { code, files, file, metadata: result, model: result.model, instructions: form.instructions.trim(), pdfUrl: URL.createObjectURL(blob), target, source: sourceCode.value }
      file = null
    } catch (failure) { if (file) revokePendingImage(file); error.value = failure.message || 'No se ha podido generar la imagen.' }
    finally { busy.value = false }
  }

  async function acceptCandidate() {
    const proposal = candidate.value
    const version = targetVersion.value
    if (!proposal || busy.value || applying || candidateNeedsRegeneration.value) return
    if (exercise.value !== exerciseIdentity || version.enunciado !== proposal.source) { error.value = 'El ejercicio ha cambiado. Genera una propuesta nueva.'; return }
    applying = true
    busy.value = true
    try {
      if (version === exercise.value) {
        exercise.value.variaciones.forEach((variation) => { if (!Array.isArray(variation.archivos)) variation.archivos = [...exercise.value.archivos] })
      }
      if (proposal.target.file) {
        const history = archivedImage(proposal.target.file, proposal.file?.id)
        if (history) version.imageHistory = [...(version.imageHistory || []), history]
        else revokePendingImage(proposal.target.file)
      }
      version.archivos = proposal.files
      if (proposal.metadata.kind === 'tikz') version.figureGenerations = [...(version.figureGenerations || []), { model: proposal.metadata.model, instructions: proposal.metadata.instructions, createdAt: proposal.metadata.createdAt }].slice(-12)
      const file = proposal.file
      proposal.file = null
      await applyCode(version, proposal.code)
      candidate.value = null
      URL.revokeObjectURL(proposal.pdfUrl)
      dialog.value = false
      return file
    } finally { applying = false; busy.value = false }
  }

  function closeDialog() { if (!busy.value) { discardCandidate(); dialog.value = false } }
  watch(() => form.target, () => { if (!busy.value) { discardCandidate(); error.value = '' } })
  watch(dialog, (visible) => { if (!visible && !busy.value) discardCandidate() })
  onBeforeUnmount(discardCandidate)

  return { catalog, catalogLoading, catalogError, checkedAt, imageModels, regenerationModels, usesTikz, form, busy, dialog, generationDialog, error, candidate, candidateNeedsRegeneration, targets, selectedTarget, comparisonImage, loadCatalog, referenceImages, prepareVariationImage, openRegeneration, generateCandidate, acceptCandidate, closeDialog }
}
