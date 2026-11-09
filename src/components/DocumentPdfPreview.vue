<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import modernPdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyPdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  src: { type: String, default: '' },
  title: { type: String, default: 'Vista previa del documento' },
  interactiveZoom: { type: Boolean, default: false },
  reportError: { type: Boolean, default: true },
})
const emit = defineEmits(['render-error'])

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
let renderPipeline = Promise.resolve()
let zoom = 1
let pinch = null

function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
}

function onTouchStart(event) {
  if (!props.interactiveZoom || event.touches.length !== 2 || !container.value) return
  if (event.cancelable) event.preventDefault()
  const rect = container.value.getBoundingClientRect()
  const x = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left
  const y = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top
  pinch = { distance: touchDistance(event.touches), zoom, x: (container.value.scrollLeft + x) / zoom, y: (container.value.scrollTop + y) / zoom }
}

function onTouchMove(event) {
  if (!props.interactiveZoom || !pinch || event.touches.length !== 2 || !container.value) return
  if (event.cancelable) event.preventDefault()
  zoom = Math.min(4, Math.max(1, pinch.zoom * touchDistance(event.touches) / Math.max(pinch.distance, 1)))
  const availableWidth = Math.max(container.value.clientWidth - 22, 1)
  for (const canvas of canvases.value) {
    if (!canvas?.dataset.pageRatio) continue
    canvas.style.width = `${availableWidth * zoom}px`
    canvas.style.height = `${availableWidth * zoom * Number(canvas.dataset.pageRatio)}px`
  }
  const rect = container.value.getBoundingClientRect()
  const x = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left
  const y = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top
  container.value.scrollLeft = pinch.x * zoom - x
  container.value.scrollTop = pinch.y * zoom - y
}

function onTouchEnd(event) {
  if (!pinch || event.touches.length >= 2) return
  pinch = null
  scheduleRender()
}

function preventBrowserGesture(event) {
  if (props.interactiveZoom && event.cancelable) event.preventDefault()
}

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

async function cancelRenderTasks() {
  const tasks = renderTasks
  renderTasks = []
  tasks.forEach((task) => task?.cancel?.())
  await Promise.allSettled(tasks.map((task) => task?.promise))
}

async function clearDocument() {
  renderVersion += 1
  await cancelRenderTasks()
  const currentLoadingTask = loadingTask
  loadingTask = null
  if (currentLoadingTask) {
    try { await currentLoadingTask.destroy() } catch { /* La carga puede haber terminado. */ }
  }
  const currentPdfDocument = pdfDocument
  pdfDocument = null
  if (currentPdfDocument) {
    try { await currentPdfDocument.destroy() } catch { /* El documento puede estar destruido. */ }
  }
  await renderPipeline.catch(() => {})
  pageNumbers.value = []
  canvases.value = []
}

async function renderDocument(version) {
  if (!props.src || !container.value) return
  if (version !== renderVersion) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    if (!pdfDocument) {
      const { getDocument } = await loadPdfJs()
      if (version !== renderVersion) return
      let currentLoadingTask
      if (useLegacyPdfJs || props.src.startsWith('blob:')) {
        const response = await fetch(pdfSource.value)
        if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
        const bytes = await response.arrayBuffer()
        if (version !== renderVersion) return
        currentLoadingTask = getDocument({ data: new Uint8Array(bytes) })
      } else {
        currentLoadingTask = getDocument({ url: pdfSource.value })
      }
      loadingTask = currentLoadingTask
      const loadedDocument = await currentLoadingTask.promise
      if (loadingTask === currentLoadingTask) loadingTask = null
      if (version !== renderVersion) {
        try { await loadedDocument.destroy() } catch { /* La fuente ya ha cambiado. */ }
        return
      }
      pdfDocument = loadedDocument
      pageNumbers.value = Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
      await nextTick()
    }

    const availableWidth = Math.max(container.value.clientWidth - 22, 1)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, (isAppleTouchDevice ? 2048 : 4096) / (availableWidth * zoom))
    await cancelRenderTasks()
    if (version !== renderVersion) return

    for (const pageNumber of pageNumbers.value) {
      if (version !== renderVersion) return
      const canvas = canvases.value[pageNumber - 1]
      if (!canvas) continue
      const page = await pdfDocument.getPage(pageNumber)
      const initialViewport = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: availableWidth * zoom / initialViewport.width })
      canvas.dataset.pageRatio = String(initialViewport.height / initialViewport.width)
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
      renderTasks = renderTasks.filter((candidate) => candidate !== task)
    }
    if (version === renderVersion) isLoading.value = false
  } catch (error) {
    if (version !== renderVersion || error?.name === 'RenderingCancelledException') return
    console.error('No se ha podido renderizar el documento:', error)
    errorMessage.value = 'No se ha podido mostrar el PDF.'
    if (props.reportError) showAppErrorToast(`${errorMessage.value}\n${error?.message || ''}`.trim())
    emit('render-error', error)
    isLoading.value = false
  }
}

function scheduleRender() {
  cancelAnimationFrame(renderFrame)
  renderFrame = requestAnimationFrame(queueRender)
}

function queueRender() {
  const version = ++renderVersion
  renderTasks.forEach((task) => task?.cancel?.())
  renderPipeline = renderPipeline
    .catch(() => {})
    .then(() => renderDocument(version))
  return renderPipeline
}

watch(() => props.src, async () => {
  zoom = 1
  pinch = null
  await clearDocument()
  if (props.src) {
    await nextTick()
    queueRender()
  }
})

onMounted(async () => {
  if (props.src) {
    await nextTick()
    queueRender()
  }
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
  <div ref="container" class="document-pdf-preview" :class="{ 'document-pdf-interactive': interactiveZoom }" :aria-label="title" :aria-busy="isLoading" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchEnd" @gesturestart="preventBrowserGesture" @gesturechange="preventBrowserGesture" @gestureend="preventBrowserGesture">
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

.document-pdf-interactive { touch-action: pan-x pan-y; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.document-pdf-interactive .document-pdf-pages { width: max-content; min-width: 100%; }
.document-pdf-interactive .document-pdf-pages canvas { max-width: none; }

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
