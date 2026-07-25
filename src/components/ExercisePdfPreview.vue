<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import modernPdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyPdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

const userAgent = navigator.userAgent || ''
const isAppleTouchDevice = /iPad|iPhone|iPod/.test(userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isSafari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(userAgent)
const supportsModernPdfJs = typeof Promise.withResolvers === 'function'
  && typeof AbortSignal !== 'undefined'
  && typeof AbortSignal.any === 'function'
  && typeof structuredClone === 'function'
const useLegacyPdfJs = isAppleTouchDevice || isSafari || !supportsModernPdfJs
let pdfJsModulePromise = null

async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = useLegacyPdfJs
      ? import('pdfjs-dist/legacy/build/pdf.mjs')
      : import('pdfjs-dist')
  }
  const pdfJs = await pdfJsModulePromise
  pdfJs.GlobalWorkerOptions.workerSrc = useLegacyPdfJs ? legacyPdfWorkerUrl : modernPdfWorkerUrl
  return pdfJs
}

const props = defineProps({
  src: { type: String, required: true },
  title: { type: String, default: 'Vista previa del ejercicio' },
})

const container = ref(null)
const canvas = ref(null)
const isLoading = ref(true)
const errorMessage = ref('')
const pdfSource = computed(() => {
  if (!import.meta.env.DEV) return props.src
  try {
    const url = new URL(props.src)
    if (url.hostname !== 'firebasestorage.googleapis.com') return props.src
    return `/firebase-storage${url.pathname}${url.search}`
  } catch {
    return props.src
  }
})
let pdfDocument = null
let loadingTask = null
let renderTask = null
let fetchController = null
let resizeObserver = null
let intersectionObserver = null
let renderFrame = 0
let renderVersion = 0
let isVisible = false
let observedWidth = 0

async function clearDocument() {
  renderVersion += 1
  fetchController?.abort()
  fetchController = null
  renderTask?.cancel()
  renderTask = null
  if (loadingTask) {
    try { await loadingTask.destroy() } catch { /* La carga puede haber finalizado ya. */ }
  }
  loadingTask = null
  if (pdfDocument) {
    try { await pdfDocument.destroy() } catch { /* El documento puede estar destruido. */ }
  }
  pdfDocument = null
}

async function renderPreview() {
  if (!isVisible || !props.src || !container.value || !canvas.value) return
  const version = ++renderVersion
  isLoading.value = true
  errorMessage.value = ''

  try {
    if (!pdfDocument) {
      const { getDocument } = await loadPdfJs()
      if (version !== renderVersion) return
      if (useLegacyPdfJs) {
        fetchController = new AbortController()
        const response = await fetch(pdfSource.value, { signal: fetchController.signal })
        fetchController = null
        if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
        const data = new Uint8Array(await response.arrayBuffer())
        if (version !== renderVersion) return
        loadingTask = getDocument({ data })
      } else {
        loadingTask = getDocument({ url: pdfSource.value })
      }
      pdfDocument = await loadingTask.promise
      loadingTask = null
    }
    const page = await pdfDocument.getPage(1)
    if (version !== renderVersion) return
    const initialViewport = page.getViewport({ scale: 1 })
    const availableWidth = Math.max(container.value.clientWidth, 1)
    const viewport = page.getViewport({ scale: availableWidth / initialViewport.width })
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const context = canvas.value.getContext('2d', { alpha: false })

    canvas.value.width = Math.floor(viewport.width * pixelRatio)
    canvas.value.height = Math.floor(viewport.height * pixelRatio)
    canvas.value.style.width = `${Math.floor(viewport.width)}px`
    canvas.value.style.height = `${Math.floor(viewport.height)}px`

    renderTask?.cancel()
    renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      background: '#ffffff',
    })
    await renderTask.promise
    renderTask = null

    if (version === renderVersion) isLoading.value = false
  } catch (error) {
    if (version !== renderVersion) return
    if (error?.name === 'RenderingCancelledException') return
    console.error('No se ha podido renderizar el PDF del ejercicio:', error)
    errorMessage.value = 'No se ha podido mostrar el PDF.'
    isLoading.value = false
  }
}

function scheduleRender() {
  cancelAnimationFrame(renderFrame)
  renderFrame = requestAnimationFrame(() => renderPreview())
}

watch(() => props.src, async () => {
  await clearDocument()
  if (isVisible) await nextTick(renderPreview)
})

onMounted(() => {
  intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting
    if (isVisible) scheduleRender()
  }, { rootMargin: '300px 0px' })
  intersectionObserver.observe(container.value)

  resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (Math.abs(width - observedWidth) < 0.5) return
    observedWidth = width
    if (isVisible && pdfDocument) scheduleRender()
  })
  resizeObserver.observe(container.value)
})

onBeforeUnmount(async () => {
  cancelAnimationFrame(renderFrame)
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  await clearDocument()
})
</script>

<template>
  <div ref="container" class="exercise-pdf-preview" :class="{ 'exercise-pdf-preview-loaded': !isLoading && !errorMessage }" :aria-busy="isLoading">
    <canvas ref="canvas" :aria-label="title" />
    <div v-if="isLoading" class="exercise-pdf-status">
      <v-progress-circular indeterminate color="primary" size="28" width="3" />
    </div>
    <div v-else-if="errorMessage" class="exercise-pdf-status exercise-pdf-error">
      <v-icon icon="mdi-file-alert-outline" size="30" />
      <span>{{ errorMessage }}</span>
      <a :href="src" target="_blank" rel="noopener">Abrir PDF</a>
    </div>
  </div>
</template>
