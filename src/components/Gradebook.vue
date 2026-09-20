<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  deleteStudentIdentitiesForGroup,
  identityRecoveryMessage,
  inspectLocalStudentIdentityCodeMatch,
  loadStudentIdentitiesForGroup,
  saveStudentIdentities,
  studentIdentityDiagnostics,
} from '../services/localStudentIdentity'
import { loadRubrics } from '../services/rubricRepository'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import DocumentAssessmentMatrix from './DocumentAssessmentMatrix.vue'
import RubricAlignmentBadges from './RubricAlignmentBadges.vue'
import { loadDocumentAssessmentExercises } from '../services/documentAssessmentLoader'
import {
  createRubricAssessment,
  rubricAssessmentTotal,
  rubricRangeValues,
  rubricSnapshot,
  setRubricCategoryScore,
} from '../utils/rubricAssessment'
import {
  nextSourceGroup,
  normalizedSourceGroup,
  shortStudentName,
  sourceGroupOptions,
} from '../utils/studentRoster'

const props = defineProps({
  group: { type: Object, required: true },
  existingStudentIds: { type: Array, default: () => [] },
  teacherId: { type: String, default: '' },
  configurationMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['dirty-change', 'validity-change', 'autosave-request', 'student-selected'])

const STUDENT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'
const MAX_STUDENTS = 50
const RESULT_COLUMN_MIN_WIDTH = 72
const studentSourceBlueTones = Object.freeze(['#dcecff', '#a9c9ea', '#6f9fd2', '#3f73ac', '#274f82', '#19375f'])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function attendanceItemIds(nodes = []) {
  return nodes.flatMap((node) => {
    if (node?.type === 'group') return attendanceItemIds(node.children || [])
    return node?.attendance?.date && node.id ? [node.id] : []
  })
}

function normalizeNode(node) {
  if (node?.attendance?.date) return null
  if (node?.type === 'group') {
    return {
      type: 'group',
      id: node.id,
      nivel: Number(node.nivel) === 1 ? 1 : 2,
      nombre: node.nombre || 'Grupo',
      nombreCorto: node.nombreCorto || node.nombre || 'Grupo',
      colapsado: Boolean(node.colapsado),
      children: (node.children || []).map(normalizeNode).filter(Boolean),
    }
  }
  return {
    type: 'item',
    id: node.id,
    nombre: node.nombre || node.title || 'Resultado',
    nombreCorto: node.nombreCorto || node.nombre || node.title || 'Resultado',
    rubric: node.rubric ? rubricSnapshot(node.rubric) : null,
    merits: Boolean(node.merits),
    documentAssessment: node.documentAssessment ? clone(node.documentAssessment) : null,
    programming: node.programming ? clone(node.programming) : null,
  }
}

function normalizeGroup(group) {
  const legacyItems = (group.evaluaciones?.columnas || []).map((column) => ({
    type: 'item',
    id: column.id,
    nombre: column.title || column.nombre || 'Resultado',
    nombreCorto: column.nombreCorto || column.title || column.nombre || 'Resultado',
  }))
  const sourceStructure = group.evaluaciones?.estructura || legacyItems
  const removedAttendanceIds = new Set(attendanceItemIds(sourceStructure))
  const results = group.evaluaciones?.resultados ? clone(group.evaluaciones.resultados) : {}
  Object.values(results).forEach((studentResults) => {
    removedAttendanceIds.forEach((itemId) => delete studentResults[itemId])
  })
  const weights = group.evaluaciones?.pesos && typeof group.evaluaciones.pesos === 'object'
    ? clone(group.evaluaciones.pesos)
    : {}
  removedAttendanceIds.forEach((itemId) => delete weights[itemId])
  return {
    ...clone(group),
    alumnos: Array.isArray(group.alumnos) ? clone(group.alumnos) : [],
    evaluaciones: {
      estructura: sourceStructure.map(normalizeNode).filter(Boolean),
      resultados: results,
      pesos: weights,
    },
  }
}

const localGroup = ref(normalizeGroup(props.group))
const dirty = ref(false)
const bulkStudentDialog = ref(false)
const bulkStudentText = ref('')
const itemDialog = ref(false)
const itemForm = ref({ nombre: '', nombreCorto: '', rubricId: null, type: 'standard' })
const rubrics = ref([])
const rubricsLoading = ref(false)
const rubricsLoadedForTeacher = ref('')
const rubricAssessmentDialog = ref(false)
const rubricAssessmentStudent = ref(null)
const rubricAssessmentItem = ref(null)
const rubricAssessmentChanged = ref(false)
const documentAssessmentDialog = ref(false)
const documentAssessmentStudent = ref(null)
const documentAssessmentItem = ref(null)
const documentAssessmentExercises = ref([])
const documentAssessmentLoading = ref(false)
const documentAssessmentChanged = ref(false)
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
const automaticShortNameStudentIds = new Set()
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
let localIdentitySaveTimer = null

const structure = computed(() => localGroup.value.evaluaciones.estructura)
const students = computed(() => localGroup.value.alumnos)
const studentSourceGroups = computed(() => sourceGroupOptions(localGroup.value.nombre || localGroup.value.name))
function resultWasEntered(result) {
  if (result && typeof result === 'object') {
    return Boolean(result.evaluatedAt || (result.type === 'document' && result.updatedAt))
  }
  return String(result ?? '').trim() !== ''
}

function itemHasEnteredEvaluation(itemId) {
  return Object.values(localGroup.value.evaluaciones.resultados || {})
    .some((studentResults) => resultWasEntered(studentResults?.[itemId]))
}

// Compatibilidad con instrumentos creados antes de introducir la activación
// diferida: si siguen en la raíz y nadie los ha evaluado, no ocupan columna.
const visibleStructure = computed(() => structure.value.filter((node) => (
  node?.type !== 'item'
  // Méritos es un acumulador permanente; su fecha solo sirve de referencia,
  // no debe activar la ocultación diferida de instrumentos programados.
  || node.merits
  || !node.programming?.date
  || itemHasEnteredEvaluation(node.id)
)))
const eligibleRubrics = computed(() => {
  const course = normalizedCourse(localGroup.value.curso || localGroup.value.level || localGroup.value.nombre)
  const subjectId = String(localGroup.value.subjectId || '')
  const subject = String(localGroup.value.asignatura || '').trim().toLocaleLowerCase('es-ES')
  return rubrics.value.filter((rubric) => (
    normalizedCourse(rubric.course) === course
    && (!subjectId || rubric.subjectId === subjectId)
    && (subjectId || !subject || rubric.subjectTitle.trim().toLocaleLowerCase('es-ES') === subject)
  ))
})
const selectedItemRubric = computed(() => rubrics.value.find((rubric) => rubric.id === itemForm.value.rubricId) || null)
const activeRubric = computed(() => rubricAssessmentItem.value?.rubric || null)
const activeMerits = computed(() => Boolean(rubricAssessmentItem.value?.merits))
const activeRubricResult = computed(() => {
  const studentId = rubricAssessmentStudent.value?.id
  const itemId = rubricAssessmentItem.value?.id
  return studentId && itemId ? localGroup.value.evaluaciones.resultados[studentId]?.[itemId] || null : null
})
const activeDocumentAssessmentResult = computed(() => {
  const studentId = documentAssessmentStudent.value?.id
  const itemId = documentAssessmentItem.value?.id
  return studentId && itemId ? localGroup.value.evaluaciones.resultados[studentId]?.[itemId] || null : null
})
const activeDocumentAchievementIds = computed(() => new Set(activeDocumentAssessmentResult.value?.selectedAchievementIds || []))

function normalizedCourse(value = '') {
  return String(value)
    .trim()
    .replace(/\s+[A-Z]$/u, '')
    .replace(/\s+/gu, '')
    .toLocaleUpperCase('es-ES')
}

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
  student.nombreCorto ||= shortStudentName(student.nombre)
  sortStudentsByName()
  markDirty()
}

function updateStudentName(student) {
  if (automaticShortNameStudentIds.has(student.id)) student.nombreCorto = shortStudentName(student.nombre)
  markDirty()
}

function studentSourceGroup(student) {
  return normalizedSourceGroup(student?.sourceGroup, studentSourceGroups.value)
}

function studentSourceStyle(student) {
  const sourceIndex = Math.max(0, studentSourceGroups.value.indexOf(studentSourceGroup(student)))
  const background = studentSourceBlueTones[sourceIndex % studentSourceBlueTones.length]
  const channels = [0, 2, 4].map((offset) => Number.parseInt(background.slice(offset + 1, offset + 3), 16) / 255)
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
  return {
    '--student-source-color': background,
    '--student-source-text-color': luminance < 0.52 ? '#fff' : '#315f93',
  }
}

function cycleStudentSourceGroup(student) {
  if (props.disabled || !props.configurationMode || studentSourceGroups.value.length < 2) return
  student.sourceGroup = nextSourceGroup(student.sourceGroup, studentSourceGroups.value)
  sortStudentsByName()
  markDirty()
}

function compareStudentsByName(left, right) {
    const leftName = String(left?.nombre || '').trim()
    const rightName = String(right?.nombre || '').trim()
    if (!leftName && !rightName) return 0
    if (!leftName) return 1
    if (!rightName) return -1
    return leftName.localeCompare(rightName, 'es', { sensitivity: 'base' })
}

function sortStudentsByName() {
  const sourceGroups = studentSourceGroups.value
  localGroup.value.alumnos.sort((left, right) => {
    if (sourceGroups.length > 1) {
      const leftSourceIndex = sourceGroups.indexOf(studentSourceGroup(left))
      const rightSourceIndex = sourceGroups.indexOf(studentSourceGroup(right))
      if (leftSourceIndex !== rightSourceIndex) return leftSourceIndex - rightSourceIndex
    }
    return compareStudentsByName(left, right)
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

function isStudentCode(value) {
  const code = String(value || '').trim()
  return code.length === 6 && [...code].every((character) => STUDENT_ID_ALPHABET.includes(character))
}

function addStudent() {
  if (props.disabled || !props.configurationMode || students.value.length >= MAX_STUDENTS) return
  const student = {
    id: randomStudentId(),
    nombre: '',
    nombreCorto: '',
    ...(studentSourceGroups.value.length > 1 ? { sourceGroup: studentSourceGroups.value[0] } : {}),
  }
  automaticShortNameStudentIds.add(student.id)
  students.value.push(student)
  const rubricItems = descendantItems(structure.value).filter((item) => item.rubric)
  const meritsItems = descendantItems(structure.value).filter((item) => item.merits)
  if (rubricItems.length || meritsItems.length) {
    localGroup.value.evaluaciones.resultados[student.id] = Object.fromEntries(
      [
        ...rubricItems.map((item) => [item.id, createRubricAssessment(item.rubric)]),
        ...meritsItems.map((item) => [item.id, createMeritsAssessment()]),
      ],
    )
  }
  markDirty()
}

function openBulkStudentDialog() {
  if (props.disabled || !props.configurationMode || students.value.length >= MAX_STUDENTS) return
  bulkStudentText.value = ''
  bulkStudentDialog.value = true
}

async function importBulkStudents() {
  if (props.disabled || !props.configurationMode) return
  const available = MAX_STUDENTS - students.value.length
  const entries = bulkStudentText.value
    .split(/[\r\n\t]+/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, available)
  if (!entries.length) return
  const existingIds = new Set(students.value.map((student) => student.id))
  const rubricItems = descendantItems(structure.value).filter((item) => item.rubric)
  const meritsItems = descendantItems(structure.value).filter((item) => item.merits)
  const addedStudents = []
  entries.forEach((entry) => {
    const reusedCode = isStudentCode(entry) ? entry : null
    const id = reusedCode || randomStudentId()
    if (existingIds.has(id)) return
    existingIds.add(id)
    const student = {
      id,
      nombre: reusedCode ? '' : entry,
      nombreCorto: reusedCode ? '' : shortStudentName(entry),
      ...(studentSourceGroups.value.length > 1 ? { sourceGroup: studentSourceGroups.value[0] } : {}),
    }
    students.value.push(student)
    addedStudents.push(student)
    if (rubricItems.length || meritsItems.length) {
      localGroup.value.evaluaciones.resultados[student.id] = Object.fromEntries(
        [
          ...rubricItems.map((item) => [item.id, createRubricAssessment(item.rubric)]),
          ...meritsItems.map((item) => [item.id, createMeritsAssessment()]),
        ],
      )
    }
  })
  if (!addedStudents.length) return
  identityLoading.value = true
  try {
    await hydrateStudentIdentities()
  } catch (error) {
    identityError.value = error?.message || 'No se han podido abrir los datos identificativos guardados en este dispositivo.'
    console.error('Error al recuperar las identidades locales:', error)
  } finally {
    identityLoading.value = false
  }
  sortStudentsByName()
  bulkStudentDialog.value = false
  markDirty()
}

function removeStudent(studentId) {
  if (props.disabled || !props.configurationMode) return
  removedStudentIds.add(studentId)
  automaticShortNameStudentIds.delete(studentId)
  localGroup.value.alumnos = students.value.filter((student) => student.id !== studentId)
  delete localGroup.value.evaluaciones.resultados[studentId]
  // Al eliminar el pseudónimo del grupo no deben quedar datos académicos
  // huérfanos que pudieran atribuirse a un alumno creado posteriormente.
  Object.values(localGroup.value.attendance || {}).forEach((entry) => {
    if (entry?.records) delete entry.records[studentId]
  })
  if (Array.isArray(localGroup.value.disposicion?.asientos)) {
    localGroup.value.disposicion.asientos = localGroup.value.disposicion.asientos
      .map((occupant) => occupant === studentId ? null : occupant)
  }
  markDirty()
}

async function openItemDialog() {
  if (props.disabled || !props.configurationMode) return
  itemForm.value = { nombre: '', nombreCorto: '', rubricId: null, type: 'standard' }
  itemDialog.value = true
  if (!props.teacherId || rubricsLoadedForTeacher.value === props.teacherId) return
  rubricsLoading.value = true
  try {
    rubrics.value = await loadRubrics(props.teacherId)
    rubricsLoadedForTeacher.value = props.teacherId
  } catch (error) {
    console.error('No se han podido cargar las rúbricas del curso:', error)
    showAppErrorToast('No se han podido cargar las rúbricas disponibles para este curso.')
  } finally {
    rubricsLoading.value = false
  }
}

function chooseItemRubric(rubric) {
  itemForm.value.rubricId = rubric?.id || null
  if (!rubric) return
  if (!itemForm.value.nombre.trim()) itemForm.value.nombre = rubric.title
  if (!itemForm.value.nombreCorto.trim()) itemForm.value.nombreCorto = rubric.shortName || rubric.title
}

function chooseItemType(type) {
  itemForm.value.type = type
  if (type === 'merits') {
    itemForm.value.rubricId = null
    itemForm.value.nombre = 'Méritos'
    itemForm.value.nombreCorto = 'Méritos'
  }
}

function createMeritsAssessment(previous = null) {
  const transactions = Array.isArray(previous?.transactions) ? clone(previous.transactions) : []
  const total = transactions.reduce((sum, entry) => sum + (Number(entry?.points) || 0), 0)
  return { type: 'merits', schemaVersion: 1, transactions, total }
}

function addItem() {
  const nombre = itemForm.value.nombre.trim()
  const nombreCorto = itemForm.value.nombreCorto.trim()
  if (!nombre || !nombreCorto) return
  const selectedRubric = selectedItemRubric.value
  const item = {
    type: 'item',
    id: createNodeId('item'),
    nombre,
    nombreCorto,
    rubric: itemForm.value.type === 'merits' ? null : selectedRubric ? rubricSnapshot(selectedRubric) : null,
    merits: itemForm.value.type === 'merits',
  }
  structure.value.push(item)
  if (item.rubric) {
    students.value.forEach((student) => {
      localGroup.value.evaluaciones.resultados[student.id] ||= {}
      localGroup.value.evaluaciones.resultados[student.id][item.id] = createRubricAssessment(item.rubric)
    })
  }
  if (item.merits) {
    students.value.forEach((student) => {
      localGroup.value.evaluaciones.resultados[student.id] ||= {}
      localGroup.value.evaluaciones.resultados[student.id][item.id] = createMeritsAssessment()
    })
  }
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

function descendantItems(nodes) {
  return nodes.flatMap((node) => node.type === 'item' ? [node] : descendantItems(node.children || []))
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

function itemHeaderTooltip(node) {
  const title = node?.nombre || node?.nombreCorto || 'Ítem de evaluación'
  const rawDate = String(node?.programming?.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return title
  const date = new Date(`${rawDate}T12:00:00`)
  const label = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  return `${title} · ${label}`
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
  const displayedStructure = visibleStructure.value
  const depth = displayedStructure.some((node) => node.type === 'group' && node.nivel === 1)
    ? 3
    : (displayedStructure.some((node) => node.type === 'group' && node.nivel === 2) ? 2 : 1)
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

  displayedStructure.forEach((node) => {
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
  return localGroup.value.evaluaciones.resultados[studentId]?.[itemId] ?? ''
}

function updateResult(studentId, itemId, value) {
  if (props.configurationMode) return
  if (!localGroup.value.evaluaciones.resultados[studentId]) localGroup.value.evaluaciones.resultados[studentId] = {}
  localGroup.value.evaluaciones.resultados[studentId][itemId] = value
  markDirty()
}

function numericResult(studentId, itemId) {
  const result = resultFor(studentId, itemId)
  if (result && typeof result === 'object') {
    const value = Number(result.total)
    return Number.isFinite(value) ? value : rubricAssessmentTotal(result)
  }
  const raw = String(result).trim().replace(',', '.')
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function formattedRubricResult(studentId, item) {
  const result = resultFor(studentId, item.id)
  if (!result || typeof result !== 'object') return '—'
  const value = Number.isFinite(Number(result.total)) ? Number(result.total) : rubricAssessmentTotal(result)
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
}

function formattedMeritsResult(studentId, item) {
  const value = Number(resultFor(studentId, item.id)?.total) || 0
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(value)}`
}

function ensureMeritsAssessment(studentId, item) {
  if (!studentId || !item?.merits) return null
  localGroup.value.evaluaciones.resultados[studentId] ||= {}
  const assessment = createMeritsAssessment(localGroup.value.evaluaciones.resultados[studentId][item.id])
  localGroup.value.evaluaciones.resultados[studentId][item.id] = assessment
  return assessment
}

function ensureRubricAssessment(studentId, item) {
  if (!studentId || !item?.rubric) return null
  localGroup.value.evaluaciones.resultados[studentId] ||= {}
  const previous = localGroup.value.evaluaciones.resultados[studentId][item.id]
  const assessment = createRubricAssessment(item.rubric, previous?.type === 'rubric' ? previous : null)
  localGroup.value.evaluaciones.resultados[studentId][item.id] = assessment
  return assessment
}

function openRubricAssessment(student, item) {
  if (props.disabled || props.configurationMode || !student?.id || (!item?.rubric && !item?.merits)) return
  const previous = resultFor(student.id, item.id)
  if (item.merits) ensureMeritsAssessment(student.id, item)
  else ensureRubricAssessment(student.id, item)
  rubricAssessmentStudent.value = student
  rubricAssessmentItem.value = item
  rubricAssessmentChanged.value = !previous || typeof previous !== 'object'
  if (rubricAssessmentChanged.value) markDirty()
  rubricAssessmentDialog.value = true
}

function appendMeritsTransaction(points, label, kind = 'conduct') {
  const assessment = activeRubricResult.value
  if (!assessment || !activeMerits.value) return
  assessment.transactions ||= []
  assessment.transactions.push({ id: createNodeId('merit'), points, label, kind, createdAt: new Date().toISOString() })
  assessment.total = assessment.transactions.reduce((sum, entry) => sum + (Number(entry?.points) || 0), 0)
  assessment.updatedAt = new Date().toISOString()
  rubricAssessmentChanged.value = true
  markDirty()
}

function spendMerits(cost) {
  const total = Number(activeRubricResult.value?.total) || 0
  if (total < cost || !globalThis.confirm(`¿Canjear ${cost} méritos por Premio ${cost}?`)) return
  appendMeritsTransaction(-cost, `Premio ${cost}`, 'reward')
}

function categoryScore(category) {
  return activeRubricResult.value?.categories?.[category.id] || null
}

function chooseCategoryScore(category, value) {
  if (!activeRubricResult.value) return
  setRubricCategoryScore(activeRubricResult.value, category, value)
  const savedAt = new Date().toISOString()
  activeRubricResult.value.evaluatedAt = savedAt
  activeRubricResult.value.updatedAt = savedAt
  rubricAssessmentChanged.value = true
  markDirty()
}

function closeRubricAssessment() {
  rubricAssessmentDialog.value = false
}

watch(rubricAssessmentDialog, (open, wasOpen) => {
  if (open || !wasOpen) return
  if (rubricAssessmentChanged.value) emit('autosave-request', { includeIdentities: false })
  rubricAssessmentChanged.value = false
  rubricAssessmentStudent.value = null
  rubricAssessmentItem.value = null
})

function ensureDocumentAssessment(studentId, item) {
  localGroup.value.evaluaciones.resultados[studentId] ||= {}
  const previous = localGroup.value.evaluaciones.resultados[studentId][item.id]
  if (previous?.type === 'document') return previous
  const assessment = { type: 'document', total: 0, selectedAchievementIds: [], updatedAt: new Date().toISOString() }
  localGroup.value.evaluaciones.resultados[studentId][item.id] = assessment
  return assessment
}

async function openDocumentAssessment(student, item) {
  if (props.disabled || props.configurationMode || !student?.id || !item?.documentAssessment) return
  documentAssessmentStudent.value = student
  documentAssessmentItem.value = item
  documentAssessmentLoading.value = true
  documentAssessmentDialog.value = true
  try {
    documentAssessmentExercises.value = await loadDocumentAssessmentExercises(item)
    const previous = resultFor(student.id, item.id)
    ensureDocumentAssessment(student.id, item)
    documentAssessmentChanged.value = !previous || typeof previous !== 'object'
    if (documentAssessmentChanged.value) markDirty()
  } catch (error) {
    documentAssessmentDialog.value = false
    showAppErrorToast(error?.message || 'No se ha podido abrir la corrección del documento.')
  } finally {
    documentAssessmentLoading.value = false
  }
}

function chooseDocumentAchievement(achievement) {
  const result = activeDocumentAssessmentResult.value
  if (!result) return
  const selected = new Set(result.selectedAchievementIds || [])
  if (selected.has(achievement.key)) selected.delete(achievement.key)
  else selected.add(achievement.key)
  result.selectedAchievementIds = [...selected]
  const allAchievements = documentAssessmentExercises.value.flatMap((exercise) => exercise.achievements)
  result.total = allAchievements.reduce((total, candidate) => (
    selected.has(candidate.key) ? total + (Number(candidate.points) || 0) : total
  ), 0)
  result.updatedAt = new Date().toISOString()
  result.evaluatedAt = result.updatedAt
  documentAssessmentChanged.value = true
  markDirty()
}

function formattedDocumentResult(studentId, item) {
  const result = resultFor(studentId, item.id)
  if (!result || typeof result !== 'object') return '—'
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(result.total) || 0)
}

watch(documentAssessmentDialog, (open, wasOpen) => {
  if (open || !wasOpen) return
  if (documentAssessmentChanged.value) emit('autosave-request', { includeIdentities: false })
  documentAssessmentChanged.value = false
  documentAssessmentStudent.value = null
  documentAssessmentItem.value = null
  documentAssessmentExercises.value = []
})

watch(() => props.teacherId, () => {
  rubrics.value = []
  rubricsLoadedForTeacher.value = ''
})

function groupMean(studentId, group) {
  const value = weightedNodeMean(studentId, group)
  return value === null ? '' : new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
}

function weightedNodeMean(studentId, node) {
  if (!node) return null
  // Los méritos son un saldo de convivencia, no una calificación: deben
  // mostrarse como columna independiente sin contaminar las medias.
  if (node.type === 'item') return node.merits ? null : numericResult(studentId, node.id)
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
  cloudGroup.alumnos = students.value.map((student) => ({
    id: student.id,
    ...(studentSourceGroups.value.length > 1 ? { sourceGroup: studentSourceGroup(student) } : {}),
  }))
  return cloudGroup
}

function privateStudentIdentity(student) {
  const { sourceGroup: _sourceGroup, ...identity } = student
  return identity
}

async function persistLocalIdentities() {
  identityError.value = ''
  try {
    await saveStudentIdentities(localGroup.value.id, students.value.map(privateStudentIdentity))
  } catch (error) {
    identityError.value = 'No se han podido guardar los datos identificativos en este dispositivo.'
    throw error
  }
}

async function hydrateStudentIdentities() {
  const storedIdentities = await loadStudentIdentitiesForGroup(localGroup.value)
  const diagnostics = studentIdentityDiagnostics(storedIdentities)
  students.value.forEach((student) => {
    const sourceGroup = student.sourceGroup
    const localIdentity = storedIdentities.get(student.id)
    Object.assign(student, localIdentity || {})
    if (studentSourceGroups.value.length > 1) student.sourceGroup = normalizedSourceGroup(sourceGroup, studentSourceGroups.value)
    else delete student.sourceGroup
    student.nombre ||= ''
    student.nombreCorto ||= shortStudentName(student.nombre)
  })
  sortStudentsByName()
  if (diagnostics.failed) {
    showAppErrorToast(identityRecoveryMessage(diagnostics), { color: 'warning', copy: false })
  }
  if (students.value.length && storedIdentities.size < students.value.length) {
    const audit = await inspectLocalStudentIdentityCodeMatch(students.value.map((student) => student.id))
    const summarizeCodes = (codes) => `${codes.slice(0, 12).join(', ')}${codes.length > 12 ? ` … (+${codes.length - 12})` : ''}`
    const details = [
      `${audit.matchedStudentIds.length} de ${audit.requestedStudentIds.length} códigos del grupo coinciden con el almacén local.`,
      `El almacén contiene ${audit.recordCount} registros y ${audit.localStudentIds.length} códigos distintos.`,
      audit.missingStudentIds.length ? `Códigos del grupo sin ficha: ${summarizeCodes(audit.missingStudentIds)}` : '',
      audit.orphanStudentIds.length ? `Muestra de códigos locales ajenos al grupo: ${summarizeCodes(audit.orphanStudentIds)}` : '',
      audit.recordKeySamples.length ? `Claves técnicas: ${audit.recordKeySamples.map((entry) => `${entry.key} [id=${entry.studentId || '∅'}; grupo=${entry.groupId || '∅'}]`).join(' · ')}` : '',
    ].filter(Boolean).join('\n')
    console.warn('Auditoría de códigos pseudónimos:', details)
    showAppErrorToast(details, { color: 'warning' })
  }
}

function scheduleLocalIdentitySave() {
  if (identityLoading.value) return
  clearTimeout(localIdentitySaveTimer)
  localIdentitySaveTimer = setTimeout(() => {
    localIdentitySaveTimer = null
    persistLocalIdentities().catch((error) => console.error('Error al autoguardar identidades locales:', error))
  }, 350)
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
    await hydrateStudentIdentities()
  } catch (error) {
    identityError.value = error?.message || 'No se han podido abrir los datos identificativos guardados en este dispositivo.'
    console.error('Error al cargar las identidades locales:', error)
  } finally {
    identityLoading.value = false
    emitValidity()
  }
})

watch(students, scheduleLocalIdentitySave, { deep: true })

onBeforeUnmount(() => {
  clearTimeout(localIdentitySaveTimer)
  if (!identityLoading.value) {
    void persistLocalIdentities().catch((error) => console.error('Error al guardar identidades locales al cerrar el grupo:', error))
  }
})

defineExpose({
  addStudent,
  openBulkStudentDialog,
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
            <template v-if="visibleStructure.length">
              <th
                v-for="cell in row"
                :key="cell.key"
                :colspan="cell.colspan"
                :rowspan="cell.rowspan || 1"
                :title="cell.kind === 'item' ? undefined : cell.title"
                :data-gradebook-node-id="cell.node?.id"
                :draggable="false"
                class="gradebook-header-cell"
                :class="[
                  `gradebook-header-${cell.kind}`,
                  { 'gradebook-drop-target': cell.node && dropTargetId === cell.node.id },
                ]"
              >
                <v-tooltip v-if="cell.kind === 'item'" activator="parent" :text="itemHeaderTooltip(cell.node)" location="top" />
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
                <span v-else class="gradebook-student-avatar gradebook-student-avatar-empty" aria-hidden="true"></span>
                <input v-if="configurationMode"
                  v-model="student.nombre"
                  type="text"
                  :readonly="disabled || identityLoading || !configurationMode"
                  :class="{ 'gradebook-student-name-invalid': !studentNameIsValid(student.nombre) }"
                  :title="studentNameIsValid(student.nombre) ? '' : 'Usa el formato APELLIDO 1 APELLIDO 2, Nombre'"
                  placeholder="APELLIDO 1 APELLIDO 2, Nombre"
                  aria-label="Nombre del alumno"
                  @input="updateStudentName(student)"
                  @blur="normalizeStudentName(student)"
                >
                <button v-else type="button" class="gradebook-student-name" @click="emit('student-selected', { ...student })">
                  {{ student.nombre || student.id }}
                </button>
                <button
                  v-if="studentSourceGroups.length > 1"
                  type="button"
                  class="gradebook-student-source"
                  :style="studentSourceStyle(student)"
                  :class="{ 'gradebook-student-source-editable': configurationMode }"
                  :disabled="disabled || !configurationMode"
                  :aria-label="configurationMode ? `Cambiar subgrupo de ${student.nombre || student.id}` : `Subgrupo ${studentSourceGroup(student)}`"
                  :title="configurationMode ? 'Cambiar subgrupo' : `Subgrupo ${studentSourceGroup(student)}`"
                  @click="cycleStudentSourceGroup(student)"
                >{{ studentSourceGroup(student) }}</button>
                <button v-if="configurationMode" type="button" class="gradebook-student-remove" :aria-label="`Eliminar ${student.nombre || 'alumno'}`" @click="removeStudent(student.id)">
                  <v-icon icon="mdi-delete-outline" size="16" />
                </button>
              </div>
            </th>
            <td v-for="column in resultColumns" :key="column.key" :class="{ 'gradebook-mean-cell': column.kind === 'mean', 'gradebook-rubric-cell': column.kind === 'item' && (column.node.rubric || column.node.merits), 'gradebook-document-cell': column.kind === 'item' && column.node.documentAssessment }">
              <button
                v-if="column.kind === 'item' && column.node.documentAssessment"
                type="button"
                class="gradebook-rubric-score gradebook-document-score"
                :disabled="disabled || configurationMode"
                :aria-label="`${column.title}: corregir el documento de ${student.nombre || student.id}`"
                @click="openDocumentAssessment(student, column.node)"
              >{{ formattedDocumentResult(student.id, column.node) }}</button>
              <button
                v-else-if="column.kind === 'item' && (column.node.rubric || column.node.merits)"
                type="button"
                class="gradebook-rubric-score"
                :disabled="disabled || configurationMode"
                :aria-label="`${column.title}: evaluar a ${student.nombre || student.id}${column.node.merits ? ' mediante méritos' : ` con la rúbrica ${column.node.rubric.title}`}`"
                @click="openRubricAssessment(student, column.node)"
              >{{ column.node.merits ? formattedMeritsResult(student.id, column.node) : formattedRubricResult(student.id, column.node) }}</button>
              <input
                v-else-if="column.kind === 'item'"
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

    <v-dialog v-model="itemDialog" max-width="860">
      <v-card>
        <v-card-title class="px-6 pt-5">Nuevo ítem de evaluación</v-card-title>
        <v-card-text class="gradebook-column-form px-6 pb-2">
          <v-text-field v-model="itemForm.nombre" label="Nombre completo" placeholder="Examen de sistemas de ecuaciones" variant="outlined" density="compact" hide-details autofocus />
          <v-text-field v-model="itemForm.nombreCorto" label="Nombre corto" placeholder="Examen 1" variant="outlined" density="compact" hide-details @keyup.enter="addItem" />
          <v-btn-toggle :model-value="itemForm.type" color="primary" mandatory variant="outlined" density="compact" @update:model-value="chooseItemType">
            <v-btn value="standard">Calificación</v-btn>
            <v-btn value="merits">Méritos</v-btn>
          </v-btn-toggle>
          <section v-if="itemForm.type !== 'merits'" class="gradebook-rubric-picker">
            <header>
              <div><strong>Rúbrica</strong><span>Selecciona una rúbrica para evaluar este ítem por categorías.</span></div>
              <v-btn v-if="selectedItemRubric" size="small" variant="text" @click="chooseItemRubric(null)">Sin rúbrica</v-btn>
            </header>
            <div v-if="rubricsLoading" class="gradebook-rubric-loading"><v-progress-circular indeterminate color="primary" size="28" width="3" /><span>Cargando rúbricas…</span></div>
            <div v-else-if="eligibleRubrics.length" class="gradebook-rubric-options">
              <button
                v-for="rubric in eligibleRubrics"
                :key="rubric.id"
                type="button"
                class="gradebook-rubric-option"
                :class="{ 'gradebook-rubric-option-selected': itemForm.rubricId === rubric.id }"
                :aria-pressed="itemForm.rubricId === rubric.id"
                @click="chooseItemRubric(rubric)"
              >
                <strong>{{ rubric.shortName ? `${rubric.shortName} · ${rubric.title}` : rubric.title }}</strong>
                <span>{{ rubric.subjectTitle }} · {{ rubric.categories.length }} categoría{{ rubric.categories.length === 1 ? '' : 's' }}</span>
              </button>
            </div>
            <div v-else class="gradebook-rubric-empty">No hay rúbricas disponibles para {{ localGroup.curso }} · {{ localGroup.asignatura }}.</div>
          </section>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="itemDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!itemForm.nombre.trim() || !itemForm.nombreCorto.trim()" @click="addItem">Añadir</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="bulkStudentDialog" max-width="620">
      <v-card>
        <v-card-title class="px-6 pt-5">Añadir alumnos</v-card-title>
        <v-card-text class="px-6 pb-2">
          <p class="text-body-2 text-medium-emphasis mb-4">Pega una columna de nombres o de códigos. Un código de seis caracteres reutiliza la ficha local existente; al backend solo llegarán los códigos anónimos.</p>
          <v-textarea v-model="bulkStudentText" label="Nombres o códigos" placeholder="APELLIDO 1 APELLIDO 2, Nombre\nA7xQ2M" rows="10" auto-grow variant="outlined" autofocus hide-details />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" @click="bulkStudentDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!bulkStudentText.trim()" @click="importBulkStudents">Añadir alumnos</v-btn>
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

    <v-dialog v-model="rubricAssessmentDialog" max-width="1120" width="calc(100% - 32px)" height="min(860px, calc(100dvh - 40px))">
      <v-card v-if="(activeRubric || activeMerits) && activeRubricResult" class="gradebook-rubric-assessment">
        <v-card-title class="gradebook-rubric-assessment-title">
          <div>
            <small>{{ rubricAssessmentItem?.nombre }}</small>
            <strong>{{ activeMerits ? 'Méritos' : activeRubric.title }}</strong>
            <span>{{ rubricAssessmentStudent?.nombre || rubricAssessmentStudent?.id }}</span>
          </div>
          <div class="gradebook-rubric-total"><span>Total</span><strong>{{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(activeRubricResult.total) }}</strong></div>
          <v-btn icon="mdi-close" rounded="circle" variant="text" aria-label="Cerrar rúbrica" @click="closeRubricAssessment" />
        </v-card-title>
        <v-divider />
        <v-card-text class="gradebook-rubric-categories">
          <template v-if="activeMerits">
            <article class="gradebook-rubric-category merits-category">
              <header><span>−</span><div><strong>Convivencia y respeto</strong><small>Registra la conducta observada.</small></div></header>
              <div class="gradebook-level-scores merits-options">
                <button type="button" @click="appendMeritsTransaction(-5, 'Actitud gravemente perjudicial')"><span>−5 pt</span><strong>Actitud perjudicial para la convivencia, el aula o falta grave de respeto.</strong></button>
                <button v-for="points in [-5, -3, -1]" :key="points" type="button" @click="appendMeritsTransaction(points, 'Actitud molesta o falta de respeto')"><span>{{ points }} pt</span><strong>Actitud molesta para el aula o falta de respeto.</strong></button>
              </div>
            </article>
            <article class="gradebook-rubric-category merits-category">
              <header><span>+</span><div><strong>Iniciativa y colaboración</strong><small>Reconoce contribuciones positivas a la comunidad.</small></div></header>
              <div class="gradebook-level-scores merits-options">
                <button v-for="points in [1, 2, 3]" :key="points" type="button" @click="appendMeritsTransaction(points, 'Iniciativa de ayuda')"><span>+{{ points }} pt</span><strong>Iniciativa que ayuda a compañeros, profesor o comunidad educativa.</strong></button>
              </div>
            </article>
            <article class="gradebook-rubric-category merits-rewards">
              <header><span>★</span><div><strong>Canjear méritos</strong><small>El premio se registra como un descuento en el acumulado.</small></div></header>
              <div class="gradebook-range-scores">
                <button v-for="cost in [5, 10, 15, 20]" :key="cost" type="button" :disabled="Number(activeRubricResult.total) < cost" @click="spendMerits(cost)">Premio {{ cost }}</button>
              </div>
              <small v-if="activeRubricResult.transactions?.length" class="merits-history">Último movimiento: {{ activeRubricResult.transactions.at(-1)?.label }}</small>
            </article>
          </template>
          <article v-for="(category, categoryIndex) in activeRubric?.categories || []" v-else :key="category.id" class="gradebook-rubric-category">
            <header><span>{{ categoryIndex + 1 }}</span><div><strong>{{ category.title }}</strong><small>{{ categoryScore(category)?.points === null ? 'Neutro' : `${categoryScore(category)?.points ?? 0} puntos` }}</small></div></header>
            <template v-if="category.type === 'range'">
              <div class="gradebook-range-assessment">
                <p>{{ category.range.description }}</p>
                <div class="gradebook-range-scores" role="group" :aria-label="`Puntuación de ${category.title}`">
                  <button
                    v-for="points in rubricRangeValues(category)"
                    :key="points"
                    type="button"
                    :class="{ selected: categoryScore(category)?.points === points }"
                    :aria-pressed="categoryScore(category)?.points === points"
                    @click="chooseCategoryScore(category, points)"
                  >{{ points }}</button>
                </div>
              </div>
            </template>
            <div v-else class="gradebook-level-scores" role="group" :aria-label="`Nivel de ${category.title}`">
              <button
                v-for="level in category.levels"
                :key="level.id"
                type="button"
                :class="{ selected: categoryScore(category)?.levelId === level.id }"
                :aria-pressed="categoryScore(category)?.levelId === level.id"
                @click="chooseCategoryScore(category, level.id)"
              >
                <span>{{ level.points === null ? 'Neutro' : `${level.points} pt` }}</span>
                <strong>{{ level.description }}</strong>
              </button>
            </div>
            <RubricAlignmentBadges :alignment="category.alignment" />
          </article>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-6 py-4"><v-spacer /><v-btn color="primary" variant="flat" @click="closeRubricAssessment">Cerrar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="documentAssessmentDialog" max-width="1500" width="calc(100% - 24px)" height="calc(100dvh - 28px)">
      <v-card class="gradebook-document-assessment">
        <v-card-title class="gradebook-document-assessment-title">
          <div>
            <small>{{ documentAssessmentItem?.nombre }}</small>
            <strong>{{ documentAssessmentStudent?.nombre || documentAssessmentStudent?.id }}</strong>
          </div>
          <div class="gradebook-rubric-total">
            <span>Nota</span>
            <strong>{{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(activeDocumentAssessmentResult?.total) || 0) }} / {{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(documentAssessmentItem?.documentAssessment?.maxPoints) || 0) }}</strong>
          </div>
          <v-btn icon="mdi-close" rounded="circle" variant="text" aria-label="Cerrar corrección" @click="documentAssessmentDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text v-if="documentAssessmentLoading" class="gradebook-document-loading">
          <v-progress-circular indeterminate color="primary" />
          <span>Cargando el examen…</span>
        </v-card-text>
        <v-card-text v-else class="gradebook-document-grid-wrap">
          <DocumentAssessmentMatrix
            :exercises="documentAssessmentExercises"
            :selected-achievement-ids="activeDocumentAchievementIds"
            :title="''"
            selectable
            @toggle-achievement="chooseDocumentAchievement"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-6 py-3"><v-spacer /><v-btn color="primary" variant="flat" @click="documentAssessmentDialog = false">Cerrar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
