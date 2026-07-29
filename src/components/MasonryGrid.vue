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
let containerObserver = null
let itemObserver = null
let layoutFrame = 0
let observedContainerWidth = 0

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
  const itemWidth = (width - props.gap * (columns - 1)) / columns
  const columnHeights = Array(columns).fill(0)

  props.items.forEach((item) => {
    const element = itemElements.get(props.itemKey(item))
    if (!element) return

    element.style.width = `${itemWidth}px`
    const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights))
    const x = shortestColumn * (itemWidth + props.gap)
    const y = columnHeights[shortestColumn]
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`
    element.style.visibility = 'visible'
    columnHeights[shortestColumn] += element.offsetHeight + props.gap
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
  if (previous && previous !== element) itemObserver?.unobserve(previous)
  if (!element) {
    itemElements.delete(key)
    return
  }
  itemElements.set(key, element)
  itemObserver?.observe(element)
  scheduleLayout()
}

watch(() => props.items, async () => {
  await nextTick()
  scheduleLayout()
}, { deep: false })

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
