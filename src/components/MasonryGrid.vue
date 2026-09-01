<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
  itemKey: { type: Function, required: true },
  gap: { type: Number, default: 6 },
  minDesktopColumnWidth: { type: Number, default: 240 },
  maxColumns: { type: Number, default: 0 },
})

const container = ref(null)
const containerHeight = ref(0)
const itemElements = new Map()
const itemColumns = new Map()
let containerObserver = null
let itemObserver = null
let layoutFrame = 0
let observedContainerWidth = 0
let assignedColumnCount = 0
let previousItemKeys = []

function columnCount(containerWidth) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const isLandscape = viewportWidth > viewportHeight

  let columns
  if (viewportWidth >= 1600) {
    columns = Math.max(5, Math.floor((containerWidth + props.gap) / (props.minDesktopColumnWidth + props.gap)))
  } else if (viewportWidth >= 1200) columns = 3
  else if (isLandscape && viewportHeight <= 600) columns = 2
  else if (viewportWidth >= 600) columns = isLandscape ? 3 : 2
  else columns = isLandscape ? 2 : 1

  return props.maxColumns > 0 ? Math.min(columns, props.maxColumns) : columns
}

function layoutItems() {
  if (!container.value) return
  const width = container.value.clientWidth
  if (!width) return

  const columns = columnCount(width)
  if (assignedColumnCount !== columns) {
    itemColumns.clear()
    assignedColumnCount = columns
  }
  const itemWidth = (width - props.gap * (columns - 1)) / columns
  const columnHeights = Array(columns).fill(0)
  const currentKeys = new Set(props.items.map((item) => props.itemKey(item)))
  itemColumns.forEach((_, key) => {
    if (!currentKeys.has(key)) itemColumns.delete(key)
  })

  const layoutEntries = []
  props.items.forEach((item) => {
    const key = props.itemKey(item)
    const element = itemElements.get(key)
    if (!element) return

    const widthValue = `${itemWidth}px`
    if (element.style.width !== widthValue) element.style.width = widthValue
    layoutEntries.push({ key, element })
  })

  // Agrupar todas las escrituras, después todas las lecturas y finalmente las
  // transformaciones evita forzar un layout completo por cada tarjeta.
  layoutEntries.forEach((entry) => {
    entry.height = entry.element.offsetHeight
  })
  layoutEntries.forEach(({ key, element, height: itemHeight }) => {
    let column = itemColumns.get(key)
    if (!Number.isInteger(column) || column < 0 || column >= columns) {
      column = columnHeights.indexOf(Math.min(...columnHeights))
      itemColumns.set(key, column)
    }
    const x = column * (itemWidth + props.gap)
    const y = columnHeights[column]
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`
    element.style.visibility = 'visible'
    columnHeights[column] += itemHeight + props.gap
  })

  containerHeight.value = Math.max(0, ...columnHeights) - (props.items.length ? props.gap : 0)
}

function scheduleLayout() {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(layoutItems)
}

function setItemElement(item, element) {
  const key = props.itemKey(item)
  const previous = itemElements.get(key)
  if (previous === element) return
  if (previous && previous !== element) itemObserver?.unobserve(previous)
  if (!element) {
    itemElements.delete(key)
    return
  }
  itemElements.set(key, element)
  itemObserver?.observe(element)
  scheduleLayout()
}

watch(() => props.items, async (items) => {
  const currentKeys = items.map((item) => props.itemKey(item))
  const isAppend = previousItemKeys.length > 0
    && currentKeys.length >= previousItemKeys.length
    && previousItemKeys.every((key, index) => currentKeys[index] === key)
  const isSame = currentKeys.length === previousItemKeys.length
    && currentKeys.every((key, index) => previousItemKeys[index] === key)
  if (!isAppend && !isSame) itemColumns.clear()
  previousItemKeys = currentKeys
  await nextTick()
  scheduleLayout()
}, { deep: false, immediate: true })

onMounted(() => {
  itemObserver = new ResizeObserver(() => scheduleLayout())
  itemElements.forEach((element) => itemObserver.observe(element))

  containerObserver = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width
    if (Math.abs(width - observedContainerWidth) < 0.5) return
    observedContainerWidth = width
    scheduleLayout()
  })
  containerObserver.observe(container.value)
  window.addEventListener('orientationchange', scheduleLayout)
  window.addEventListener('resize', scheduleLayout)
  scheduleLayout()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(layoutFrame)
  containerObserver?.disconnect()
  itemObserver?.disconnect()
  window.removeEventListener('orientationchange', scheduleLayout)
  window.removeEventListener('resize', scheduleLayout)
})
</script>

<template>
  <div ref="container" class="masonry-grid" :style="{ height: `${containerHeight}px` }">
    <div v-for="item in items" :key="itemKey(item)" :ref="(element) => setItemElement(item, element)" class="masonry-grid-item">
      <slot :item="item" />
    </div>
  </div>
</template>
