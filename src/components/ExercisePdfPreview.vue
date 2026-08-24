<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import modernPdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import legacyPdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { showAppErrorToast } from '../composables/useAppErrorToast'

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
const pdfBytesCache = new Map()
const renderedPreviewCache = new Map()
// En iPadOS los canvas y los documentos PDF consumen memoria fuera del heap de JS.
// Un límite alto por número de tarjetas puede provocar que WebKit cierre y recargue
// la pestaña completa por presión de memoria.
const MAX_CACHED_PDFS = isAppleTouchDevice ? 0 : 48
const MAX_CACHED_PREVIEWS = isAppleTouchDevice ? 6 : 32
const MAX_CONCURRENT_RENDERS = isAppleTouchDevice ? 1 : 3
const pendingRenderJobs = []
const thumbnailSourcesEmitted = new Set()
let activeRenderJobs = 0

function pumpRenderQueue() {
  while (activeRenderJobs < MAX_CONCURRENT_RENDERS && pendingRenderJobs.length) {
    const job = pendingRenderJobs.shift()
    activeRenderJobs += 1
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeRenderJobs -= 1
        pumpRenderQueue()
      })
  }
}

function withRenderSlot(task) {
  return new Promise((resolve, reject) => {
    pendingRenderJobs.push({ task, resolve, reject })
    pumpRenderQueue()
  })
}

function touchCacheEntry(cache, key, value) {
  cache.delete(key)
  cache.set(key, value)
  return value
}

function trimCache(cache, maximum) {
  while (cache.size > maximum) cache.delete(cache.keys().next().value)
}

async function cachedPdfBytes(source) {
  if (MAX_CACHED_PDFS === 0) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
    return response.arrayBuffer()
  }
  if (pdfBytesCache.has(source)) return touchCacheEntry(pdfBytesCache, source, pdfBytesCache.get(source))
  const promise = fetch(source)
    .then((response) => {
      if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
      return response.arrayBuffer()
    })
    .catch((error) => {
      pdfBytesCache.delete(source)
      throw error
    })
  touchCacheEntry(pdfBytesCache, source, promise)
  trimCache(pdfBytesCache, MAX_CACHED_PDFS)
  return promise
}

function previewCacheKey(source, width, pixelRatio, cropBottom) {
  return `${source}\u0000${Math.round(width)}\u0000${pixelRatio}\u0000${cropBottom ? 1 : 0}`
}

function cachedPreview(key) {
  const preview = renderedPreviewCache.get(key)
  return preview ? touchCacheEntry(renderedPreviewCache, key, preview) : null
}

function rememberRenderedPreview(key, sourceCanvas, metrics) {
  const cachedCanvas = document.createElement('canvas')
  cachedCanvas.width = sourceCanvas.width
  cachedCanvas.height = sourceCanvas.height
  cachedCanvas.getContext('2d', { alpha: false }).drawImage(sourceCanvas, 0, 0)
  touchCacheEntry(renderedPreviewCache, key, { canvas: cachedCanvas, metrics })
  trimCache(renderedPreviewCache, MAX_CACHED_PREVIEWS)
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

const props = defineProps({
  src: { type: String, required: true },
  title: { type: String, default: 'Vista previa del ejercicio' },
  cropBottom: { type: Boolean, default: false },
  aspectRatio: { type: Number, default: 0 },
  thumbnail: { type: Boolean, default: false },
  generateThumbnail: { type: Boolean, default: false },
})
const emit = defineEmits(['page-metrics', 'thumbnail-ready'])

const container = ref(null)
const canvas = ref(null)
const isLoading = ref(true)
const errorMessage = ref('')
const detectedAspectRatio = ref(0)
const reservedAspectRatio = computed(() => (
  Number(props.aspectRatio) > 0 ? Number(props.aspectRatio) : detectedAspectRatio.value
))
const containerStyle = computed(() => (
  reservedAspectRatio.value > 0 && !props.cropBottom
    ? { aspectRatio: String(reservedAspectRatio.value) }
    : undefined
))
const pdfSource = computed(() => {
  if (!import.meta.env.DEV) return props.src
  // En un dispositivo de la red local, pasar cada PDF por Vite obliga a hacer
  // Firebase -> Mac -> router -> iPad. Con CORS de desarrollo se descarga
  // directamente de Storage; el proxy se conserva para localhost.
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return props.src
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
let resizeObserver = null
let intersectionObserver = null
let renderFrame = 0
let renderVersion = 0
let isVisible = false
let observedWidth = 0
let releaseTimer = 0

function cropCanvasToContent(pixelRatio) {
  if (!props.cropBottom || !canvas.value) return
  const sourceCanvas = canvas.value
  const sourceContext = sourceCanvas.getContext('2d', { alpha: false })
  const { width, height } = sourceCanvas
  if (!width || !height) return

  const pixels = sourceContext.getImageData(0, 0, width, height).data
  let lastInkRow = -1
  for (let y = height - 1; y >= 0 && lastInkRow === -1; y -= 1) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + x * 4
      if (pixels[offset] < 248 || pixels[offset + 1] < 248 || pixels[offset + 2] < 248) {
        lastInkRow = y
        break
      }
    }
  }
  if (lastInkRow === -1) return

  const padding = Math.round(10 * pixelRatio)
  const croppedHeight = Math.min(height, Math.max(Math.round(28 * pixelRatio), lastInkRow + 1 + padding))
  if (croppedHeight >= height) return

  const croppedCanvas = document.createElement('canvas')
  croppedCanvas.width = width
  croppedCanvas.height = croppedHeight
  croppedCanvas.getContext('2d', { alpha: false }).drawImage(
    sourceCanvas,
    0,
    0,
    width,
    croppedHeight,
    0,
    0,
    width,
    croppedHeight,
  )
  sourceCanvas.height = croppedHeight
  sourceCanvas.getContext('2d', { alpha: false }).drawImage(croppedCanvas, 0, 0)
}

function emitThumbnail(metrics) {
  if (!props.thumbnail || !props.generateThumbnail || !canvas.value) return
  const source = props.src
  if (!source || thumbnailSourcesEmitted.has(source)) return
  thumbnailSourcesEmitted.add(source)
  const target = canvas.value
  const emitBlob = (blob) => {
    if (!blob) {
      thumbnailSourcesEmitted.delete(source)
      return
    }
    emit('thumbnail-ready', {
      blob,
      source,
      width: target.width,
      height: target.height,
      aspectRatio: Number(metrics?.aspectRatio) || (target.width / Math.max(1, target.height)),
    })
  }
  if (target.toBlob) target.toBlob(emitBlob, 'image/webp', 0.8)
  else thumbnailSourcesEmitted.delete(source)
}

async function clearDocument() {
  renderVersion += 1
  const currentRenderTask = renderTask
  const currentLoadingTask = loadingTask
  const currentPdfDocument = pdfDocument
  renderTask = null
  loadingTask = null
  pdfDocument = null
  currentRenderTask?.cancel()
  if (currentLoadingTask) {
    try { await currentLoadingTask.destroy() } catch { /* La carga puede haber finalizado ya. */ }
  }
  if (currentPdfDocument) {
    try { await currentPdfDocument.destroy() } catch { /* El documento puede estar destruido. */ }
  }
}

function releaseOffscreenResources() {
  window.clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(async () => {
    if (isVisible) return
    cancelAnimationFrame(renderFrame)
    await clearDocument()
    if (isVisible || !canvas.value) return
    canvas.value.width = 1
    canvas.value.height = 1
    canvas.value.style.width = '100%'
    canvas.value.style.height = 'auto'
    isLoading.value = true
  }, isAppleTouchDevice ? 250 : 900)
}

async function renderPreview() {
  if (!isVisible || !props.src || !container.value || !canvas.value) return
  const version = ++renderVersion
  isLoading.value = true
  errorMessage.value = ''

  await withRenderSlot(async () => {
    if (!isVisible || version !== renderVersion || !container.value || !canvas.value) return
    try {
    const availableWidth = Math.max(container.value.clientWidth, 1)
    const pixelRatio = Math.min(window.devicePixelRatio || 1, isAppleTouchDevice ? (props.thumbnail ? 1 : 1.25) : 2)
    const cacheKey = previewCacheKey(pdfSource.value, availableWidth, pixelRatio, props.cropBottom)
    const preview = cachedPreview(cacheKey)
    if (preview) {
      const context = canvas.value.getContext('2d', { alpha: false })
      canvas.value.width = preview.canvas.width
      canvas.value.height = preview.canvas.height
      context.drawImage(preview.canvas, 0, 0)
      if (!props.cropBottom && preview.metrics?.aspectRatio > 0) {
        detectedAspectRatio.value = preview.metrics.aspectRatio
        emit('page-metrics', preview.metrics)
      }
      isLoading.value = false
      return
    }

    if (!pdfDocument) {
      const { getDocument } = await loadPdfJs()
      if (version !== renderVersion) return
      const bytes = await cachedPdfBytes(pdfSource.value)
      if (version !== renderVersion) return
      loadingTask = getDocument({ data: new Uint8Array(isAppleTouchDevice ? bytes : bytes.slice(0)) })
      pdfDocument = await loadingTask.promise
      loadingTask = null
    }
    const page = await pdfDocument.getPage(1)
    if (version !== renderVersion) return
    const initialViewport = page.getViewport({ scale: 1 })
    const pageAspectRatio = initialViewport.width / initialViewport.height
    if (!props.cropBottom && Number.isFinite(pageAspectRatio) && pageAspectRatio > 0) {
      detectedAspectRatio.value = pageAspectRatio
      emit('page-metrics', {
        width: initialViewport.width,
        height: initialViewport.height,
        aspectRatio: pageAspectRatio,
      })
      await nextTick()
    }
    const viewport = page.getViewport({ scale: availableWidth / initialViewport.width })
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
    if (version === renderVersion) cropCanvasToContent(pixelRatio)

    if (version === renderVersion) {
      rememberRenderedPreview(cacheKey, canvas.value, {
        width: initialViewport.width,
        height: initialViewport.height,
        aspectRatio: pageAspectRatio,
      })
      emitThumbnail({
        width: initialViewport.width,
        height: initialViewport.height,
        aspectRatio: pageAspectRatio,
      })
      isLoading.value = false
      if (props.thumbnail && pdfDocument) {
        const completedDocument = pdfDocument
        pdfDocument = null
        try { await completedDocument.destroy() } catch { /* La vista ya está renderizada. */ }
      }
    }
    } catch (error) {
      if (version !== renderVersion) return
      if (error?.name === 'RenderingCancelledException') return
      console.error('No se ha podido renderizar el PDF del ejercicio:', error)
      errorMessage.value = 'No se ha podido mostrar el PDF.'
      showAppErrorToast(`${errorMessage.value}\n${error?.message || ''}`.trim())
      isLoading.value = false
    }
  })
}

function scheduleRender() {
  cancelAnimationFrame(renderFrame)
  renderFrame = requestAnimationFrame(() => renderPreview())
}

watch(() => props.src, async () => {
  detectedAspectRatio.value = 0
  await clearDocument()
  if (isVisible) await nextTick(renderPreview)
})

onMounted(() => {
  intersectionObserver = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting
    if (isVisible) {
      window.clearTimeout(releaseTimer)
      scheduleRender()
    } else {
      releaseOffscreenResources()
    }
  }, { rootMargin: `${isAppleTouchDevice ? 100 : 300}px 0px` })
  intersectionObserver.observe(container.value)

  resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (Math.abs(width - observedWidth) < 0.5) return
    observedWidth = width
    if (isVisible && (pdfDocument || !isLoading.value)) scheduleRender()
  })
  resizeObserver.observe(container.value)
})

onBeforeUnmount(async () => {
  window.clearTimeout(releaseTimer)
  cancelAnimationFrame(renderFrame)
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  await clearDocument()
})
</script>

<template>
  <div ref="container" class="exercise-pdf-preview" :class="{ 'exercise-pdf-preview-loaded': !isLoading && !errorMessage, 'exercise-pdf-preview-reserved': reservedAspectRatio > 0 && !cropBottom }" :style="containerStyle" :aria-busy="isLoading">
    <canvas ref="canvas" :aria-label="title" />
    <div v-if="isLoading" class="exercise-pdf-status exercise-pdf-skeleton" aria-hidden="true" />
  </div>
</template>
