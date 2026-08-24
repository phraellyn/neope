<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { arc, hierarchy, partition, select, zoom, zoomIdentity } from 'd3'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { mathCurriculum, toggleHierarchySelection } from '../data/mathCurriculum'

const props = defineProps({
  nodes: { type: Array, required: true },
  disabled: { type: Boolean, default: false },
  configurationMode: { type: Boolean, default: false },
  activeSubjectId: { type: String, default: null },
  subjectNodeIds: { type: Array, default: () => [] },
  selectionMode: { type: Boolean, default: false },
  selectedNodeIds: { type: Array, default: () => [] },
  exerciseCounts: { type: Object, default: () => ({}) },
  centerTitle: { type: String, default: '' },
  showCurriculum: { type: Boolean, default: true },
  showHint: { type: Boolean, default: true },
  fitAlignment: { type: String, default: 'center' },
})

const emit = defineEmits(['add-node', 'rename-node', 'delete-node', 'reorder-nodes', 'group-nodes', 'select-subject', 'update-subject-node-ids', 'update-selected-node-ids'])

const width = 1800
const height = 1300
const centerX = width / 2
const centerY = height / 2
const centerRadius = 148
const innerRadius = 178
const outerRadius = 650
const radialIncrementScale = 2.35
const fitMargin = 54
const rootId = 'matematicas'
const branchColors = ['#3569b8', '#078b57', '#f07818', '#d94432', '#6958c7', '#b43f86', '#168ca2']
const courseSubjects = mathCurriculum.map((row, index) => ({ ...row, color: branchColors[index % branchColors.length] }))
const isAppleTouchDevice = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const prefersTouchRendering = isAppleTouchDevice
  || window.matchMedia?.('(pointer: coarse)').matches

const mapHost = ref(null)
const svgElement = ref(null)
const contentGroup = ref(null)
const mathOverlayViewbox = ref(null)
const editingId = ref(null)
const selectedIds = ref([])
const touchState = ref(null)
let suppressNextClick = false
let lastTouch = { id: null, time: 0 }
let zoomBehavior
let overlayResizeObserver
let currentZoomTransform = zoomIdentity

const assignmentMode = computed(() => props.configurationMode && Boolean(props.activeSubjectId))
const conceptSelectionMode = computed(() => props.selectionMode && Boolean(props.activeSubjectId))
const lightweightRendering = computed(() => prefersTouchRendering || props.configurationMode)
const effectiveFitMargin = computed(() => prefersTouchRendering ? 18 : fitMargin)
const subjectIdSet = computed(() => new Set(props.subjectNodeIds))
const exerciseSelectedIdSet = computed(() => new Set(props.selectedNodeIds))
const visibleNodes = computed(() => {
  if (!props.activeSubjectId || props.configurationMode) return props.nodes
  const allowedIds = new Set([...props.subjectNodeIds, rootId])
  return props.nodes.filter((node) => allowedIds.has(node.id))
})

const treeData = computed(() => {
  const byId = new Map()
  visibleNodes.value.forEach((node, sourceIndex) => byId.set(node.id, { ...node, sourceIndex, children: [] }))
  if (!byId.has(rootId)) byId.set(rootId, { id: rootId, title: 'Matemáticas', parentId: null, children: [] })
  byId.forEach((node) => {
    if (node.id === rootId) return
    const parent = byId.get(node.parentId) || byId.get(rootId)
    parent.children.push(node)
  })
  byId.forEach((node) => node.children.sort((a, b) => (a.order ?? a.sourceIndex) - (b.order ?? b.sourceIndex)))
  return byId.get(rootId)
})

const hierarchyRoot = computed(() => {
  const root = hierarchy(treeData.value).sum((node) => node.children?.length ? 0 : 1)
  return partition().size([2 * Math.PI, root.height + 1])(root)
})

const levelCount = computed(() => Math.max(1, hierarchyRoot.value.height))
const ringWidth = computed(() => ((outerRadius - innerRadius) / levelCount.value) * radialIncrementScale)
const fullMapRadius = computed(() => innerRadius + levelCount.value * ringWidth.value)
const fittedScale = computed(() => Math.min(1, (Math.min(width, height) / 2 - effectiveFitMargin.value) / fullMapRadius.value))

const segments = computed(() => hierarchyRoot.value.descendants()
  .filter((node) => node.depth > 0)
  .map((node) => ({
    node,
    startAngle: node.x0,
    endAngle: node.x1,
    innerRadius: innerRadius + (node.depth - 1) * ringWidth.value,
    outerRadius: innerRadius + node.depth * ringWidth.value - 5,
  })))

const selectedIdSet = computed(() => new Set(selectedIds.value))
const centerDisplayTitle = computed(() => props.centerTitle || hierarchyRoot.value.data.title)
const centerExerciseCount = computed(() => Number(props.exerciseCounts[rootId]) || 0)
const selectedSegments = computed(() => segments.value.filter((segment) => selectedIdSet.value.has(segment.node.data.id)))
const selectedSiblingContext = computed(() => {
  if (selectedSegments.value.length < 2) return null
  const hierarchyNodes = selectedSegments.value.map((segment) => segment.node)
  const parent = hierarchyNodes[0]?.parent
  if (!parent || !hierarchyNodes.every((node) => node.parent === parent)) return null
  const indexes = hierarchyNodes.map((node) => parent.children.indexOf(node)).sort((a, b) => a - b)
  if (!indexes.every((index, position) => index === indexes[0] + position)) return null
  const orderedSegments = indexes.map((index) => segments.value.find((segment) => segment.node === parent.children[index])).filter(Boolean)
  return orderedSegments.length === selectedIds.value.length
    ? { parentId: parent.data.id, parent, segments: orderedSegments }
    : null
})

const swapControls = computed(() => {
  if (selectedSegments.value.length !== 1) return []
  const segment = selectedSegments.value[0]
  const siblings = segment.node.parent?.children || []
  if (siblings.length < 2) return []
  const index = siblings.indexOf(segment.node)
  const radius = (segment.innerRadius + segment.outerRadius) / 2
  const candidates = []
  if (index > 0) candidates.push({ target: siblings[index - 1], angle: segment.startAngle })
  else if (segment.node.parent?.data.id === rootId) candidates.push({ target: siblings.at(-1), angle: segment.startAngle })
  if (index < siblings.length - 1) candidates.push({ target: siblings[index + 1], angle: segment.endAngle })
  else if (segment.node.parent?.data.id === rootId) candidates.push({ target: siblings[0], angle: segment.endAngle })
  const uniqueCandidates = candidates.filter(({ target }, candidateIndex) => candidates.findIndex((candidate) => candidate.target.data.id === target.data.id) === candidateIndex)
  return uniqueCandidates.map(({ target, angle }) => ({
    source: segment,
    target,
    angle,
    point: pointOnCircle(angle, radius),
  }))
})

const segmentArc = arc()
  .startAngle((segment) => segment.startAngle)
  .endAngle((segment) => segment.endAngle)
  .innerRadius((segment) => segment.innerRadius)
  .outerRadius((segment) => segment.outerRadius)
  .padAngle((segment) => Math.min(0.012, (segment.endAngle - segment.startAngle) * 0.12))
  .padRadius(innerRadius)
  .cornerRadius(9)

function segmentPath(segment) {
  if (!selectedIdSet.value.has(segment.node.data.id)) return segmentArc(segment)
  const angularInset = Math.min(0.008, (segment.endAngle - segment.startAngle) * 0.06)
  return segmentArc({
    ...segment,
    startAngle: segment.startAngle + angularInset,
    endAngle: segment.endAngle - angularInset,
    innerRadius: segment.innerRadius + 3,
    outerRadius: segment.outerRadius - 3,
  })
}

function lighten(hex, amount) {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
  return `rgb(${channels.map((channel) => Math.round(channel + (255 - channel) * amount)).join(',')})`
}

function darken(color, amount = 0.36) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [25, 55, 95]
  return `rgb(${channels.map((channel) => Math.round(channel * (1 - amount))).join(',')})`
}

function topBranch(node) {
  let current = node
  while (current.parent && current.parent.depth > 0) current = current.parent
  return current
}

function segmentColor(segment) {
  const branch = topBranch(segment.node)
  const branches = hierarchyRoot.value.children || []
  const branchIndex = Math.max(0, branches.findIndex((node) => node.data.id === branch.data.id))
  return lighten(branchColors[branchIndex % branchColors.length], Math.min(0.46, (segment.node.depth - 1) * 0.1))
}

function exerciseSelectionColor(segment) {
  return darken(segmentColor(segment), 0.36)
}

function segmentMetrics(segment) {
  const angle = (segment.startAngle + segment.endAngle) / 2
  const radius = (segment.innerRadius + segment.outerRadius) / 2
  const angularLength = (segment.endAngle - segment.startAngle) * radius
  const radialLength = segment.outerRadius - segment.innerRadius
  return { angle, radius, angularLength, radialLength }
}

function radialLabelArea(segment) {
  const hasCount = Number(props.exerciseCounts[segment.node.data.id]) > 0
  const startRadius = segment.innerRadius + 18
  const endRadius = segment.outerRadius - (hasCount ? 54 : 18)
  const width = Math.max(30, endRadius - startRadius)
  return {
    startRadius,
    endRadius,
    width,
    radius: startRadius + width / 2,
  }
}

function labelFontSize(segment) {
  return Math.max(11, Math.min(18, ringWidth.value * 0.19 - (segment.node.depth - 1) * 0.45))
}

function wrapLabel(title, charactersPerLine, maximumLines) {
  const lines = []
  let remaining = (title || 'Sin título').trim()
  const limit = Math.max(3, charactersPerLine)
  const lineLimit = Math.max(1, maximumLines)
  while (remaining && lines.length < lineLimit) {
    if (remaining.length <= limit) {
      lines.push(remaining)
      remaining = ''
      break
    }
    let cut = remaining.lastIndexOf(' ', limit)
    if (cut < Math.floor(limit * 0.45)) cut = limit
    lines.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining && lines.length) {
    const last = lines.length - 1
    lines[last] = `${lines[last].slice(0, Math.max(1, limit - 1)).trim()}…`
  }
  return lines
}

const mathDelimiterPattern = /(\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\])/g

function hasMathLabel(title) {
  mathDelimiterPattern.lastIndex = 0
  return mathDelimiterPattern.test(title || '')
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderMathLabel(title) {
  const source = String(title || '')
  let cursor = 0
  let rendered = ''
  mathDelimiterPattern.lastIndex = 0
  for (const match of source.matchAll(mathDelimiterPattern)) {
    rendered += escapeHtml(source.slice(cursor, match.index))
    const expression = match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    const displayMode = match[0].startsWith('$$') || match[0].startsWith('\\[')
    const normalizedExpression = match[0].startsWith('$')
      ? expression.replace(/\\([\[\]])/g, '$1')
      : expression
    rendered += katex.renderToString(normalizedExpression, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    })
    cursor = match.index + match[0].length
  }
  return rendered + escapeHtml(source.slice(cursor))
}

function isAngularLabel(segment) {
  const { angularLength, radialLength } = segmentMetrics(segment)
  return angularLength > radialLength
}

function labelLines(segment) {
  const { angularLength, radialLength } = segmentMetrics(segment)
  const fontSize = labelFontSize(segment)
  if (isAngularLabel(segment)) {
    return wrapLabel(
      segment.node.data.title,
      Math.floor((angularLength - 14) / (fontSize * 0.55)),
      Math.min(3, Math.max(1, Math.floor(radialLength / (fontSize * 1.15)))),
    )
  }
  const radialArea = radialLabelArea(segment)
  return wrapLabel(
    segment.node.data.title,
    Math.floor(radialArea.width / (fontSize * 0.55)),
    Math.min(3, Math.max(1, Math.floor(angularLength / (fontSize * 1.15)))),
  )
}

function labelVisible(segment) {
  const { angularLength, radialLength } = segmentMetrics(segment)
  return Math.max(angularLength, radialLength) >= 32 && labelLines(segment).length > 0
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-')
}

function pointOnCircle(angle, radius) {
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius }
}

function curvedPath(segment, lineIndex, totalLines) {
  const fontSize = labelFontSize(segment)
  const radius = segmentMetrics(segment).radius + (lineIndex - (totalLines - 1) / 2) * fontSize * 1.15
  const inset = Math.min(0.025, (segment.endAngle - segment.startAngle) * 0.12)
  const startAngle = segment.startAngle + inset
  const endAngle = segment.endAngle - inset
  const middleAngle = (startAngle + endAngle) / 2
  const reverse = middleAngle > Math.PI / 2 && middleAngle < 3 * Math.PI / 2
  const start = pointOnCircle(reverse ? endAngle : startAngle, radius)
  const end = pointOnCircle(reverse ? startAngle : endAngle, radius)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
  const sweep = reverse ? 0 : 1
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`
}

const labelEntries = computed(() => segments.value
  .filter((segment) => labelVisible(segment) && !hasMathLabel(segment.node.data.title))
  .map((segment) => ({
    segment,
    lines: labelLines(segment),
    angular: isAngularLabel(segment),
    fontSize: labelFontSize(segment),
  })))

const mathLabelEntries = computed(() => segments.value
  .filter((segment) => labelVisible(segment) && hasMathLabel(segment.node.data.title))
  .map((segment) => ({
    segment,
    html: renderMathLabel(segment.node.data.title),
    angular: isAngularLabel(segment),
    fontSize: labelFontSize(segment),
  })))

function mathLabelBox(entry) {
  const { angle, radius, angularLength, radialLength } = segmentMetrics(entry.segment)
  const degrees = angle * 180 / Math.PI
  const radialArea = radialLabelArea(entry.segment)
  const width = Math.max(38, Math.min(340, entry.angular ? angularLength - 14 : radialArea.width))
  const height = Math.max(28, Math.min(110, (entry.angular ? radialLength : angularLength) - 12))
  if (entry.angular) {
    const point = pointOnCircle(angle, radius)
    const rotation = degrees > 90 && degrees < 270 ? degrees + 180 : degrees
    return {
      width,
      height,
      x: -width / 2,
      y: -height / 2,
      transform: `translate(${point.x} ${point.y}) rotate(${rotation})`,
    }
  }
  const point = pointOnCircle(angle, radialArea.radius)
  const rotation = degrees - 90 + (degrees >= 180 ? 180 : 0)
  return {
    width,
    height,
    x: -width / 2,
    y: -height / 2,
    transform: `translate(${point.x} ${point.y}) rotate(${rotation})`,
  }
}

function mathOverlayStyle(entry) {
  const box = mathLabelBox(entry)
  const { angle, radius } = segmentMetrics(entry.segment)
  const radialArea = radialLabelArea(entry.segment)
  const degrees = angle * 180 / Math.PI
  const point = pointOnCircle(angle, entry.angular ? radius : radialArea.radius)
  const rotation = entry.angular
    ? (degrees > 90 && degrees < 270 ? degrees + 180 : degrees)
    : degrees - 90 + (degrees >= 180 ? 180 : 0)
  return {
    left: `${centerX + point.x - box.width / 2}px`,
    top: `${centerY + point.y - box.height / 2}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    transform: `rotate(${rotation}deg)`,
    fontSize: `${entry.fontSize}px`,
  }
}

function syncMathOverlayTransform(transform = currentZoomTransform) {
  if (!prefersTouchRendering || !mathOverlayViewbox.value || !svgElement.value || !mapHost.value) return
  currentZoomTransform = transform
  const svgBounds = svgElement.value.getBoundingClientRect()
  const hostBounds = mapHost.value.getBoundingClientRect()
  const baseScale = Math.min(svgBounds.width / width, svgBounds.height / height)
  const renderedWidth = width * baseScale
  const renderedHeight = height * baseScale
  const alignmentX = props.fitAlignment === 'bottom-right' ? svgBounds.width - renderedWidth : (svgBounds.width - renderedWidth) / 2
  const alignmentY = props.fitAlignment === 'bottom-right' ? svgBounds.height - renderedHeight : (svgBounds.height - renderedHeight) / 2
  const left = svgBounds.left - hostBounds.left + alignmentX + transform.x * baseScale
  const top = svgBounds.top - hostBounds.top + alignmentY + transform.y * baseScale
  mathOverlayViewbox.value.style.transform = `translate(${left}px, ${top}px) scale(${baseScale * transform.k})`
}

const curvedLabelPaths = computed(() => labelEntries.value
  .filter((entry) => entry.angular)
  .flatMap((entry) => entry.lines.map((line, index) => ({
    id: `sunburst-label-${safeId(entry.segment.node.data.id)}-${index}`,
    line,
    fontSize: entry.fontSize,
    segment: entry.segment,
    path: curvedPath(entry.segment, index, entry.lines.length),
  }))))

function radialLabelTransform(entry) {
  const { segment } = entry
  const { angle } = segmentMetrics(segment)
  const degrees = angle * 180 / Math.PI
  return `rotate(${degrees - 90}) translate(${radialLabelArea(segment).radius},0) rotate(${degrees >= 180 ? 180 : 0})`
}

function radialLineOffset(entry, index) {
  return index === 0 ? -((entry.lines.length - 1) * entry.fontSize * 1.08) / 2 : entry.fontSize * 1.08
}

function segmentActionCorners(segment) {
  const inset = Math.min(0.014, (segment.endAngle - segment.startAngle) * 0.06)
  const radius = segment.outerRadius + 5
  const corners = [
    pointOnCircle(segment.startAngle + inset, radius),
    pointOnCircle(segment.endAngle - inset, radius),
  ].sort((a, b) => a.x - b.x)
  return { add: corners[0], remove: corners[1] }
}

const editingSegment = computed(() => segments.value.find((segment) => segment.node.data.id === editingId.value) || null)

function countTransform(entry) {
  const { segment, angular, fontSize } = entry
  const { angle, radius } = segmentMetrics(segment)
  const degrees = angle * 180 / Math.PI
  if (angular) {
    const lineCount = entry.lines?.length || 1
    const lastLineRadius = radius + ((lineCount - 1) / 2) * fontSize * 1.15
    // La segunda línea queda hacia el interior del arco: es la posición visual inferior del título.
    const badgeRadius = Math.max(segment.innerRadius + 14, lastLineRadius - fontSize * 1.08 - 5)
    const point = pointOnCircle(angle, badgeRadius)
    return `translate(${point.x}, ${point.y}) rotate(${degrees})`
  }
  const point = pointOnCircle(angle, Math.max(segment.innerRadius + 22, segment.outerRadius - 27))
  const radialRotation = degrees - 90 + (degrees >= 180 ? 180 : 0)
  return `translate(${point.x}, ${point.y}) rotate(${radialRotation})`
}

const countEntries = computed(() => [
  ...labelEntries.value.map((entry) => ({ ...entry, transform: countTransform(entry) })),
  ...mathLabelEntries.value.map((entry) => ({ ...entry, transform: countTransform(entry) })),
].map((entry) => ({
  ...entry,
  count: Number(props.exerciseCounts[entry.segment.node.data.id]) || 0,
  selected: (conceptSelectionMode.value && exerciseSelectedIdSet.value.has(entry.segment.node.data.id))
    || (assignmentMode.value && subjectIdSet.value.has(entry.segment.node.data.id)),
  color: darken(segmentColor(entry.segment), 0.18),
  selectionColor: exerciseSelectionColor(entry.segment),
})).filter((entry) => entry.count > 0))

function toggleExerciseNode(nodeId) {
  if (!conceptSelectionMode.value) return
  emit('update-selected-node-ids', toggleHierarchySelection(props.nodes, props.selectedNodeIds, nodeId))
}

function toggleSegmentSelection(segment, event) {
  if (conceptSelectionMode.value) {
    if (event?.detail > 1) return
    toggleExerciseNode(segment.node.data.id)
    return
  }
  if (assignmentMode.value) {
    if (event?.detail > 1) return
    toggleSubjectNode(segment.node.data.id)
    return
  }
  if (!props.configurationMode || suppressNextClick || event?.detail > 1) {
    suppressNextClick = false
    return
  }
  const id = segment.node.data.id
  if (selectedIdSet.value.has(id)) {
    selectedIds.value = selectedIds.value.filter((selectedId) => selectedId !== id)
    return
  }
  const parentId = segment.node.data.parentId
  const currentParentId = selectedIds.value.length
    ? props.nodes.find((node) => node.id === selectedIds.value[0])?.parentId
    : parentId
  selectedIds.value = currentParentId === parentId ? [...selectedIds.value, id] : [id]
}

function toggleRootSelection(event) {
  if (event?.detail > 1) return
  if (conceptSelectionMode.value) {
    toggleExerciseNode(rootId)
    return
  }
  if (!props.configurationMode) return
  if (assignmentMode.value) {
    toggleSubjectNode(rootId)
    return
  }
  selectedIds.value = selectedIdSet.value.has(rootId) ? [] : [rootId]
}

function handleRootDoubleClick() {
  if (hierarchyRoot.value.children?.length) fitView()
}

function beginSegmentPointer(segment, event) {
  if (event.pointerType !== 'touch') return
  touchState.value = {
    id: segment.node.data.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function moveSegmentPointer(event) {
  const touch = touchState.value
  if (!touch || touch.pointerId !== event.pointerId) return
  if (Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) >= 10) touch.moved = true
}

function finishSegmentPointer(segment, event) {
  const touch = touchState.value
  if (!touch || touch.pointerId !== event.pointerId) return
  event.currentTarget.releasePointerCapture?.(event.pointerId)
  if (!touch.moved) {
    const now = Date.now()
    if (lastTouch.id === segment.node.data.id && now - lastTouch.time < 380) {
      suppressNextClick = true
      lastTouch = { id: null, time: 0 }
      zoomToSegment(segment)
    } else {
      lastTouch = { id: segment.node.data.id, time: now }
    }
  }
  touchState.value = null
}

function cancelSegmentPointer() {
  touchState.value = null
}

function beginEdit(segment) {
  if (!props.configurationMode || assignmentMode.value) return
  editingId.value = segment.node.data.id
  nextTick(() => {
    const editor = mapHost.value?.querySelector(`[data-sunburst-editor-id="${segment.node.data.id}"]`)
    if (!editor) return
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
}

function handleLabelClick(segment) {
  if (conceptSelectionMode.value) {
    toggleExerciseNode(segment.node.data.id)
    return
  }
  if (assignmentMode.value) {
    toggleSubjectNode(segment.node.data.id)
    return
  }
  beginEdit(segment)
}

function selectSubject(subjectId) {
  emit('select-subject', props.activeSubjectId === subjectId ? null : subjectId)
}

function toggleSubjectNode(nodeId) {
  if (!assignmentMode.value) return
  emit('update-subject-node-ids', toggleHierarchySelection(props.nodes, props.subjectNodeIds, nodeId))
}

function finishEdit(segment, event) {
  const title = event.target.textContent.trim()
  if (title && title !== segment.node.data.title) emit('rename-node', { id: segment.node.data.id, title })
  editingId.value = null
}

function editOverlay(segment) {
  const [x, y] = segmentArc.centroid(segment)
  const width = Math.max(120, Math.min(260, Math.max(segmentMetrics(segment).angularLength, ringWidth.value * 1.5)))
  return { x: x - width / 2, y: y - 23, width }
}

function addSegmentNode(segment) {
  if (!props.disabled) emit('add-node', segment.node.data.id)
}

function addRootNode() {
  if (!props.disabled) emit('add-node', rootId)
}

function deleteSegmentNode(segment) {
  if (props.disabled) return
  selectedIds.value = selectedIds.value.filter((id) => id !== segment.node.data.id)
  emit('delete-node', segment.node.data.id)
}

function groupSelectedNodes() {
  if (props.disabled || !selectedSiblingContext.value) return
  emit('group-nodes', { parentId: selectedSiblingContext.value.parentId, nodeIds: [...selectedIds.value] })
  selectedIds.value = []
}

function groupControlGeometry() {
  const context = selectedSiblingContext.value
  if (!context) return { point: { x: 0, y: 0 }, angle: 0 }
  const first = context.segments[0]
  const last = context.segments.at(-1)
  const angle = (first.startAngle + last.endAngle) / 2
  if (context.parent.data.id === rootId) return { point: pointOnCircle(angle, centerRadius), angle }
  const parentSegment = segments.value.find((segment) => segment.node === context.parent)
  return {
    point: parentSegment ? pointOnCircle(angle, parentSegment.outerRadius) : { x: 0, y: 0 },
    angle,
  }
}

function orientedControlTransform(point, angle) {
  return `translate(${point.x}, ${point.y}) rotate(${angle * 180 / Math.PI})`
}

function swapWithSibling(control) {
  if (props.disabled) return
  emit('reorder-nodes', { sourceId: control.source.node.data.id, targetId: control.target.data.id })
}

function handleSegmentKey(segment, event) {
  if (props.configurationMode || conceptSelectionMode.value) toggleSegmentSelection(segment, { detail: 1 })
  else zoomToSegment(segment)
  event.currentTarget.blur?.()
}

function fitView() {
  if (!svgElement.value || !zoomBehavior) return
  const scale = fittedScale.value
  const mapRadius = fullMapRadius.value
  const margin = effectiveFitMargin.value
  const translation = props.fitAlignment === 'bottom-right'
    ? {
        x: width - margin - scale * (centerX + mapRadius),
        y: height - margin - scale * (centerY + mapRadius),
      }
    : {
        x: centerX * (1 - scale),
        y: centerY * (1 - scale),
      }
  const transform = zoomIdentity.translate(translation.x, translation.y).scale(scale)
  select(svgElement.value).call(zoomBehavior.transform, transform)
}

function zoomToSegment(segment) {
  if (!segment.node.children?.length || !svgElement.value || !zoomBehavior) return
  editingId.value = null
  const [localX, localY] = segmentArc.centroid(segment)
  const { angularLength, radialLength } = segmentMetrics(segment)
  const targetScale = Math.max(1.5, Math.min(2.9, 520 / Math.max(150, angularLength, radialLength * 1.5)))
  const worldX = centerX + localX
  const worldY = centerY + localY
  const transform = zoomIdentity
    .translate(centerX - targetScale * worldX, centerY - targetScale * worldY)
    .scale(targetScale)
  select(svgElement.value).call(zoomBehavior.transform, transform)
}

watch(() => props.configurationMode, (enabled) => {
  if (!enabled) {
    editingId.value = null
    selectedIds.value = []
    cancelSegmentPointer()
  }
})

watch(() => props.activeSubjectId, () => {
  editingId.value = null
  selectedIds.value = []
  nextTick(fitView)
})

watch(() => props.nodes.map((node) => node.id), (ids) => {
  const availableIds = new Set(ids)
  selectedIds.value = selectedIds.value.filter((id) => availableIds.has(id))
})

watch(() => props.nodes.length, (current, previous) => {
  if (current <= previous || !props.configurationMode) return
  const newest = props.nodes.at(-1)
  if (!newest) return
  nextTick(() => {
    const segment = segments.value.find((item) => item.node.data.id === newest.id)
    if (segment) {
      selectedIds.value = [newest.id]
      beginEdit(segment)
    }
  })
})

onMounted(() => {
  const svg = select(svgElement.value)
  zoomBehavior = zoom()
    .scaleExtent([0.35, 3.4])
    .on('start', () => mapHost.value?.classList.add('math-concept-map-transforming'))
    .on('zoom', (event) => {
      select(contentGroup.value).attr('transform', event.transform)
      syncMathOverlayTransform(event.transform)
    })
    .on('end', () => mapHost.value?.classList.remove('math-concept-map-transforming'))
  svg.call(zoomBehavior)
  svg.on('dblclick.zoom', null)
  if (prefersTouchRendering) {
    overlayResizeObserver = new ResizeObserver(() => syncMathOverlayTransform())
    overlayResizeObserver.observe(svgElement.value)
  }
  fitView()
})

onBeforeUnmount(() => {
  overlayResizeObserver?.disconnect()
  if (svgElement.value && zoomBehavior) select(svgElement.value).on('.zoom', null)
})

defineExpose({ fitView })
</script>

<template>
  <div
    ref="mapHost"
    class="math-concept-map"
    :class="{
      'math-concept-map-disabled': disabled,
      'math-concept-map-configuring': configurationMode,
      'math-concept-map-assigning': assignmentMode,
      'math-concept-map-selecting': conceptSelectionMode,
      'math-concept-map-lightweight': lightweightRendering,
    }"
  >
    <div
      v-if="showCurriculum"
      class="curriculum-map"
      aria-label="Asignaturas de Matemáticas por curso"
      @pointerdown.stop
      @dblclick.stop
      @wheel.stop
    >
      <table>
        <thead>
          <tr><th>Curso</th><th>Asignaturas</th></tr>
        </thead>
        <tbody>
          <template v-for="row in courseSubjects" :key="row.course">
            <tr
              v-for="(subject, subjectIndex) in row.subjects"
              :key="subject.id"
              :class="{
                'curriculum-stage-start': row.stageStart && subjectIndex === 0,
                'curriculum-subject-active': activeSubjectId === subject.id,
              }"
              :style="{ '--course-color': row.color }"
            >
              <th
                v-if="subjectIndex === 0"
                scope="rowgroup"
                :rowspan="row.subjects.length"
                :class="{ 'curriculum-course-active': row.subjects.some((item) => item.id === activeSubjectId) }"
              >{{ row.course }}</th>
              <td>
                <button
                  type="button"
                  :aria-pressed="activeSubjectId === subject.id"
                  :aria-label="`${activeSubjectId === subject.id ? 'Mostrar mapa completo; asignatura activa' : 'Mostrar contenidos de'} ${subject.title}, ${row.course}`"
                  @click="selectSubject(subject.id)"
                >
                  <span>{{ subject.title }}</span>
                  <span v-if="activeSubjectId === subject.id" class="curriculum-subject-check" aria-hidden="true">✓</span>
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <svg
      ref="svgElement"
      :viewBox="`0 0 ${width} ${height}`"
      :preserveAspectRatio="fitAlignment === 'bottom-right' ? 'xMaxYMax meet' : 'xMidYMid meet'"
      role="application"
      aria-label="Mapa radial de conceptos de Matemáticas"
    >
      <defs>
        <filter id="sunburst-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#19375f" flood-opacity=".16" />
        </filter>
        <path v-for="entry in curvedLabelPaths" :id="entry.id" :key="entry.id" :d="entry.path" />
      </defs>

      <g ref="contentGroup">
        <g :transform="`translate(${centerX}, ${centerY})`">
          <g class="sunburst-segments" :filter="lightweightRendering ? undefined : 'url(#sunburst-shadow)'">
            <path
              v-for="segment in segments"
              :key="segment.node.data.id"
              class="sunburst-segment"
              :class="{
                'sunburst-segment-leaf': !segment.node.children?.length,
                'sunburst-segment-selected': selectedIdSet.has(segment.node.data.id),
                'sunburst-segment-subject-selected': assignmentMode && subjectIdSet.has(segment.node.data.id),
                'sunburst-segment-subject-excluded': assignmentMode && !subjectIdSet.has(segment.node.data.id),
                'sunburst-segment-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(segment.node.data.id),
              }"
              :data-node-id="segment.node.data.id"
              :d="segmentPath(segment)"
              :fill="segmentColor(segment)"
              :style="{ '--exercise-selected-color': exerciseSelectionColor(segment) }"
              role="button"
              tabindex="0"
              :aria-label="(configurationMode || conceptSelectionMode) ? `Seleccionar ${segment.node.data.title}` : (segment.node.children?.length ? `Ampliar ${segment.node.data.title}` : segment.node.data.title)"
              @click.stop="toggleSegmentSelection(segment, $event)"
              @dblclick.stop.prevent="zoomToSegment(segment)"
              @pointerdown="beginSegmentPointer(segment, $event)"
              @pointermove="moveSegmentPointer($event)"
              @pointerup="finishSegmentPointer(segment, $event)"
              @pointercancel="cancelSegmentPointer"
              @keydown.enter.prevent="handleSegmentKey(segment, $event)"
              @keydown.space.prevent="handleSegmentKey(segment, $event)"
            ><title>{{ segment.node.data.title }}</title></path>
          </g>

          <g class="sunburst-labels" :class="{ 'sunburst-labels-editable': configurationMode }">
            <text
              v-for="entry in curvedLabelPaths"
              :key="`text-${entry.id}`"
              class="sunburst-label sunburst-curved-label"
              :class="{ 'sunburst-label-subject-excluded': assignmentMode && !subjectIdSet.has(entry.segment.node.data.id), 'sunburst-label-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(entry.segment.node.data.id) }"
              :font-size="entry.fontSize"
              @click.stop="handleLabelClick(entry.segment)"
            >
              <textPath :href="`#${entry.id}`" startOffset="50%">{{ entry.line }}</textPath>
            </text>

            <text
              v-for="entry in labelEntries.filter((item) => !item.angular)"
              :key="`radial-${entry.segment.node.data.id}`"
              class="sunburst-label sunburst-radial-label"
              :class="{ 'sunburst-label-subject-excluded': assignmentMode && !subjectIdSet.has(entry.segment.node.data.id), 'sunburst-label-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(entry.segment.node.data.id) }"
              :transform="radialLabelTransform(entry)"
              :font-size="entry.fontSize"
              @click.stop="handleLabelClick(entry.segment)"
            >
              <tspan
                v-for="(line, index) in entry.lines"
                :key="index"
                x="0"
                :dy="radialLineOffset(entry, index)"
              >{{ line }}</tspan>
            </text>
          </g>

          <g v-if="!prefersTouchRendering" class="sunburst-math-labels" :class="{ 'sunburst-math-labels-editable': configurationMode }">
            <foreignObject
              v-for="entry in mathLabelEntries"
              v-show="editingId !== entry.segment.node.data.id"
              :key="`math-${entry.segment.node.data.id}`"
              :x="mathLabelBox(entry).x"
              :y="mathLabelBox(entry).y"
              :width="mathLabelBox(entry).width"
              :height="mathLabelBox(entry).height"
              :transform="mathLabelBox(entry).transform"
              class="sunburst-math-label"
              :class="{ 'sunburst-label-subject-excluded': assignmentMode && !subjectIdSet.has(entry.segment.node.data.id), 'sunburst-math-label-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(entry.segment.node.data.id) }"
              @click.stop="handleLabelClick(entry.segment)"
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                class="sunburst-math-label-inner"
                :style="{ fontSize: `${entry.fontSize}px` }"
                v-html="entry.html"
              />
            </foreignObject>
          </g>

          <g class="sunburst-counts" aria-hidden="true">
            <g
              v-for="entry in countEntries"
              :key="`count-${entry.segment.node.data.id}`"
              :transform="entry.transform"
              class="sunburst-count"
              :class="{ 'sunburst-count-radial': !entry.angular, 'sunburst-count-selected': entry.selected }"
            >
              <circle :r="assignmentMode ? 15 : 11.5" :fill="entry.selected ? '#fff' : entry.color" />
              <text y="1" :fill="entry.selected ? entry.selectionColor : '#fff'">{{ entry.count }}</text>
            </g>
          </g>

          <foreignObject
            v-if="editingSegment"
            :x="editOverlay(editingSegment).x"
            :y="editOverlay(editingSegment).y"
            :width="editOverlay(editingSegment).width"
            height="46"
            class="sunburst-edit-overlay"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              :data-sunburst-editor-id="editingSegment.node.data.id"
              class="sunburst-edit-field"
              role="textbox"
              contenteditable="true"
              spellcheck="false"
              @click.stop
              @mousedown.stop
              @blur="finishEdit(editingSegment, $event)"
              @keydown.enter.prevent="$event.target.blur()"
            >{{ editingSegment.node.data.title }}</div>
          </foreignObject>

          <g v-if="configurationMode && !assignmentMode && !editingSegment" class="sunburst-node-actions">
            <template v-if="selectedIds.length === 1">
              <g
                v-for="segment in selectedSegments"
                :key="`actions-${segment.node.data.id}`"
                class="sunburst-segment-actions"
                :style="{ '--selected-color': segmentColor(segment) }"
              >
                <g class="sunburst-control sunburst-segment-add" :transform="`translate(${segmentActionCorners(segment).add.x}, ${segmentActionCorners(segment).add.y})`" role="button" tabindex="0" :aria-label="`Añadir subnivel a ${segment.node.data.title}`" @click.stop="addSegmentNode(segment)">
                  <circle r="22" />
                  <path d="M -7 0 H 7 M 0 -7 V 7" />
                  <title>Añadir subnivel a {{ segment.node.data.title }}</title>
                </g>
                <g class="sunburst-control sunburst-segment-delete" :transform="`translate(${segmentActionCorners(segment).remove.x}, ${segmentActionCorners(segment).remove.y})`" role="button" tabindex="0" :aria-label="`Eliminar ${segment.node.data.title}`" @click.stop="deleteSegmentNode(segment)">
                  <circle r="22" />
                  <path d="M -6.5 -6.5 L 6.5 6.5 M 6.5 -6.5 L -6.5 6.5" />
                  <title>Eliminar {{ segment.node.data.title }}</title>
                </g>
              </g>
            </template>

            <g
              v-for="control in swapControls"
              :key="`swap-${control.target.data.id}`"
              class="sunburst-control sunburst-swap-control"
              :style="{ '--selected-color': segmentColor(control.source) }"
              :transform="orientedControlTransform(control.point, control.angle)"
              role="button"
              tabindex="0"
              :aria-label="`Intercambiar con ${control.target.data.title}`"
              @click.stop="swapWithSibling(control)"
            >
              <circle r="21" />
              <path d="M -8 -3 H 6 M 2 -7 L 7 -3 L 2 1 M 8 4 H -6 M -2 0 L -7 4 L -2 8" />
              <title>Intercambiar con {{ control.target.data.title }}</title>
            </g>

            <g
              v-if="selectedSiblingContext"
              class="sunburst-control sunburst-group-control"
              :transform="orientedControlTransform(groupControlGeometry().point, groupControlGeometry().angle)"
              role="button"
              tabindex="0"
              aria-label="Unir los sectores seleccionados en un nuevo subnivel"
              @click.stop="groupSelectedNodes"
            >
              <circle r="23" />
              <path d="M -8 -8 V -3 C -8 2 -2 2 0 8 C 2 2 8 2 8 -3 V -8" />
              <title>Unir los sectores seleccionados</title>
            </g>
          </g>

          <g
            class="sunburst-root-node"
            :class="{
              'sunburst-root-selected': selectedIdSet.has(rootId),
              'sunburst-root-subject-selected': assignmentMode && subjectIdSet.has(rootId),
              'sunburst-root-subject-excluded': assignmentMode && !subjectIdSet.has(rootId),
              'sunburst-root-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(rootId),
            }"
            role="button"
            tabindex="0"
            :aria-label="assignmentMode ? `${subjectIdSet.has(rootId) ? 'Quitar' : 'Asignar'} Matemáticas` : 'Seleccionar Matemáticas'"
            @click.stop="toggleRootSelection($event)"
            @dblclick.stop.prevent="handleRootDoubleClick"
          >
            <circle class="sunburst-center" :r="centerRadius" />
            <foreignObject :x="-122" :y="-68" width="244" height="136" class="sunburst-center-label">
              <div xmlns="http://www.w3.org/1999/xhtml" class="sunburst-center-label-inner">
                <div class="sunburst-center-title-row">
                  <span class="sunburst-center-title">{{ centerDisplayTitle }}</span>
                  <span v-if="centerExerciseCount" class="sunburst-center-count">{{ centerExerciseCount }}</span>
                </div>
              </div>
            </foreignObject>
          </g>

          <g v-if="configurationMode && !assignmentMode && !editingSegment && selectedIdSet.has(rootId)" class="sunburst-control sunburst-add" :transform="`translate(${centerRadius * 0.71}, ${-centerRadius * 0.71})`" @click.stop="addRootNode">
            <circle r="23" />
            <path d="M -8 0 H 8 M 0 -8 V 8" />
            <title>Añadir subnivel a Matemáticas</title>
          </g>
        </g>
      </g>
    </svg>

    <div v-if="prefersTouchRendering" class="sunburst-html-math-overlay">
      <div ref="mathOverlayViewbox" class="sunburst-html-math-viewbox">
        <div
          v-for="entry in mathLabelEntries"
          v-show="editingId !== entry.segment.node.data.id"
          :key="`html-math-${entry.segment.node.data.id}`"
          class="sunburst-html-math-label"
          :class="{
            'sunburst-label-subject-excluded': assignmentMode && !subjectIdSet.has(entry.segment.node.data.id),
            'sunburst-math-label-exercise-selected': conceptSelectionMode && exerciseSelectedIdSet.has(entry.segment.node.data.id),
            'sunburst-html-math-label-editable': configurationMode,
          }"
          :style="mathOverlayStyle(entry)"
          @click.stop="handleLabelClick(entry.segment)"
        >
          <div class="sunburst-math-label-inner" v-html="entry.html" />
        </div>
      </div>
    </div>

    <div v-if="showHint" class="math-concept-map-hint">
      <v-icon icon="mdi-cursor-default-click-outline" size="16" />
      <span v-if="conceptSelectionMode">Clic para seleccionar uno o varios conceptos · doble clic para ampliar</span>
      <span v-else-if="assignmentMode">Clic para incluir o excluir contenidos de la asignatura · los ascendientes se incluyen automáticamente</span>
      <span v-else-if="configurationMode">Clic para seleccionar · doble clic para ampliar · usa los controles laterales para reordenar</span>
      <span v-else>Doble clic sobre un sector con subniveles para ampliarlo · arrastra para desplazar</span>
    </div>
  </div>
</template>

<style scoped>
.math-concept-map { position: relative; width: 100%; height: 100%; min-height: 520px; overflow: hidden; background: radial-gradient(circle at 50% 48%, #fff 0, #fbfcff 42%, #f3f7fe 100%); }
.curriculum-map { position: absolute; z-index: 4; top: 16px; left: 16px; width: max-content; max-width: calc(100% - 32px); overflow: hidden; border: 1px solid rgba(25,55,95,.24); border-radius: 14px; background: rgba(255,255,255,.95); box-shadow: 0 9px 26px rgba(25,55,95,.14); cursor: default; backdrop-filter: blur(9px); }
.curriculum-map table { width: auto; border-collapse: collapse; color: #304863; font-size: .72rem; }
.curriculum-map thead { background: #19375f; color: #fff; font-size: .61rem; letter-spacing: .075em; text-transform: uppercase; }
.curriculum-map th, .curriculum-map td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--course-color, #19375f) 19%, white); text-align: left; vertical-align: middle; }
.curriculum-map thead th { border-bottom-color: rgba(255,255,255,.18); }
.curriculum-map tbody th { width: 72px; background: var(--course-color); color: #fff; font-size: .69rem; font-weight: 780; white-space: nowrap; }
.curriculum-map tbody td { padding: 0; background: color-mix(in srgb, var(--course-color) 9%, white); color: color-mix(in srgb, var(--course-color) 78%, #19375f); font-weight: 650; line-height: 1.25; white-space: nowrap; }
.curriculum-map tbody td button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 9px; padding: 7px 10px; border: 0; outline: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.curriculum-map tbody td button:hover { background: color-mix(in srgb, var(--course-color) 15%, transparent); }
.curriculum-map tbody td button:focus-visible { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--course-color) 70%, white); }
.curriculum-map tbody tr.curriculum-subject-active td { background: color-mix(in srgb, var(--course-color) 23%, white); color: color-mix(in srgb, var(--course-color) 88%, #19375f); }
.curriculum-map tbody th.curriculum-course-active { box-shadow: inset 0 0 0 3px rgba(255,255,255,.72); }
.curriculum-subject-check { display: grid; width: 16px; height: 16px; flex: 0 0 16px; place-items: center; border-radius: 50%; background: var(--course-color); color: #fff; font-size: .58rem; font-weight: 900; }
.curriculum-map tbody tr:last-child > * { border-bottom: 0; }
.curriculum-map tbody tr.curriculum-stage-start > * { border-top: 3px solid #fff; }
svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
svg:active { cursor: grabbing; }
.sunburst-segment { cursor: zoom-in; transition: opacity .16s ease, filter .16s ease; }
.sunburst-segment:focus { outline: none; }
.sunburst-segment-leaf { cursor: default; }
.sunburst-segment:hover { opacity: .84; filter: brightness(1.04); }
.math-concept-map-configuring .sunburst-segment { cursor: pointer; }
.math-concept-map-selecting .sunburst-segment { cursor: pointer; }
.math-concept-map-assigning .sunburst-segment-subject-excluded { opacity: 1; filter: none; }
.math-concept-map-assigning .sunburst-segment-subject-excluded:hover { opacity: .84; filter: brightness(1.04); }
.sunburst-segment-selected { opacity: 1 !important; stroke: #173b66; stroke-width: 5; filter: brightness(1.24) drop-shadow(0 6px 8px rgba(24,55,92,.34)) !important; }
.math-concept-map-assigning .sunburst-segment-subject-selected,
.sunburst-segment-exercise-selected { opacity: 1 !important; fill: var(--exercise-selected-color) !important; stroke: rgba(255,255,255,.92); stroke-width: 3; filter: saturate(1.08) drop-shadow(0 4px 6px rgba(25,55,95,.3)) !important; }
.sunburst-label { fill: #fff; text-anchor: middle; dominant-baseline: central; font-weight: 720; letter-spacing: .01em; pointer-events: none; }
.sunburst-label-exercise-selected { fill: #fff !important; }
.math-concept-map-assigning .sunburst-label-subject-excluded { opacity: 1; }
.sunburst-labels-editable .sunburst-label { cursor: text; pointer-events: auto; }
.math-concept-map-assigning .sunburst-labels-editable .sunburst-label { cursor: pointer; }
.sunburst-curved-label textPath { text-anchor: middle; }
.sunburst-radial-label tspan { text-anchor: middle; }
.sunburst-math-label { overflow: hidden; pointer-events: none; }
.sunburst-math-labels-editable .sunburst-math-label { cursor: text; pointer-events: auto; }
.math-concept-map-assigning .sunburst-math-labels-editable .sunburst-math-label { cursor: pointer; }
.sunburst-math-label-inner { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; overflow: hidden; color: #fff; text-align: center; font-weight: 720; line-height: 1.08; overflow-wrap: anywhere; }
.sunburst-math-label-exercise-selected .sunburst-math-label-inner { color: #fff; }
.sunburst-math-label-inner :deep(.katex) { color: inherit; font-size: 1em; }
.sunburst-math-label-inner :deep(.katex-display) { margin: 0; }
.sunburst-html-math-overlay { position: absolute; z-index: 2; inset: 0; overflow: hidden; pointer-events: none; }
.sunburst-html-math-viewbox { position: absolute; top: 0; left: 0; width: 1800px; height: 1300px; transform-origin: 0 0; }
.sunburst-html-math-label { position: absolute; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #fff; text-align: center; font-weight: 720; line-height: 1.08; transform-origin: center; }
.sunburst-html-math-label-editable { cursor: text; pointer-events: auto; }
.math-concept-map-assigning .sunburst-html-math-label-editable { cursor: pointer; }
.sunburst-edit-overlay { overflow: visible; }
.sunburst-edit-field { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; padding: 5px 9px; border: 2px solid #fff; border-radius: 12px; outline: 0; background: #244f88; box-shadow: 0 5px 16px rgba(25,55,95,.25); color: #fff; text-align: center; font-size: 15px; font-weight: 720; line-height: 1.05; overflow-wrap: anywhere; }
.sunburst-center { fill: #fff; stroke: #19375f; stroke-width: 6; filter: url(#sunburst-shadow); }
.sunburst-root-node { cursor: default; outline: none; }
.math-concept-map-configuring .sunburst-root-node { cursor: pointer; }
.sunburst-root-selected .sunburst-center { fill: #eef5ff; stroke: #4d86ca; stroke-width: 10; }
.math-concept-map-assigning .sunburst-root-subject-excluded { opacity: 1; }
.math-concept-map-assigning .sunburst-root-subject-selected .sunburst-center { fill: #e8f2ff; stroke: #4d86ca; stroke-width: 8; }
.sunburst-center-label { overflow: visible; }
.sunburst-center-label-inner { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: #19375f; text-align: center; }
.sunburst-center-title-row { display: inline-flex; max-width: 100%; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.sunburst-center-title { max-width: 100%; padding: 3px 0; text-align: center; font-size: 1.5rem; font-weight: 760; line-height: 1.08; overflow-wrap: anywhere; }
.sunburst-center-count { display: inline-grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border-radius: 50%; background: #19375f; color: #fff; font-size: .7rem; font-weight: 800; }
.sunburst-root-exercise-selected .sunburst-center { fill: #e8f2ff; stroke: #4d86ca; stroke-width: 8; }
.sunburst-counts { pointer-events: none; }
.sunburst-count { filter: drop-shadow(0 1px 2px rgba(25,55,95,.14)); }
.sunburst-count circle { stroke: none; }
.sunburst-count text { text-anchor: middle; dominant-baseline: central; font-size: 10px; font-weight: 850; }
.math-concept-map-assigning .sunburst-count text { font-size: 12px; }
.math-concept-map-assigning .sunburst-center-count { width: 34px; height: 34px; flex-basis: 34px; font-size: .82rem; }
.sunburst-count-selected { filter: drop-shadow(0 2px 3px rgba(25,55,95,.24)); }
.sunburst-control { cursor: pointer; outline: none; }
.sunburst-control:focus { outline: none; }
.sunburst-control circle { fill: #fff; stroke: #86afe8; stroke-width: 2.5; transition: fill .16s ease, stroke .16s ease; }
.sunburst-control path { fill: none; stroke: #3569b8; stroke-width: 2.7; stroke-linecap: round; stroke-linejoin: round; }
.sunburst-control:hover circle { fill: #eaf2ff; stroke: #3569b8; }
.sunburst-segment-add { filter: drop-shadow(0 2px 4px rgba(25,55,95,.16)); }
.sunburst-segment-actions .sunburst-control circle, .sunburst-swap-control circle { stroke: var(--selected-color); stroke-width: 4; }
.sunburst-segment-delete path { stroke: #c83838; }
.sunburst-segment-delete:hover circle { fill: #fff0f0; stroke: var(--selected-color); }
.sunburst-swap-control { filter: drop-shadow(0 2px 5px rgba(25,55,95,.2)); }
.sunburst-swap-control path { stroke: var(--selected-color); stroke-width: 3.2; }
.sunburst-swap-control:hover circle { fill: #f4f8ff; stroke: var(--selected-color); }
.sunburst-group-control { filter: drop-shadow(0 3px 5px rgba(25,55,95,.2)); }
.sunburst-group-control circle { fill: #effaf5; stroke: #23835c; }
.sunburst-group-control path { stroke: #176b4a; }
.sunburst-group-control:hover circle { fill: #dff5e9; stroke: #176b4a; }
.math-concept-map-disabled .sunburst-control { cursor: wait; opacity: .5; pointer-events: none; }
.math-concept-map-lightweight .sunburst-center,
.math-concept-map-lightweight .sunburst-segment,
.math-concept-map-lightweight .sunburst-count,
.math-concept-map-lightweight .sunburst-control,
.math-concept-map-transforming .sunburst-segment,
.math-concept-map-transforming .sunburst-count,
.math-concept-map-transforming .sunburst-control {
  filter: none !important;
}
.math-concept-map-transforming .sunburst-segment,
.math-concept-map-transforming .sunburst-control circle {
  transition: none !important;
}
.math-concept-map-lightweight .curriculum-map { backdrop-filter: none; }
.math-concept-map-hint { position: absolute; right: 16px; bottom: 14px; display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid #e2e9f4; border-radius: 999px; background: rgba(255,255,255,.88); color: #71809a; font-size: .7rem; font-weight: 600; pointer-events: none; }
@media (pointer: coarse) {
  .curriculum-map { top: 6px; left: 6px; max-width: calc(100% - 12px); }
  .math-concept-map-hint { right: 6px; bottom: 6px; }
}
</style>
