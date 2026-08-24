<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { deleteStudentIdentitiesForGroup, loadStudentIdentitiesForGroup, saveStudentIdentities } from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  group: { type: Object, required: true },
  existingStudentIds: { type: Array, default: () => [] },
  configurationMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['dirty-change', 'validity-change', 'autosave-request', 'student-selected'])

const STUDENT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'
const MAX_STUDENTS = 50
const RESULT_COLUMN_MIN_WIDTH = 72

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeNode(node) {
  if (node?.type === 'group') {
    return {
      type: 'group',
      id: node.id,
      nivel: Number(node.nivel) === 1 ? 1 : 2,
      nombre: node.nombre || 'Grupo',
      nombreCorto: node.nombreCorto || node.nombre || 'Grupo',
      colapsado: Boolean(node.colapsado),
      children: (node.children || []).map(normalizeNode),
    }
  }
  return {
    type: 'item',
    id: node.id,
    nombre: node.nombre || node.title || 'Resultado',
    nombreCorto: node.nombreCorto || node.nombre || node.title || 'Resultado',
  }
}

function normalizeGroup(group) {
  const legacyItems = (group.evaluaciones?.columnas || []).map((column) => ({
    type: 'item',
    id: column.id,
    nombre: column.title || column.nombre || 'Resultado',
    nombreCorto: column.nombreCorto || column.title || column.nombre || 'Resultado',
  }))
  return {
    ...clone(group),
    alumnos: Array.isArray(group.alumnos) ? clone(group.alumnos) : [],
    evaluaciones: {
      estructura: (group.evaluaciones?.estructura || legacyItems).map(normalizeNode),
      resultados: group.evaluaciones?.resultados ? clone(group.evaluaciones.resultados) : {},
      pesos: group.evaluaciones?.pesos && typeof group.evaluaciones.pesos === 'object'
        ? clone(group.evaluaciones.pesos)
        : {},
    },
  }
}

const localGroup = ref(normalizeGroup(props.group))
const dirty = ref(false)
const itemDialog = ref(false)
const itemForm = ref({ nombre: '', nombreCorto: '' })
const fusionDialog = ref(false)
const fusionForm = ref({ nombre: '', nombreCorto: '' })
const pendingFusion = ref(null)
const draggedNode = ref(null)
const dropTargetId = ref(null)
const touchDrag = ref(null)
const dragPreview = ref(null)
const identityLoading = ref(true)
const identityError = ref('')
watch(identityError, (message) => {
  if (message) showAppErrorToast(message)
})
const removedStudentIds = new Set()
const deleteGroupDialog = ref(false)
const pendingDeleteGroup = ref(null)
const editNodeDialog = ref(false)
const editNodeForm = ref({ id: null, nombre: '', nombreCorto: '' })
const weightDialog = ref(false)
const weightDialogTitle = ref('')
const weightDialogParentId = ref(null)
const weightDialogNodes = ref([])
const weightDialogWeights = ref({})
const suppressTitleClick = ref(false)
let revision = 0

const structure = computed(() => localGroup.value.evaluaciones.estructura)
const students = computed(() => localGroup.value.alumnos)

function createNodeId(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function studentNameIsValid(name) {
  const [surnames, givenName, ...extra] = String(name || '').split(',')
  return Boolean(surnames?.trim() && givenName?.trim() && extra.length === 0)
}

function emitValidity() {
  emit('validity-change', localGroup.value.alumnos.every((student) => studentNameIsValid(student.nombre)))
}

function markDirty() {
  revision += 1
  if (!dirty.value) {
    dirty.value = true
    emit('dirty-change', true)
  }
  emitValidity()
}

function normalizeStudentName(student) {
  if (!studentNameIsValid(student.nombre)) {
    emitValidity()
    sortStudentsByName()
    return
  }
  const [surnames, givenName] = student.nombre.split(',')
  student.nombre = `${surnames.trim().toLocaleUpperCase('es-ES')}, ${givenName.trim()}`
  sortStudentsByName()
  markDirty()
}

function sortStudentsByName() {
  localGroup.value.alumnos.sort((left, right) => {
    const leftName = String(left?.nombre || '').trim()
    const rightName = String(right?.nombre || '').trim()
    if (!leftName && !rightName) return 0
    if (!leftName) return 1
    if (!rightName) return -1
    return leftName.localeCompare(rightName, 'es', { sensitivity: 'base' })
  })
}

function studentFlagStyle(student) {
  const colors = []
  if (student?.repetidor) colors.push('#d64545')
  if (student?.pendiente) colors.push('#d7a62a')
  if (student?.nuevo) colors.push('#2e9d62')
  const values = colors.length ? colors : ['#b4bdc9']
  const step = 100 / values.length
  const stops = values.flatMap((color, index) => [`${color} ${index * step}%`, `${color} ${(index + 1) * step}%`])
  return { '--student-flag-gradient': `linear-gradient(to bottom, ${stops.join(', ')})` }
}

function randomStudentId() {
  const existingIds = new Set([...props.existingStudentIds, ...students.value.map((student) => student.id)])
  let id = ''
  do {
    id = ''
    const acceptanceLimit = Math.floor(256 / STUDENT_ID_ALPHABET.length) * STUDENT_ID_ALPHABET.length
    while (id.length < 6) {
      const values = globalThis.crypto.getRandomValues(new Uint8Array(12))
      for (const value of values) {
        if (value < acceptanceLimit) id += STUDENT_ID_ALPHABET[value % STUDENT_ID_ALPHABET.length]
        if (id.length === 6) break
      }
    }
  } while (existingIds.has(id))
  return id
}

function addStudent() {
  if (props.disabled || !props.configurationMode || students.value.length >= MAX_STUDENTS) return
  students.value.push({ id: randomStudentId(), nombre: '' })
  markDirty()
}

function removeStudent(studentId) {
  if (props.disabled || !props.configurationMode) return
  removedStudentIds.add(studentId)
  localGroup.value.alumnos = students.value.filter((student) => student.id !== studentId)
  delete localGroup.value.evaluaciones.resultados[studentId]
  markDirty()
}

function openItemDialog() {
  if (props.disabled || !props.configurationMode) return
  itemForm.value = { nombre: '', nombreCorto: '' }
  itemDialog.value = true
}

function addItem() {
  const nombre = itemForm.value.nombre.trim()
  const nombreCorto = itemForm.value.nombreCorto.trim()
  if (!nombre || !nombreCorto) return
  structure.value.push({ type: 'item', id: createNodeId('item'), nombre, nombreCorto })
  itemDialog.value = false
  markDirty()
}

function findNode(id, nodes = structure.value, parent = null) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.id === id) return { node, parent, nodes, index }
    if (node.type === 'group') {
      const found = findNode(id, node.children, node)
      if (found) return found
    }
  }
  return null
}

function pruneEmptyGroups(nodes) {
  return nodes.flatMap((node) => {
    if (node.type !== 'group') return [node]
    node.children = pruneEmptyGroups(node.children)
    return node.children.length ? [node] : []
  })
}

function detachNode(id, { prune = true } = {}) {
  const location = findNode(id)
  if (!location) return null
  const [node] = location.nodes.splice(location.index, 1)
  if (prune) localGroup.value.evaluaciones.estructura = pruneEmptyGroups(structure.value)
  return node
}

function removeItem(itemId) {
  if (props.disabled || !props.configurationMode) return
  const location = findNode(itemId)
  if (!location || location.node.type !== 'item') return
  detachNode(itemId)
  Object.values(localGroup.value.evaluaciones.resultados).forEach((result) => delete result[itemId])
  markDirty()
}

function requestRemoveGroup(group) {
  if (props.disabled || !props.configurationMode || group?.type !== 'group') return
  pendingDeleteGroup.value = group
  deleteGroupDialog.value = true
}

function confirmRemoveGroup(preserveDescendants) {
  const group = pendingDeleteGroup.value
  const location = group ? findNode(group.id) : null
  if (!location) {
    deleteGroupDialog.value = false
    pendingDeleteGroup.value = null
    return
  }

  if (preserveDescendants) {
    location.nodes.splice(location.index, 1, ...group.children)
  } else {
    const deletedItemIds = descendantItemIds(group)
    location.nodes.splice(location.index, 1)
    Object.values(localGroup.value.evaluaciones.resultados).forEach((result) => {
      deletedItemIds.forEach((itemId) => delete result[itemId])
    })
  }
  localGroup.value.evaluaciones.estructura = pruneEmptyGroups(structure.value)
  deleteGroupDialog.value = false
  pendingDeleteGroup.value = null
  markDirty()
}

function descendantItemIds(node) {
  if (node.type === 'item') return [node.id]
  return node.children.flatMap(descendantItemIds)
}

function visibleColumnCount(node) {
  if (node.type === 'item') return 1
  if (node.colapsado) return 1
  return node.children.reduce((sum, child) => sum + visibleColumnCount(child), 0) + 1
}

function itemCell(node, rowspan = 1) {
  return { key: `item-${node.id}`, kind: 'item', node, label: node.nombreCorto, title: node.nombre, colspan: 1, rowspan }
}

function meanCell(node, rowspan = 1) {
  return { key: `mean-${node.id}`, kind: 'mean', node, label: node.nombreCorto, title: `Media de ${node.nombre}`, colspan: 1, rowspan }
}

function blankCell(key, colspan = 1) {
  return { key, kind: 'blank', colspan }
}

function groupCell(node, colspan, rowspan = 1, labelOverride = null) {
  return {
    key: `group-${node.id}`,
    kind: 'group',
    node,
    label: labelOverride ?? (node.colapsado ? node.nombreCorto : node.nombre),
    title: node.nombre,
    colspan,
    rowspan,
  }
}

const headerLayout = computed(() => {
  const depth = structure.value.some((node) => node.type === 'group' && node.nivel === 1)
    ? 3
    : (structure.value.some((node) => node.type === 'group' && node.nivel === 2) ? 2 : 1)
  const rows = Array.from({ length: depth }, () => [])
  const firstLevel = 4 - depth
  const rowLevels = Array.from({ length: depth }, (_, index) => firstLevel + index)
  const levelHeights = { 1: 38, 2: 36, 3: 42 }
  const rowTops = rowLevels.map((_, index) => rowLevels
    .slice(0, index)
    .reduce((sum, level) => sum + levelHeights[level], 0))
  const terminalRow = depth - 1
  const levelTwoRow = depth - 2
  const resultColumns = []

  structure.value.forEach((node) => {
    if (node.type === 'item') {
      // Los ítems que cuelgan directamente de la estructura no pertenecen a
      // ningún grupo intermedio: su encabezado debe ocupar todas las filas
      // visibles, igual que una columna independiente de la jerarquía.
      const terminal = itemCell(node, depth)
      rows[0].push(terminal)
      resultColumns.push(terminal)
      return
    }

    if (node.nivel === 2) {
      const topSpan = visibleColumnCount(node)
      for (let row = 0; row < levelTwoRow; row += 1) rows[row].push(blankCell(`blank-${row}-${node.id}`, topSpan))
      if (node.colapsado) {
        rows[levelTwoRow].push(groupCell(node, 1, terminalRow - levelTwoRow + 1))
        const terminal = meanCell(node)
        resultColumns.push(terminal)
      } else {
        rows[levelTwoRow].push(groupCell(node, topSpan))
        node.children.forEach((item) => {
          const terminal = itemCell(item)
          rows[terminalRow].push(terminal)
          resultColumns.push(terminal)
        })
        const terminal = meanCell(node)
        rows[terminalRow].push(terminal)
        resultColumns.push(terminal)
      }
      return
    }

    if (node.colapsado) {
      const terminal = meanCell(node)
      resultColumns.push(terminal)
      // Al colapsar un nivel 1 se ocultan sus subgrupos, pero los ítems de
      // nivel 3 añadidos directamente al grupo siguen siendo columnas
      // visibles, inmediatamente después de la media automática.
      const directItems = node.children.filter((child) => child.type === 'item')
      // El nombre completo del grupo ocupa la primera fila y la anchura de
      // todas sus columnas visibles. En las dos filas inferiores se muestran
      // la media (E1) y los ítems directos (R1, F1, ...), todos con rowspan 2.
      rows[0].push(groupCell(node, 1 + directItems.length, 1, node.nombre))
      rows[1].push(meanCell(node, 2))
      directItems.forEach((item) => {
        const directItem = itemCell(item, 2)
        rows[1].push(directItem)
        resultColumns.push(directItem)
      })
      return
    }

    const levelTwoGroups = node.children.filter((child) => child.type === 'group')
    const directItems = node.children.filter((child) => child.type === 'item')
    // Los ítems directos de un grupo de nivel 1 son ítems de nivel 3:
    // pertenecen al grupo y se muestran bajo su encabezado, a la derecha de
    // la media del grupo.
    const levelTwoSpan = levelTwoGroups.reduce((sum, child) => sum + visibleColumnCount(child), 0)
    const topSpan = Math.max(1, levelTwoSpan + 1 + directItems.length) // + media e ítems directos
    rows[0].push(groupCell(node, topSpan))
    levelTwoGroups.forEach((levelTwoNode) => {
      const span = visibleColumnCount(levelTwoNode)
      if (levelTwoNode.colapsado) {
        rows[1].push(groupCell(levelTwoNode, 1, 2))
        const terminal = meanCell(levelTwoNode)
        resultColumns.push(terminal)
        return
      }
      rows[1].push(groupCell(levelTwoNode, span))
      levelTwoNode.children.forEach((item) => {
        const terminal = itemCell(item)
        rows[terminalRow].push(terminal)
        resultColumns.push(terminal)
      })
      const terminal = meanCell(levelTwoNode)
      rows[terminalRow].push(terminal)
      resultColumns.push(terminal)
    })
    const levelOneMean = meanCell(node, 2)
    rows[1].push(levelOneMean)
    resultColumns.push(levelOneMean)
    directItems.forEach((item) => {
      const terminal = itemCell(item, 2)
      rows[1].push(terminal)
      resultColumns.push(terminal)
    })
  })

  return { depth, rows, rowLevels, rowTops, resultColumns }
})

const resultColumns = computed(() => headerLayout.value.resultColumns)
const tableStyle = computed(() => (resultColumns.value.length
  ? { minWidth: `${310 + resultColumns.value.length * RESULT_COLUMN_MIN_WIDTH}px` }
  : { minWidth: '100%' }))

function resultFor(studentId, itemId) {
  return localGroup.value.evaluaciones.resultados[studentId]?.[itemId] || ''
}

function updateResult(studentId, itemId, value) {
  if (props.configurationMode) return
  if (!localGroup.value.evaluaciones.resultados[studentId]) localGroup.value.evaluaciones.resultados[studentId] = {}
  localGroup.value.evaluaciones.resultados[studentId][itemId] = value
  markDirty()
}

function numericResult(studentId, itemId) {
  const raw = resultFor(studentId, itemId).trim().replace(',', '.')
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function groupMean(studentId, group) {
  const value = weightedNodeMean(studentId, group)
  return value === null ? '' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
}

function weightedNodeMean(studentId, node) {
  if (!node) return null
  if (node.type === 'item') return numericResult(studentId, node.id)
  const weights = localGroup.value.evaluaciones.pesos?.[node.id] || {}
  const values = node.children.map((child) => ({
    value: weightedNodeMean(studentId, child),
    weight: weights[child.id] === undefined ? 1 : Math.max(0, Number(weights[child.id]) || 0),
  })).filter((entry) => entry.value !== null && entry.weight > 0)
  if (!values.length) return null
  const totalWeight = values.reduce((sum, entry) => sum + entry.weight, 0)
  return values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight
}

function canConfigureWeights(node) {
  const location = findNode(node?.id)
  return Boolean(node && (node.type === 'group' || (node.type === 'item' && !location?.parent)))
}

function openWeightDialog(node) {
  if (props.disabled || !canConfigureWeights(node)) return
  const location = findNode(node.id)
  if (!location) return
  const nodes = node.type === 'group'
    ? node.children
    : location.nodes.slice(0, location.index + 1)
  if (!nodes.length) return
  const parentId = node.type === 'group' ? node.id : '__root__'
  const savedWeights = localGroup.value.evaluaciones.pesos?.[parentId] || {}
  weightDialogTitle.value = node.type === 'group' ? `Pesos de ${node.nombre}` : `Pesos de ${node.nombreCorto || node.nombre}`
  weightDialogParentId.value = parentId
  weightDialogNodes.value = nodes
  weightDialogWeights.value = Object.fromEntries(nodes.map((child) => [child.id, savedWeights[child.id] === undefined ? 100 : Math.max(0, Number(savedWeights[child.id]) || 0)]))
  weightDialog.value = true
}

function saveWeightDialog() {
  if (!weightDialogParentId.value) return
  if (!localGroup.value.evaluaciones.pesos || typeof localGroup.value.evaluaciones.pesos !== 'object') localGroup.value.evaluaciones.pesos = {}
  localGroup.value.evaluaciones.pesos[weightDialogParentId.value] = Object.fromEntries(
    weightDialogNodes.value.map((node) => [node.id, Math.max(0, Number(weightDialogWeights.value[node.id]) || 0)]),
  )
  weightDialog.value = false
  markDirty()
  if (!props.configurationMode) emit('autosave-request', { includeIdentities: false })
}

function toggleGroup(group) {
  group.colapsado = !group.colapsado
  markDirty()
  if (!props.configurationMode) emit('autosave-request', { includeIdentities: false })
}

function dragDescriptor(node) {
  return { id: node.id, type: node.type, nivel: node.type === 'group' ? node.nivel : 3 }
}

function endDrag() {
  draggedNode.value = null
  dropTargetId.value = null
  dragPreview.value = null
}

function validDrop(target) {
  const source = draggedNode.value
  if (!source || source.id === target.id) return false
  if (source.type === 'item') return target.type === 'item' || (target.type === 'group' && [1, 2].includes(target.nivel))
  if (source.type === 'group' && source.nivel === 2) return target.type === 'group' && (target.nivel === 1 || target.nivel === 2)
  return false
}

function moveItemIntoGroup(itemId, groupId) {
  const targetLocation = findNode(groupId)
  const sourceLocation = findNode(itemId)
  if (!targetLocation || !sourceLocation || targetLocation.node.type !== 'group' || ![1, 2].includes(targetLocation.node.nivel)) return
  if (sourceLocation.parent?.id === groupId) return
  const item = detachNode(itemId, { prune: false })
  const refreshedTarget = findNode(groupId)?.node
  if (item && refreshedTarget) refreshedTarget.children.push(item)
  localGroup.value.evaluaciones.estructura = pruneEmptyGroups(structure.value)
  markDirty()
}

function moveItemToRootEnd(itemId) {
  const sourceLocation = findNode(itemId)
  if (!sourceLocation || sourceLocation.node.type !== 'item' || !sourceLocation.parent) return
  const item = detachNode(itemId, { prune: false })
  if (!item) return
  // La estructura raíz es el final natural para un ítem que se saca de su
  // grupo. Se conserva el orden del resto de columnas y el ítem queda último.
  structure.value.push(item)
  localGroup.value.evaluaciones.estructura = pruneEmptyGroups(structure.value)
  markDirty()
}

function moveLevelTwoIntoLevelOne(groupId, levelOneId) {
  const sourceLocation = findNode(groupId)
  const targetLocation = findNode(levelOneId)
  if (!sourceLocation || !targetLocation || sourceLocation.node.nivel !== 2 || targetLocation.node.nivel !== 1) return
  if (sourceLocation.parent?.id === levelOneId) return
  const group = detachNode(groupId)
  const refreshedTarget = findNode(levelOneId)?.node
  if (group && refreshedTarget) refreshedTarget.children.push(group)
  markDirty()
}

function requestFusion(nivel, sourceId, targetId) {
  pendingFusion.value = { nivel, sourceId, targetId }
  fusionForm.value = { nombre: '', nombreCorto: '' }
  fusionDialog.value = true
}

function performDrop(target) {
  const source = draggedNode.value
  dropTargetId.value = null
  if (!source || !target) return

  if (target.type === 'root') {
    if (source.type === 'item') moveItemToRootEnd(source.id)
    return
  }
  if (!validDrop(target)) return

  if (source.type === 'item' && target.type === 'item') {
    const targetLocation = findNode(target.id)
    if (targetLocation?.parent?.nivel === 2) moveItemIntoGroup(source.id, targetLocation.parent.id)
    else requestFusion(2, source.id, target.id)
    return
  }
  if (source.type === 'item' && target.type === 'group' && [1, 2].includes(target.nivel)) {
    moveItemIntoGroup(source.id, target.id)
    return
  }
  if (source.type === 'group' && source.nivel === 2 && target.type === 'group' && target.nivel === 1) {
    moveLevelTwoIntoLevelOne(source.id, target.id)
    return
  }
  if (source.type === 'group' && source.nivel === 2 && target.type === 'group' && target.nivel === 2) {
    const targetLocation = findNode(target.id)
    if (targetLocation?.parent?.nivel === 1) moveLevelTwoIntoLevelOne(source.id, targetLocation.parent.id)
    else requestFusion(1, source.id, target.id)
  }
}

function startPointerDrag(event, node, label) {
  if (props.disabled || !props.configurationMode || (event.pointerType === 'mouse' && event.button !== 0)) return
  event.preventDefault()
  draggedNode.value = dragDescriptor(node)
  touchDrag.value = { startX: event.clientX, startY: event.clientY, active: false, label }
  event.currentTarget.setPointerCapture?.(event.pointerId)
}

function movePointerDrag(event) {
  const state = touchDrag.value
  if (!state) return
  if (!state.active && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 7) return
  state.active = true
  event.preventDefault()
  dragPreview.value = { label: state.label, x: event.clientX + 14, y: event.clientY + 14 }
  const pointElement = document.elementFromPoint(event.clientX, event.clientY)
  const rootTarget = pointElement?.closest?.('[data-gradebook-root-target]')
  if (rootTarget && draggedNode.value?.type === 'item') {
    dropTargetId.value = '__gradebook-root__'
    return
  }
  const targetElement = pointElement?.closest?.('[data-gradebook-node-id]')
  const target = targetElement ? findNode(targetElement.dataset.gradebookNodeId)?.node : null
  dropTargetId.value = target && validDrop(target) ? target.id : null
}

function endPointerDrag() {
  const wasActive = Boolean(touchDrag.value?.active)
  if (wasActive && dropTargetId.value) {
    const target = dropTargetId.value === '__gradebook-root__'
      ? { type: 'root' }
      : findNode(dropTargetId.value)?.node
    if (target) performDrop(target)
  }
  if (wasActive) {
    suppressTitleClick.value = true
    window.setTimeout(() => { suppressTitleClick.value = false }, 0)
  }
  touchDrag.value = null
  endDrag()
}

function cancelPointerDrag() {
  touchDrag.value = null
  endDrag()
}

function openNodeEditDialog(node) {
  if (!props.configurationMode || suppressTitleClick.value || !node) return
  editNodeForm.value = {
    id: node.id,
    nombre: node.nombre || '',
    nombreCorto: node.nombreCorto || '',
  }
  editNodeDialog.value = true
}

function saveNodeEdit() {
  const nombre = editNodeForm.value.nombre.trim()
  const nombreCorto = editNodeForm.value.nombreCorto.trim()
  const location = findNode(editNodeForm.value.id)
  if (!location || !nombre || !nombreCorto) return
  location.node.nombre = nombre
  location.node.nombreCorto = nombreCorto
  editNodeDialog.value = false
  markDirty()
}

function confirmFusion() {
  const nombre = fusionForm.value.nombre.trim()
  const nombreCorto = fusionForm.value.nombreCorto.trim()
  const pending = pendingFusion.value
  if (!nombre || !nombreCorto || !pending) return

  const sourceLocation = findNode(pending.sourceId)
  const targetLocation = findNode(pending.targetId)
  if (!sourceLocation || !targetLocation) {
    fusionDialog.value = false
    return
  }
  if (pending.nivel === 2 && (sourceLocation.node.type !== 'item' || targetLocation.node.type !== 'item')) return
  if (pending.nivel === 1 && (sourceLocation.node.nivel !== 2 || targetLocation.node.nivel !== 2)) return

  const source = detachNode(pending.sourceId, { prune: false })
  const refreshedTargetLocation = findNode(pending.targetId)
  if (!source || !refreshedTargetLocation) return
  const targetParent = refreshedTargetLocation.parent
  const targetContainer = refreshedTargetLocation.nodes
  const targetIndex = refreshedTargetLocation.index
  const target = detachNode(pending.targetId, { prune: false })
  const newGroup = {
    type: 'group',
    id: createNodeId('group'),
    nivel: pending.nivel,
    nombre,
    nombreCorto,
    colapsado: false,
    children: [target, source],
  }

  if (pending.nivel === 1 || !targetParent) {
    const insertionIndex = Math.min(targetIndex, structure.value.length)
    structure.value.splice(insertionIndex, 0, newGroup)
  } else {
    targetContainer.splice(Math.min(targetIndex, targetContainer.length), 0, newGroup)
  }
  localGroup.value.evaluaciones.estructura = pruneEmptyGroups(structure.value)
  fusionDialog.value = false
  pendingFusion.value = null
  markDirty()
}

function getGroup() {
  const cloudGroup = clone(localGroup.value)
  cloudGroup.alumnos = students.value.map((student) => ({ id: student.id }))
  return cloudGroup
}

async function persistLocalIdentities() {
  identityError.value = ''
  try {
    await saveStudentIdentities(localGroup.value.id, students.value.map((student) => ({ ...student })))
  } catch (error) {
    identityError.value = 'No se han podido guardar los datos identificativos en este dispositivo.'
    throw error
  }
}

async function finalizeIdentityDeletions() {
  const ids = [...removedStudentIds]
  await deleteStudentIdentitiesForGroup(localGroup.value, ids)
  ids.forEach((id) => removedStudentIds.delete(id))
}

function markSaved(savedRevision = revision) {
  if (savedRevision !== revision) return
  dirty.value = false
  emit('dirty-change', false)
}

function getRevision() {
  return revision
}

emitValidity()
onMounted(async () => {
  identityLoading.value = true
  identityError.value = ''
  try {
    const storedIdentities = await loadStudentIdentitiesForGroup(localGroup.value)
    students.value.forEach((student) => {
      const localIdentity = storedIdentities.get(student.id)
      Object.assign(student, localIdentity || {})
      student.nombre ||= ''
    })
    sortStudentsByName()
  } catch (error) {
    identityError.value = 'No se han podido abrir los datos identificativos guardados en este dispositivo.'
    console.error('Error al cargar las identidades locales:', error)
  } finally {
    identityLoading.value = false
    emitValidity()
  }
})

defineExpose({
  addStudent,
  openItemDialog,
  getGroup,
  markSaved,
  persistLocalIdentities,
  finalizeIdentityDeletions,
  getRevision,
})
</script>

<template>
  <div class="gradebook" :class="{ 'gradebook-disabled': disabled, 'gradebook-configuration': configurationMode }">
    <div class="gradebook-scroller">
      <table class="gradebook-table" :style="tableStyle">
        <colgroup>
          <col class="gradebook-student-column">
          <col v-for="column in resultColumns" :key="column.key" class="gradebook-result-column">
        </colgroup>
        <thead>
          <tr
            v-for="(row, rowIndex) in headerLayout.rows"
            :key="rowIndex"
            class="gradebook-level"
            :class="`gradebook-level-${headerLayout.rowLevels[rowIndex]}`"
            :style="{ '--gradebook-header-top': `${headerLayout.rowTops[rowIndex]}px` }"
          >
            <th
              v-if="rowIndex === 0"
              :rowspan="headerLayout.depth"
              class="gradebook-student-heading"
              data-gradebook-root-target
              :class="{ 'gradebook-drop-target': dropTargetId === '__gradebook-root__' }"
            >
              <div class="gradebook-student-heading-course">
                <strong>{{ localGroup.nombre || 'Grupo' }}</strong>
                <span v-if="localGroup.asignatura">{{ localGroup.asignatura }}</span>
              </div>
              <div class="gradebook-student-heading-count">Alumnos <small>{{ students.length }}</small></div>
            </th>
            <template v-if="structure.length">
              <th
                v-for="cell in row"
                :key="cell.key"
                :colspan="cell.colspan"
                :rowspan="cell.rowspan || 1"
                :title="cell.title"
                :data-gradebook-node-id="cell.node?.id"
                :draggable="false"
                class="gradebook-header-cell"
                :class="[
                  `gradebook-header-${cell.kind}`,
                  { 'gradebook-drop-target': cell.node && dropTargetId === cell.node.id },
                ]"
              >
                <template v-if="cell.kind === 'group'">
                  <span
                    class="gradebook-header-label"
                    :class="{ 'gradebook-header-label-configurable': configurationMode && canConfigureWeights(cell.node) }"
                    @pointerdown.stop="startPointerDrag($event, cell.node, cell.label)"
                    @pointermove.stop="movePointerDrag($event)"
                    @pointerup.stop="endPointerDrag()"
                    @pointercancel.stop="cancelPointerDrag()"
                    @click.stop="openNodeEditDialog(cell.node)"
                  >{{ cell.label }}</span>
                  <button v-if="configurationMode && canConfigureWeights(cell.node)" type="button" class="gradebook-weight-settings" :aria-label="`Configurar pesos de ${cell.title}`" @click.stop="openWeightDialog(cell.node)">
                    <v-icon icon="mdi-tune-variant" size="14" />
                  </button>
                  <button type="button" class="gradebook-collapse" :aria-label="cell.node.colapsado ? `Desplegar ${cell.title}` : `Colapsar ${cell.title}`" @click.stop="toggleGroup(cell.node)">
                    <v-icon :icon="cell.node.colapsado ? 'mdi-chevron-right' : 'mdi-chevron-down'" size="16" />
                  </button>
                  <button v-if="configurationMode" type="button" class="gradebook-column-remove" :aria-label="`Eliminar grupo ${cell.title}`" @click.stop="requestRemoveGroup(cell.node)">
                    <v-icon icon="mdi-close" size="14" />
                  </button>
                </template>
                <template v-else-if="cell.kind === 'item'">
                  <span
                    class="gradebook-header-label"
                    :class="{ 'gradebook-header-label-configurable': configurationMode && canConfigureWeights(cell.node) }"
                    @pointerdown.stop="startPointerDrag($event, cell.node, cell.label)"
                    @pointermove.stop="movePointerDrag($event)"
                    @pointerup.stop="endPointerDrag()"
                    @pointercancel.stop="cancelPointerDrag()"
                    @click.stop="openNodeEditDialog(cell.node)"
                  >{{ cell.label }}</span>
                  <button v-if="configurationMode && canConfigureWeights(cell.node)" type="button" class="gradebook-weight-settings" :aria-label="`Configurar pesos de ${cell.title}`" @click.stop="openWeightDialog(cell.node)">
                    <v-icon icon="mdi-tune-variant" size="14" />
                  </button>
                  <button v-if="configurationMode" type="button" class="gradebook-column-remove" :aria-label="`Eliminar ${cell.title}`" @click.stop="removeItem(cell.node.id)">
                    <v-icon icon="mdi-close" size="14" />
                  </button>
                </template>
                <span v-else-if="cell.kind === 'mean'" class="gradebook-header-label" @click.stop="openNodeEditDialog(cell.node)">{{ cell.label }}</span>
              </th>
            </template>
            <th v-else-if="rowIndex === 0" :rowspan="headerLayout.depth" class="gradebook-no-columns">
              {{ configurationMode ? 'Añade un ítem de evaluación desde la barra superior' : 'Activa la configuración para añadir ítems de evaluación' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="student in students" :key="student.id">
            <th class="gradebook-student-cell" :style="studentFlagStyle(student)">
              <div class="gradebook-student-content">
                <img v-if="student.foto" class="gradebook-student-avatar" :src="student.foto" :alt="student.nombreCorto || student.nombre || student.id">
                <input v-if="configurationMode"
                  v-model="student.nombre"
                  type="text"
                  :readonly="disabled || identityLoading || !configurationMode"
                  :class="{ 'gradebook-student-name-invalid': !studentNameIsValid(student.nombre) }"
                  :title="studentNameIsValid(student.nombre) ? '' : 'Usa el formato APELLIDO 1 APELLIDO 2, Nombre'"
                  placeholder="APELLIDO 1 APELLIDO 2, Nombre"
                  aria-label="Nombre del alumno"
                  @input="markDirty"
                  @blur="normalizeStudentName(student)"
                >
                <button v-else type="button" class="gradebook-student-name" @click="emit('student-selected', { ...student })">
                  {{ student.nombre || student.id }}
                </button>
                <code :title="`ID del alumno: ${student.id}`">{{ student.id }}</code>
                <button v-if="configurationMode" type="button" class="gradebook-student-remove" :aria-label="`Eliminar ${student.nombre || 'alumno'}`" @click="removeStudent(student.id)">
                  <v-icon icon="mdi-delete-outline" size="16" />
                </button>
              </div>
            </th>
            <td v-for="column in resultColumns" :key="column.key" :class="{ 'gradebook-mean-cell': column.kind === 'mean' }">
              <input
                v-if="column.kind === 'item'"
                :value="resultFor(student.id, column.node.id)"
                type="text"
                inputmode="decimal"
                :disabled="disabled || configurationMode"
                :aria-label="`${column.title}: ${student.nombre || student.id}`"
                @input="updateResult(student.id, column.node.id, $event.target.value)"
                @blur="emit('autosave-request', { includeIdentities: false })"
              >
              <output v-else :aria-label="`${column.title}: ${student.nombre || student.id}`">{{ groupMean(student.id, column.node) }}</output>
            </td>
          </tr>
          <tr v-if="!students.length">
            <th class="gradebook-student-cell gradebook-student-empty">Aún no hay alumnos</th>
            <td :colspan="Math.max(resultColumns.length, 1)" class="gradebook-empty-body">
              {{ configurationMode ? 'Añade la primera fila con «Alumno» en la barra superior.' : 'Activa la configuración para añadir alumnos.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="dragPreview"
      class="gradebook-drag-preview"
      :style="{ left: `${dragPreview.x}px`, top: `${dragPreview.y}px` }"
      aria-hidden="true"
    >{{ dragPreview.label }}</div>

    <v-dialog v-model="itemDialog" max-width="520">
      <v-card>
        <v-card-title class="px-6 pt-5">Nuevo ítem de evaluación</v-card-title>
        <v-card-text class="gradebook-column-form px-6 pb-2">
          <v-text-field v-model="itemForm.nombre" label="Nombre completo" placeholder="Examen de sistemas de ecuaciones" variant="outlined" density="compact" hide-details autofocus />
          <v-text-field v-model="itemForm.nombreCorto" label="Nombre corto" placeholder="Examen 1" variant="outlined" density="compact" hide-details @keyup.enter="addItem" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="itemDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!itemForm.nombre.trim() || !itemForm.nombreCorto.trim()" @click="addItem">Añadir</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="fusionDialog" max-width="520" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">Nuevo grupo de nivel {{ pendingFusion?.nivel }}</v-card-title>
        <v-card-text class="gradebook-column-form px-6 pb-2">
          <v-text-field v-model="fusionForm.nombre" label="Nombre completo" placeholder="Tareas de la primera evaluación" variant="outlined" density="compact" hide-details autofocus />
          <v-text-field v-model="fusionForm.nombreCorto" label="Nombre corto" placeholder="Tareas" variant="outlined" density="compact" hide-details @keyup.enter="confirmFusion" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="fusionDialog = false; pendingFusion = null">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!fusionForm.nombre.trim() || !fusionForm.nombreCorto.trim()" @click="confirmFusion">Crear grupo</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteGroupDialog" max-width="560" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">Eliminar {{ pendingDeleteGroup?.nombre }}</v-card-title>
        <v-card-text class="px-6 pb-2">
          Este grupo contiene otros elementos. ¿Qué quieres hacer con sus descendientes?
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-btn variant="text" @click="deleteGroupDialog = false; pendingDeleteGroup = null">Cancelar</v-btn>
          <v-spacer />
          <v-btn color="error" variant="text" @click="confirmRemoveGroup(false)">Borrar descendientes</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmRemoveGroup(true)">Conservar descendientes</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editNodeDialog" max-width="520">
      <v-card>
        <v-card-title class="px-6 pt-5">Editar {{ findNode(editNodeForm.id)?.node?.type === 'group' ? 'grupo' : 'ítem' }}</v-card-title>
        <v-card-text class="gradebook-column-form px-6 pb-2">
          <v-text-field v-model="editNodeForm.nombre" label="Nombre completo" variant="outlined" density="compact" hide-details autofocus />
          <v-text-field v-model="editNodeForm.nombreCorto" label="Nombre corto" variant="outlined" density="compact" hide-details @keyup.enter="saveNodeEdit" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="editNodeDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!editNodeForm.nombre.trim() || !editNodeForm.nombreCorto.trim()" @click="saveNodeEdit">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="weightDialog" max-width="560">
      <v-card>
        <v-card-title class="px-6 pt-5">{{ weightDialogTitle }}</v-card-title>
        <v-card-text class="gradebook-weight-form px-6 pb-2">
          <div v-for="node in weightDialogNodes" :key="node.id" class="gradebook-weight-row">
            <div class="gradebook-weight-label" :title="node.nombre">{{ node.nombreCorto || node.nombre }}</div>
            <v-slider v-model="weightDialogWeights[node.id]" min="0" max="100" step="5" color="primary" hide-details thumb-label="always" />
          </div>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="weightDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" @click="saveWeightDialog">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
