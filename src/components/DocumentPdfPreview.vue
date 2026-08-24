<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import modernPdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyPdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  src: { type: String, default: '' },
  title: { type: String, default: 'Vista previa del documento' },
})

const userAgent = navigator.userAgent || ''
const isAppleTouchDevice = /iPad|iPhone|iPod/.test(userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isSafari = /Safari/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(userAgent)
const supportsModernPdfJs = typeof Promise.withResolvers === 'function'
  && typeof AbortSignal !== 'undefined'
  && typeof AbortSignal.any === 'function'
  && typeof structuredClone === 'function'
const useLegacyPdfJs = isAppleTouchDevice || isSafari || !supportsModernPdfJs
const pdfSource = computed(() => {
  if (!import.meta.env.DEV) return props.src
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return props.src
  try {
    const url = new URL(props.src)
    if (url.hostname !== 'firebasestorage.googleapis.com') return props.src
    return `/firebase-storage${url.pathname}${url.search}`
  } catch {
    return props.src
  }
})

const container = ref(null)
const canvases = ref([])
const pageNumbers = ref([])
const isLoading = ref(false)
const errorMessage = ref('')
let pdfDocument = null
let loadingTask = null
let renderTasks = []
let resizeObserver = null
let renderFrame = 0
let renderVersion = 0
let observedWidth = 0
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

async function clearDocument() {
  renderVersion += 1
  renderTasks.forEach((task) => task?.cancel?.())
  renderTasks = []
  if (loadingTask) {
    try { await loadingTask.destroy() } catch { /* La carga puede haber terminado. */ }
  }
  loadingTask = null
  if (pdfDocument) {
    try { await pdfDocument.destroy() } catch { /* El documento puede estar destruido. */ }
  }
  pdfDocument = null
  pageNumbers.value = []
  canvases.value = []
}

async function renderDocument() {
  if (!props.src || !container.value) return
  const version = ++renderVersion
  isLoading.value = true
  errorMessage.value = ''
  try {
    if (!pdfDocument) {
      const { getDocument } = await loadPdfJs()
      if (useLegacyPdfJs || props.src.startsWith('blob:')) {
        const response = await fetch(pdfSource.value)
        if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
        loadingTask = getDocument({ data: new Uint8Array(await response.arrayBuffer()) })
      } else {
        loadingTask = getDocument({ url: pdfSource.value })
      }
      pdfDocument = await loadingTask.promise
      loadingTask = null
      pageNumbers.value = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
      await nextTick()
    }

    const availableWidth = Math.max(container.value.clientWidth - 22, 1)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    renderTasks.forEach((task) => task?.cancel?.())
    renderTasks = []

    for (const pageNumber of pageNumbers.value) {
      if (version !== renderVersion) return
      const canvas = canvases.value[pageNumber - 1]
      if (!canvas) continue
      const page = await pdfDocument.getPage(pageNumber)
      const initialViewport = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: availableWidth / initialViewport.width })
      canvas.width = Math.floor(viewport.width * pixelRatio)
      canvas.height = Math.floor(viewport.height * pixelRatio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const task = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        background: '#ffffff',
      })
      renderTasks.push(task)
      await task.promise
    }
    if (version === renderVersion) isLoading.value = false
  } catch (error) {
    if (version !== renderVersion || error?.name === 'RenderingCancelledException') return
    console.error('No se ha podido renderizar el documento:', error)
    errorMessage.value = 'No se ha podido mostrar el PDF.'
    showAppErrorToast(`${errorMessage.value}\n${error?.message || ''}`.trim())
    isLoading.value = false
  }
}

function scheduleRender() {
  cancelAnimationFrame(renderFrame)
  renderFrame = requestAnimationFrame(renderDocument)
}

watch(() => props.src, async () => {
  await clearDocument()
  if (props.src) await nextTick(renderDocument)
})

onMounted(async () => {
  if (props.src) await nextTick(renderDocument)
})

onBeforeUnmount(async () => {
  cancelAnimationFrame(renderFrame)
  resizeObserver?.disconnect()
  await clearDocument()
})

watch(container, (element) => {
  if (!element) return
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (Math.abs(width - observedWidth) < 1) return
    observedWidth = width
    if (pdfDocument) scheduleRender()
  })
  resizeObserver.observe(element)
})
</script>

<template>
  <div ref="container" class="document-pdf-preview" :aria-label="title" :aria-busy="isLoading">
    <div v-if="src" class="document-pdf-pages">
      <canvas
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        :ref="(element) => { if (element) canvases[pageNumber - 1] = element }"
        :aria-label="`${title}, página ${pageNumber}`"
      />
    </div>
    <div v-if="isLoading" class="document-pdf-status">
      <v-progress-circular indeterminate color="primary" size="30" width="3" />
      <span>Preparando documento…</span>
    </div>
    <div v-else-if="!src" class="document-pdf-status document-pdf-empty">
      <v-icon icon="mdi-file-pdf-box" size="48" color="primary" />
      <span>Compila el documento para mostrar la vista previa.</span>
    </div>
  </div>
</template>

<style scoped>
.document-pdf-preview {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: #dce3ec;
}

.document-pdf-pages {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 11px;
}

.document-pdf-pages canvas {
  display: block;
  max-width: 100%;
  background: #fff;
  box-shadow: 0 3px 12px rgba(16, 35, 61, .2);
}

.document-pdf-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  background: rgba(239, 243, 248, .86);
  color: #536b89;
  text-align: center;
}

.document-pdf-error { color: #a5283f; }
.document-pdf-error a { color: inherit; font-weight: 700; }
.document-pdf-empty { background: #eef2f7; }
</style>
