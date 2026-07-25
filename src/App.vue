<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { latex } from 'codemirror-lang-latex'
import { db, functions, isAppCheckConfigured, storage } from './services/firebase'
import MasonryGrid from './components/MasonryGrid.vue'
import MathConceptMap from './components/MathConceptMap.vue'
import { mathSubjects, normalizeHierarchySelection } from './data/mathCurriculum'

const ExercisePdfPreview = defineAsyncComponent(() => import('./components/ExercisePdfPreview.vue'))

const drawer = ref(true)
const active = ref('Ejercicios')
const mathConceptConfigurationMode = ref(false)
const mathConceptViewRef = ref(null)
const mathConceptNodes = ref([{ id: 'matematicas', title: 'Matemáticas', parentId: null }])
const activeMathSubjectId = ref(null)
const mathConceptSubjectSelections = ref({})
const isLoadingMathConcepts = ref(false)
const isSavingMathConcepts = ref(false)
const mathConceptsError = ref('')
const mathConceptDeleteDialog = ref(false)
const mathConceptDeleteTarget = ref(null)
let mathConceptSaveRequested = false
const calendarNotifications = ref(0)
const chatNotifications = ref(0)
const calendarMode = ref('week')
const shownMonth = ref(new Date())
const currentTime = ref(new Date())
const scheduleConfigMode = ref(false)
const scheduleDialog = ref(false)
const selectedSlot = ref(null)
const scheduleBlocks = ref([])
const scheduleForm = ref(emptyScheduleForm())
const selectedSchedulePreset = ref(null)
const isSavingSchedule = ref(false)
const firestoreError = ref('')
const teacherDocument = doc(db, 'teachers', 'test')
const exercises = ref([])
const selectedExerciseId = ref(null)
const exerciseEditor = ref(emptyExercise())
const exerciseView = ref('search')
const exerciseSearchQuery = ref('')
const isLoadingExercises = ref(false)
const isSavingExercise = ref(false)
const isGeneratingVariation = ref(false)
const isGeneratingSolution = ref(false)
const isDeletingSolution = ref(false)
const variationProgressText = ref('')
const selectedExerciseVersion = ref(0)
const aiModelOptions = Object.freeze([
  { title: 'Gemini 3 Flash', value: 'google/gemini-3-flash-preview', subtitle: 'Predeterminado · rápido y fiable' },
  { title: 'GPT-5 Mini', value: 'openai/gpt-5-mini', subtitle: 'Equilibrio entre coste y calidad' },
  { title: 'GPT-5.6 Luna', value: 'openai/gpt-5.6-luna', subtitle: 'Premium · rápida y estructurada' },
  { title: 'GPT-5.6 Terra', value: 'openai/gpt-5.6-terra', subtitle: 'Premium · razonamiento equilibrado' },
  { title: 'GPT-5.6 Sol', value: 'openai/gpt-5.6-sol', subtitle: 'Premium · máxima capacidad' },
  { title: 'Kimi K3', value: 'moonshotai/kimi-k3', subtitle: 'Premium · razonamiento de contexto largo' },
])
const selectedAiModel = ref('google/gemini-3-flash-preview')
const exercisesError = ref('')
const latexEditorHost = ref(null)
let latexCodeEditor
const templates = ref([])
const selectedTemplateId = ref(null)
const templateEditor = ref(emptyTemplate())
const isEditingTemplate = ref(false)
const isLoadingTemplates = ref(false)
const isSavingTemplate = ref(false)
const templatesError = ref('')
const templateEditorHost = ref(null)
let templateCodeEditor
const compilerBaseUrl = import.meta.env.DEV ? '/compiler-api/v1' : 'http://51.170.57.25:5000/v1'
const selectedPreamble = ref('')
const exercisePreviewTab = ref('statement')
const compilerError = ref('')
const isCompiling = ref(false)

const monthLabel = computed(() => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(shownMonth.value))
const activeMathSubjectNodeIds = computed(() => (
  activeMathSubjectId.value ? mathConceptSubjectSelections.value[activeMathSubjectId.value] || [] : []
))
const weekDays = computed(() => {
  const date = new Date(shownMonth.value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return Array.from({ length: 5 }, (_, index) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + index))
})
const calendarTitle = computed(() => {
  if (calendarMode.value === 'month') return monthLabel.value
  if (calendarMode.value === 'year') return `Curso ${academicMonths.value[0].getFullYear()} / ${academicMonths.value[9].getFullYear()}`
  const months = [...new Set(weekDays.value.map((date) => new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(date)))]
  return months.map((month) => month.charAt(0).toUpperCase() + month.slice(1)).join(' / ')
})
const scheduleModules = [
  { start: '08:15', end: '09:10', minutes: 55 },
  { start: '09:10', end: '10:05', minutes: 55 },
  { start: '10:05', end: '11:00', minutes: 55 },
  { start: '11:00', end: '11:20', minutes: 20, break: true },
  { start: '11:20', end: '12:15', minutes: 55 },
  { start: '12:15', end: '13:10', minutes: 55 },
  { start: '13:10', end: '14:05', minutes: 55 },
  { start: '14:05', end: '15:00', minutes: 55 },
]
function getMonthDays(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: Math.ceil((firstDay + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstDay + 1
    return day > 0 && day <= daysInMonth ? day : null
  })
}
const calendarDays = computed(() => getMonthDays(shownMonth.value))
const academicMonths = computed(() => {
  const startYear = shownMonth.value.getMonth() >= 8 ? shownMonth.value.getFullYear() : shownMonth.value.getFullYear() - 1
  return Array.from({ length: 10 }, (_, index) => new Date(startYear, 8 + index, 1))
})

const availableExerciseTags = computed(() => [...new Set(exercises.value.flatMap((exercise) => exercise.tags))].sort((a, b) => a.localeCompare(b, 'es')))
const filteredExercises = computed(() => {
  const search = exerciseSearchQuery.value.trim().toLocaleLowerCase('es')
  return exercises.value.filter((exercise) => {
    const matchesSearch = !search
      || exercise.enunciado.toLocaleLowerCase('es').includes(search)
      || exercise.tags.some((tag) => tag.toLocaleLowerCase('es').includes(search))
    return matchesSearch
  })
})
const selectedExercise = computed(() => exercises.value.find((exercise) => exercise.id === selectedExerciseId.value) || null)
const activeExerciseVersion = computed(() => selectedExerciseVersion.value === 0
  ? exerciseEditor.value
  : exerciseEditor.value.variaciones[selectedExerciseVersion.value - 1] || exerciseEditor.value)
const activeExerciseCode = computed(() => activeExerciseVersion.value.enunciado || '')
const compiledPdfUrl = computed(() => activeExerciseVersion.value.previewPdf?.enunciado || activeExerciseVersion.value.pdf?.enunciado || '')
const compiledSolutionPdfUrl = computed(() => activeExerciseVersion.value.previewPdf?.resuelto || activeExerciseVersion.value.pdf?.resuelto || '')
const hasLatexChanges = computed(() => activeExerciseCode.value !== (activeExerciseVersion.value.renderedLatex || ''))
const activeExercisePdfUrl = computed(() => exercisePreviewTab.value === 'statement'
  ? compiledPdfUrl.value
  : compiledSolutionPdfUrl.value)
const selectedTemplate = computed(() => templates.value.find((template) => template.id === selectedTemplateId.value) || null)
const preambleOptions = computed(() => templates.value.filter((template) => template.archivo))

const courseOptions = computed(() => uniqueScheduleValues('course'))
const subjectOptions = computed(() => uniqueScheduleValues('subject'))
const classroomOptions = computed(() => uniqueScheduleValues('classroom'))
const hasSelectedScheduleBlock = computed(() => selectedSlot.value
  && Boolean(scheduleBlock(selectedSlot.value.dayIndex, selectedSlot.value.moduleIndex)))
const schedulePresets = computed(() => {
  const uniqueBlocks = new Map()
  scheduleBlocks.value.forEach((block) => {
    const key = block.groupId || [block.course, block.subject, block.classroom, block.color].join('|')
    if (!uniqueBlocks.has(key)) {
      uniqueBlocks.set(key, {
        groupId: block.groupId,
        course: block.course,
        subject: block.subject,
        classroom: block.classroom,
        color: block.color,
        title: [block.course, block.subject, block.classroom].filter(Boolean).join(' · '),
      })
    }
  })
  return [...uniqueBlocks.values()]
})
const colorOptions = [
  { title: 'Azul cielo', value: '#DCEBFF' },
  { title: 'Turquesa', value: '#D8F3EF' },
  { title: 'Verde menta', value: '#DDF4EA' },
  { title: 'Verde lima', value: '#E7F5C9' },
  { title: 'Amarillo', value: '#FFF1C9' },
  { title: 'Naranja', value: '#FFE2C2' },
  { title: 'Coral', value: '#FFE2DD' },
  { title: 'Rosa', value: '#FCE0EE' },
  { title: 'Lila', value: '#ECE4FF' },
  { title: 'Gris', value: '#E6EAF0' },
]

function emptyScheduleForm() {
  return { groupId: null, course: '', subject: '', classroom: '', color: null }
}

function emptyExercise() {
  return {
    id: null,
    enunciado: '',
    tags: [],
    pdf: emptyPdfPair(),
    solucionIA: false,
    variaciones: [],
    previewPdf: null,
    renderedLatex: '',
  }
}

function emptyPdfPair() {
  return { enunciado: '', resuelto: null }
}

function normalizePdfPair(pdf) {
  if (typeof pdf === 'string') return { enunciado: pdf, resuelto: null }
  return { enunciado: pdf?.enunciado || '', resuelto: pdf?.resuelto || null }
}

function normalizeVariation(variation = {}) {
  const pdf = normalizePdfPair(variation.pdf)
  return {
    enunciado: variation.enunciado || '',
    modelo: variation.modelo || '',
    pdf,
    previewPdf: null,
    renderedLatex: pdf.enunciado ? variation.enunciado || '' : '',
  }
}

function normalizeExercise(exercise) {
  const pdf = normalizePdfPair(exercise.pdf)
  return {
    ...exercise,
    enunciado: exercise.enunciado || '',
    tags: normalizeTags(exercise.tags),
    pdf,
    solucionIA: Boolean(exercise.solucionIA),
    variaciones: Array.isArray(exercise.variaciones) ? exercise.variaciones.map(normalizeVariation) : [],
    previewPdf: null,
    renderedLatex: pdf.enunciado ? exercise.enunciado || '' : '',
  }
}

function exerciseSolutionBadge(exercise) {
  if (!exercise.pdf?.resuelto) {
    return { label: 'Sin resolver', color: undefined, icon: 'mdi-file-document-outline' }
  }
  return exercise.solucionIA
    ? { label: 'Resuelto por IA', color: 'secondary', icon: 'mdi-brain' }
    : { label: 'Resuelto', color: 'success', icon: 'mdi-file-document-check-outline' }
}

function emptyTemplate() {
  return { id: null, nombre: '', descripcion: '', codigo: '', archivo: '' }
}

function preambleFileName(name) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plantilla'
  return `${normalized}.tex`
}

function exercisePreambleName() {
  const exerciseTemplate = templates.value.find((template) => {
    const name = template.nombre?.trim().toLocaleLowerCase('es')
    const file = template.archivo?.replace(/\.tex$/i, '').trim().toLocaleLowerCase('es')
    return name === 'ejercicio' || file === 'ejercicio'
  })
  return exerciseTemplate?.archivo || 'ejercicio.tex'
}

function codeForPreamble(code) {
  if (/\\begin\{ejercicios\}/.test(code)) return code
  const standaloneCode = code.replace(/\\ej\b/g, '\\refstepcounter{ejercicio}').trimStart()
  return `\\begin{ejercicios}\n${standaloneCode}\n\\end{ejercicios}`
}

function removeBlankLinesInsideAligned(code) {
  return code.replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => (
    `\\begin{aligned}${body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')}\\end{aligned}`
  ))
}

function compileErrorWithSourceContext(code, preambleName, error) {
  const compilerMessage = error?.message || 'El compilador LaTeX no ha aceptado el documento.'
  const lineMatch = compilerMessage.match(/document\.tex:(\d+):/)
  if (!lineMatch) return compilerMessage

  const preamble = templates.value.find((template) => template.archivo === preambleName)?.codigo || ''
  const sourceLines = codeForPreamble(code).split('\n')
  const preambleLines = preamble.split('\n').length
  const sourceLine = Number(lineMatch[1]) - preambleLines - 2
  if (sourceLine < 1 || sourceLine > sourceLines.length) return compilerMessage

  const start = Math.max(0, sourceLine - 4)
  const end = Math.min(sourceLines.length, sourceLine + 3)
  const excerpt = sourceLines.slice(start, end)
    .map((line, index) => `${start + index + 1}${start + index + 1 === sourceLine ? ' >' : '  '} ${line}`)
    .join('\n')
  return `${compilerMessage}\n\nLa línea ${sourceLine} corresponde al fragmento siguiente del ejercicio generado:\n${excerpt}`
}

function hasExerciseSolutions(code) {
  return /\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/.test(code)
}

function statementLatex(code) {
  return code
    .replace(/\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function clearVersionPreview(version) {
  if (!version?.previewPdf) return
  Object.values(version.previewPdf).forEach((url) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  })
  version.previewPdf = null
}

function clearExercisePreviews() {
  clearVersionPreview(exerciseEditor.value)
  exerciseEditor.value.variaciones.forEach(clearVersionPreview)
}

function setActivePreviewPdf(documentType, url) {
  const version = activeExerciseVersion.value
  const previousUrl = version.previewPdf?.[documentType]
  if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
  version.previewPdf = { ...(version.previewPdf || emptyPdfPair()), [documentType]: url }
}

async function compilerRequest(path, options = {}) {
  const response = await fetch(`${compilerBaseUrl}${path}`, options)
  if (response.ok) return response
  let details = {}
  try { details = await response.json() } catch { /* La API puede devolver texto plano. */ }
  throw new Error(details.log || details.message || `Error del compilador (${response.status})`)
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean)
  if (!tags || typeof tags !== 'object') return []
  return Object.entries(tags).filter(([, enabled]) => enabled).map(([tag]) => tag)
}

function displayTag(tag) {
  return tag.split('.').at(-1)
}

function exerciseSummary(enunciado) {
  return enunciado
    .replace(/\\(?:begin|end)\{[^}]*\}/g, '')
    .replace(/\\p\{[^}]*\}/g, '')
    .replace(/\\(?:ej|ap|sol)\b/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || 'Ejercicio sin enunciado'
}

const baseLatexCompletions = [
  { label: '\\ej', type: 'keyword', apply: '\\ej\\p{} ' },
  { label: '\\p{}', type: 'function', apply: '\\p{}' },
  { label: '\\sol{}', type: 'function', apply: '\\sol{}' },
  { label: '\\ap', type: 'keyword', apply: '\\ap\\p{} ' },
  { label: '\\begin{apartados}', type: 'keyword', apply: '\\begin{apartados}\n\t\n\\end{apartados}' },
  { label: '\\end{apartados}', type: 'keyword', apply: '\\end{apartados}' },
  { label: '\\begin{solucion}', type: 'keyword', apply: '\\begin{solucion}\n\t\n\\end{solucion}' },
  { label: '\\end{solucion}', type: 'keyword', apply: '\\end{solucion}' },
]

const latexEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#10213a', color: '#EAF2FF' },
  '.cm-content': { caretColor: '#FFFFFF' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#FFFFFF' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#315E97 !important' },
  '.cm-activeLine': { backgroundColor: '#173455' },
  '.cm-gutters': { backgroundColor: '#0B192D', color: '#8EA7C5', borderRight: '1px solid #244669' },
  '.cm-activeLineGutter': { backgroundColor: '#173455', color: '#FFFFFF' },
  '.cm-tooltip': { border: '1px solid #4C79AC', backgroundColor: '#F7FAFF', color: '#173455' },
}, { dark: true })

const latexHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword], color: '#7DD3FC', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: '#FDE68A' },
  { tag: [tags.number, tags.integer, tags.float], color: '#C4B5FD' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8FB39A', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.paren, tags.punctuation], color: '#F9A8D4' },
  { tag: [tags.typeName, tags.className], color: '#86EFAC' },
]))

function latexCompletionFor(code, context) {
  const typed = context.matchBefore(/\\[a-zA-Z]*/)
  if (!typed || (typed.from === typed.to && !context.explicit)) return null
  const commands = [...new Set([...code.matchAll(/\\[a-zA-Z]+/g)].map(([command]) => command))]
    .filter((command) => !baseLatexCompletions.some((option) => option.label === command))
    .map((command) => ({ label: command, type: 'keyword', apply: command }))
  const environments = [...new Set([...code.matchAll(/\\(?:begin|end)\{([^}]+)\}/g)].map(([, environment]) => environment))]
    .flatMap((environment) => [`\\begin{${environment}}`, `\\end{${environment}}`])
    .filter((environment) => !baseLatexCompletions.some((option) => option.label === environment))
    .map((environment) => ({ label: environment, type: 'keyword', apply: environment }))
  return { from: typed.from, options: [...baseLatexCompletions, ...commands, ...environments] }
}

function latexCompletion(context) {
  return latexCompletionFor(activeExerciseCode.value, context)
}

function templateLatexCompletion(context) {
  return latexCompletionFor(templateEditor.value.codigo, context)
}

function tagsToObject(tags) {
  const expandedTags = new Set()
  tags.forEach((tag) => {
    const levels = tag.trim().replace(/^geometria(?=\.|$)/i, 'geometría').split('.').map((level) => level.trim()).filter(Boolean)
    levels.forEach((_, index) => expandedTags.add(levels.slice(0, index + 1).join('.')))
  })
  return Object.fromEntries([...expandedTags].map((tag) => [tag, true]))
}

async function loadExercises() {
  isLoadingExercises.value = true
  exercisesError.value = ''
  try {
    const snapshot = await getDocs(collection(db, 'ejercicios'))
    exercises.value = snapshot.docs
      .map((exercise) => normalizeExercise({ id: exercise.id, ...exercise.data() }))
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch (error) {
    exercisesError.value = 'No se han podido cargar los ejercicios de Firestore.'
    console.error('Error al cargar ejercicios:', error)
  } finally {
    isLoadingExercises.value = false
  }
}

async function loadMathConcepts() {
  isLoadingMathConcepts.value = true
  mathConceptsError.value = ''
  try {
    const snapshot = await getDoc(doc(db, 'especialidades', 'Matemáticas'))
    const storedData = snapshot.exists() ? snapshot.data() : {}
    const storedNodes = Array.isArray(storedData?.nodes) ? storedData.nodes : []
    const siblingIndexes = new Map()
    const validNodes = storedNodes
      .filter((node) => typeof node?.id === 'string' && typeof node?.title === 'string')
      .map((node) => {
        const parentId = typeof node.parentId === 'string' ? node.parentId : null
        const siblingIndex = siblingIndexes.get(parentId) || 0
        siblingIndexes.set(parentId, siblingIndex + 1)
        return {
          id: node.id,
          title: node.title,
          parentId,
          order: Number.isFinite(node.order) ? node.order : siblingIndex,
        }
      })
    const root = validNodes.find((node) => node.id === 'matematicas') || { id: 'matematicas', title: 'Matemáticas', parentId: null, order: 0 }
    mathConceptNodes.value = [root, ...validNodes.filter((node) => node.id !== 'matematicas')]
    const storedSubjects = storedData?.asignaturas && typeof storedData.asignaturas === 'object' ? storedData.asignaturas : {}
    mathConceptSubjectSelections.value = Object.fromEntries(mathSubjects.map((subject) => {
      const storedSelection = storedSubjects[subject.id]
      const nodeIds = Array.isArray(storedSelection) ? storedSelection : storedSelection?.nodos
      return [subject.id, Array.isArray(nodeIds) ? [...new Set(nodeIds.filter((id) => typeof id === 'string'))] : []]
    }))
  } catch (error) {
    mathConceptsError.value = 'No se ha podido cargar el mapa de Matemáticas.'
    console.error('Error al cargar el mapa de Matemáticas:', error)
  } finally {
    isLoadingMathConcepts.value = false
  }
}

function normalizeMathSubjectSelections() {
  return Object.fromEntries(mathSubjects.map((subject) => {
    const selectedIds = mathConceptSubjectSelections.value[subject.id] || []
    return [subject.id, normalizeHierarchySelection(mathConceptNodes.value, selectedIds)]
  }))
}

async function persistMathConcepts() {
  if (isSavingMathConcepts.value) {
    mathConceptSaveRequested = true
    return
  }
  do {
    mathConceptSaveRequested = false
    isSavingMathConcepts.value = true
    mathConceptsError.value = ''
    const normalizedSelections = normalizeMathSubjectSelections()
    mathConceptSubjectSelections.value = normalizedSelections
    try {
      await setDoc(doc(db, 'especialidades', 'Matemáticas'), {
        nombre: 'Matemáticas',
        nodes: mathConceptNodes.value.map((node) => ({
          id: node.id,
          title: node.title.trim(),
          parentId: node.parentId || null,
          order: Number.isFinite(node.order) ? node.order : 0,
        })),
        asignaturas: Object.fromEntries(mathSubjects.map((subject) => [subject.id, {
          curso: subject.course,
          nombre: subject.title,
          nodos: normalizedSelections[subject.id],
        }])),
        updatedAt: new Date().toISOString(),
      }, { merge: true })
    } catch (error) {
      mathConceptsError.value = 'No se ha podido guardar el mapa de Matemáticas.'
      console.error('Error al guardar el mapa de Matemáticas:', error)
    } finally {
      isSavingMathConcepts.value = false
    }
  } while (mathConceptSaveRequested)
}

function selectMathSubject(subjectId) {
  activeMathSubjectId.value = mathSubjects.some((subject) => subject.id === subjectId) ? subjectId : null
  nextTick(() => mathConceptViewRef.value?.fitView?.())
}

function updateMathSubjectNodeIds(nodeIds) {
  const subjectId = activeMathSubjectId.value
  if (!subjectId || !mathSubjects.some((subject) => subject.id === subjectId)) return
  mathConceptSubjectSelections.value = {
    ...mathConceptSubjectSelections.value,
    [subjectId]: [...new Set(nodeIds.filter((id) => typeof id === 'string'))],
  }
  persistMathConcepts()
}

function toggleMathConceptConfiguration() {
  mathConceptConfigurationMode.value = !mathConceptConfigurationMode.value
  nextTick(() => mathConceptViewRef.value?.fitView?.())
}

function mathConceptSiblings(parentId) {
  return mathConceptNodes.value
    .filter((node) => node.id !== 'matematicas' && node.parentId === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function applyMathConceptOrder(nodes) {
  nodes.forEach((node, index) => { node.order = index })
}

function newMathConceptId() {
  return globalThis.crypto?.randomUUID?.() || `concepto-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function addMathConcept(parentId) {
  const id = newMathConceptId()
  mathConceptNodes.value.push({ id, title: 'Nuevo concepto', parentId, order: mathConceptSiblings(parentId).length })
  persistMathConcepts()
}

function renameMathConcept({ id, title }) {
  const node = mathConceptNodes.value.find((item) => item.id === id)
  if (!node || !title.trim()) return
  node.title = title.trim()
  persistMathConcepts()
}

function reorderMathConcepts({ sourceId, targetId }) {
  const source = mathConceptNodes.value.find((node) => node.id === sourceId)
  const target = mathConceptNodes.value.find((node) => node.id === targetId)
  if (!source || !target || source.parentId !== target.parentId || source.id === target.id) return
  const siblings = mathConceptSiblings(source.parentId)
  const sourceIndex = siblings.findIndex((node) => node.id === sourceId)
  const targetIndex = siblings.findIndex((node) => node.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  ;[siblings[sourceIndex], siblings[targetIndex]] = [siblings[targetIndex], siblings[sourceIndex]]
  applyMathConceptOrder(siblings)
  persistMathConcepts()
}

function requestDeleteMathConcept(id) {
  const node = mathConceptNodes.value.find((item) => item.id === id)
  if (!node || node.id === 'matematicas') return
  const hasChildren = mathConceptNodes.value.some((item) => item.parentId === id)
  if (!hasChildren) {
    deleteMathConceptBranch(node)
    return
  }
  mathConceptDeleteTarget.value = node
  mathConceptDeleteDialog.value = true
}

function deleteMathConceptBranch(node = mathConceptDeleteTarget.value) {
  if (!node || node.id === 'matematicas') return
  const removedIds = new Set([node.id])
  let foundDescendants = true
  while (foundDescendants) {
    foundDescendants = false
    mathConceptNodes.value.forEach((item) => {
      if (!removedIds.has(item.id) && removedIds.has(item.parentId)) {
        removedIds.add(item.id)
        foundDescendants = true
      }
    })
  }
  mathConceptNodes.value = mathConceptNodes.value.filter((item) => !removedIds.has(item.id))
  applyMathConceptOrder(mathConceptSiblings(node.parentId))
  mathConceptDeleteDialog.value = false
  mathConceptDeleteTarget.value = null
  persistMathConcepts()
}

function deleteMathConceptKeepingChildren(node = mathConceptDeleteTarget.value) {
  if (!node || node.id === 'matematicas') return
  const parentId = node.parentId
  const siblings = mathConceptSiblings(parentId)
  const nodeIndex = siblings.findIndex((item) => item.id === node.id)
  const children = mathConceptSiblings(node.id)
  if (nodeIndex < 0 || !children.length) return

  children.forEach((child) => { child.parentId = parentId })
  const promotedSiblings = siblings.filter((item) => item.id !== node.id)
  promotedSiblings.splice(nodeIndex, 0, ...children)
  applyMathConceptOrder(promotedSiblings)
  mathConceptNodes.value = mathConceptNodes.value.filter((item) => item.id !== node.id)
  mathConceptDeleteDialog.value = false
  mathConceptDeleteTarget.value = null
  persistMathConcepts()
}

function groupMathConcepts({ parentId, nodeIds }) {
  const selectedIds = new Set(nodeIds)
  const siblings = mathConceptSiblings(parentId)
  const selected = siblings.filter((node) => selectedIds.has(node.id))
  if (selected.length < 2 || selected.length !== selectedIds.size) return

  const group = {
    id: newMathConceptId(),
    title: 'Nuevo concepto',
    parentId,
    order: Math.min(...selected.map((node) => node.order ?? 0)),
  }
  const firstSelectedIndex = siblings.findIndex((node) => selectedIds.has(node.id))
  const remainingSiblings = siblings.filter((node) => !selectedIds.has(node.id))
  remainingSiblings.splice(firstSelectedIndex, 0, group)
  applyMathConceptOrder(remainingSiblings)
  selected.forEach((node, index) => {
    node.parentId = group.id
    node.order = index
  })
  mathConceptNodes.value.push(group)
  persistMathConcepts()
}

async function loadTemplates() {
  isLoadingTemplates.value = true
  templatesError.value = ''
  try {
    const metadataSnapshot = await getDocs(collection(db, 'plantillas'))
    const savedTemplates = metadataSnapshot.docs
      .map((template) => ({ id: template.id, ...template.data() }))
    const metadataByFile = new Map(savedTemplates.map((template) => [template.archivo || preambleFileName(template.nombre), template]))
    const preamblesResponse = await compilerRequest('/preambles')
    const { preambles = [] } = await preamblesResponse.json()
    templates.value = await Promise.all(preambles.map(async (archivo) => {
      const contentResponse = await compilerRequest(`/preambles/${encodeURIComponent(archivo)}`)
      const { content } = await contentResponse.json()
      const metadata = metadataByFile.get(archivo)
      return {
        id: metadata?.id || archivo,
        archivo,
        nombre: metadata?.nombre || archivo.replace(/\.tex$/i, ''),
        descripcion: metadata?.descripcion || '',
        codigo: content,
      }
    }))
    templates.value.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    if (!selectedPreamble.value && templates.value.length) selectedPreamble.value = templates.value[0].archivo
  } catch (error) {
    templatesError.value = 'No se han podido cargar los preámbulos del compilador remoto.'
    console.error('Error al cargar plantillas remotas:', error)
  } finally {
    isLoadingTemplates.value = false
  }
}

function selectExercise(exercise) {
  selectedExerciseId.value = exercise.id
  exerciseView.value = 'search'
}

function destroyLatexEditor() {
  latexCodeEditor?.destroy()
  latexCodeEditor = null
}

function destroyTemplateEditor() {
  templateCodeEditor?.destroy()
  templateCodeEditor = null
}

function mountLatexEditor() {
  nextTick(() => {
    destroyLatexEditor()
    if (!latexEditorHost.value) return
    latexCodeEditor = new EditorView({
      state: EditorState.create({
        doc: activeExerciseCode.value,
        extensions: [
          basicSetup,
          latexEditorTheme,
          latexHighlighting,
          latex({ enableAutocomplete: false, autoCloseBrackets: true, autoCloseTags: true, enableTooltips: true }),
          autocompletion({ override: [latexCompletion] }),
          keymap.of([indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              activeExerciseVersion.value.enunciado = update.state.doc.toString()
              if (!hasExerciseSolutions(activeExerciseVersion.value.enunciado)) activeExerciseVersion.value.solucionIA = false
            }
          }),
        ],
      }),
      parent: latexEditorHost.value,
    })
  })
}

function mountTemplateEditor() {
  nextTick(() => {
    destroyTemplateEditor()
    if (!templateEditorHost.value) return
    templateCodeEditor = new EditorView({
      state: EditorState.create({
        doc: templateEditor.value.codigo,
        extensions: [
          basicSetup,
          latexEditorTheme,
          latexHighlighting,
          latex({ enableAutocomplete: false, autoCloseBrackets: true, autoCloseTags: true, enableTooltips: true }),
          autocompletion({ override: [templateLatexCompletion] }),
          keymap.of([indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) templateEditor.value.codigo = update.state.doc.toString()
          }),
        ],
      }),
      parent: templateEditorHost.value,
    })
  })
}

function openNewTemplate() {
  selectedTemplateId.value = null
  templateEditor.value = emptyTemplate()
  isEditingTemplate.value = true
  mountTemplateEditor()
}

function selectTemplate(template) {
  selectedTemplateId.value = template.id
  templateEditor.value = { ...template }
  isEditingTemplate.value = true
  mountTemplateEditor()
}

async function saveTemplate() {
  if (!templateEditor.value.nombre.trim() || !templateEditor.value.codigo.trim()) return
  isSavingTemplate.value = true
  templatesError.value = ''
  try {
    const reference = templateEditor.value.id
      ? doc(db, 'plantillas', templateEditor.value.id)
      : doc(collection(db, 'plantillas'))
    const archivo = templateEditor.value.archivo || preambleFileName(templateEditor.value.nombre)
    const data = {
      id: reference.id,
      archivo,
      nombre: templateEditor.value.nombre.trim(),
      descripcion: templateEditor.value.descripcion.trim(),
      codigo: templateEditor.value.codigo,
    }
    await compilerRequest('/preambles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: archivo, content: data.codigo }),
    })
    await setDoc(reference, data)
    const index = templates.value.findIndex((template) => template.id === reference.id)
    if (index === -1) templates.value.push(data)
    else templates.value[index] = data
    templates.value.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    selectedTemplateId.value = reference.id
    templateEditor.value = { ...data }
  } catch (error) {
    templatesError.value = 'No se ha podido guardar el preámbulo en el compilador remoto.'
    console.error('Error al guardar plantilla:', error)
  } finally {
    isSavingTemplate.value = false
  }
}

async function removeTemplate() {
  if (!selectedTemplate.value) return
  isSavingTemplate.value = true
  templatesError.value = ''
  try {
    await compilerRequest(`/preambles/${encodeURIComponent(selectedTemplate.value.archivo)}`, { method: 'DELETE' })
    await deleteDoc(doc(db, 'plantillas', selectedTemplate.value.id))
    templates.value = templates.value.filter((template) => template.id !== selectedTemplate.value.id)
    selectedTemplateId.value = null
    templateEditor.value = emptyTemplate()
    isEditingTemplate.value = false
    destroyTemplateEditor()
  } catch (error) {
    templatesError.value = 'No se ha podido eliminar la plantilla de Firestore.'
    console.error('Error al eliminar plantilla:', error)
  } finally {
    isSavingTemplate.value = false
  }
}

function openNewExercise() {
  selectedExerciseId.value = null
  exerciseEditor.value = emptyExercise()
  selectedExerciseVersion.value = 0
  compilerError.value = ''
  exercisePreviewTab.value = 'statement'
  exerciseView.value = 'edit'
  mountLatexEditor()
}

function editExercise(exercise = selectedExercise.value) {
  if (!exercise) return
  exerciseEditor.value = normalizeExercise({
    id: exercise.id,
    enunciado: exercise.enunciado,
    tags: [...exercise.tags],
    pdf: exercise.pdf,
    variaciones: exercise.variaciones,
  })
  selectedExerciseVersion.value = 0
  compilerError.value = ''
  exercisePreviewTab.value = 'statement'
  exerciseView.value = 'edit'
  mountLatexEditor()
}

function cancelExerciseEdit() {
  destroyLatexEditor()
  clearExercisePreviews()
  exerciseView.value = 'search'
  exerciseEditor.value = emptyExercise()
  selectedExerciseVersion.value = 0
}

function selectExerciseVersion(version) {
  if (version === null || version < 0 || version > exerciseEditor.value.variaciones.length) return
  selectedExerciseVersion.value = version
  exercisePreviewTab.value = compiledSolutionPdfUrl.value && exercisePreviewTab.value === 'solution' ? 'solution' : 'statement'
  compilerError.value = ''
  mountLatexEditor()
}

function deleteSelectedVariation() {
  const index = selectedExerciseVersion.value - 1
  if (index < 0 || index >= exerciseEditor.value.variaciones.length) return
  const [deletedVariation] = exerciseEditor.value.variaciones.splice(index, 1)
  clearVersionPreview(deletedVariation)
  selectedExerciseVersion.value = 0
  exercisePreviewTab.value = 'statement'
  compilerError.value = ''
  mountLatexEditor()
}

async function generateOriginalExerciseSolution() {
  if (selectedExerciseVersion.value !== 0 || isGeneratingSolution.value || hasExerciseSolutions(activeExerciseCode.value)) return
  if (!isAppCheckConfigured) {
    exercisesError.value = 'App Check no está configurado en este entorno. Añade VITE_FIREBASE_APP_CHECK_KEY y registra el token de depuración de localhost en Firebase.'
    return
  }

  isGeneratingSolution.value = true
  exercisesError.value = ''
  try {
    const generateSolution = httpsCallable(functions, 'generateExerciseSolution', { timeout: 120_000 })
    const sourceExercise = activeExerciseCode.value
    const preambleName = exercisePreambleName()
    let previousAttempt = ''
    let compileError = ''
    let solvedExercise = ''
    let statementPdf
    let solutionPdf

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await generateSolution({
        enunciado: sourceExercise,
        model: selectedAiModel.value,
        previousAttempt,
        compileError,
      })
      const candidate = removeBlankLinesInsideAligned(response.data?.enunciado?.trim() || '')
      if (!candidate) throw new Error('La IA no ha devuelto un ejercicio resuelto válido.')

      try {
        solutionPdf = await compilePdfBlob(candidate, preambleName)
        statementPdf = await compilePdfBlob(statementLatex(candidate), preambleName)
        solvedExercise = candidate
        break
      } catch (error) {
        previousAttempt = candidate
        compileError = compileErrorWithSourceContext(candidate, preambleName, error)
      }
    }

    if (!solvedExercise || !statementPdf || !solutionPdf) {
      throw new Error(`La IA ha generado LaTeX no compilable tras tres intentos. ${compileError}`)
    }

    activeExerciseVersion.value.enunciado = solvedExercise
    activeExerciseVersion.value.solucionIA = true
    setActivePreviewPdf('enunciado', URL.createObjectURL(statementPdf))
    setActivePreviewPdf('resuelto', URL.createObjectURL(solutionPdf))
    mountLatexEditor()
    exercisePreviewTab.value = 'solution'
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido generar la solución con IA.'
    console.error('Error al generar solución:', error)
  } finally {
    isGeneratingSolution.value = false
  }
}

async function deleteOriginalExerciseSolution() {
  if (selectedExerciseVersion.value !== 0 || !hasExerciseSolutions(exerciseEditor.value.enunciado) || isDeletingSolution.value) return

  isDeletingSolution.value = true
  exercisesError.value = ''
  try {
    const codeWithoutSolution = statementLatex(exerciseEditor.value.enunciado)
    const exerciseId = exerciseEditor.value.id
    const pdf = { ...exerciseEditor.value.pdf, resuelto: null }

    if (exerciseId) {
      const solutionReference = storageRef(storage, `ejercicios/${exerciseId}/resuelto_${exerciseId}.pdf`)
      try {
        await deleteObject(solutionReference)
      } catch (error) {
        if (error?.code !== 'storage/object-not-found') throw error
      }
      await setDoc(doc(db, 'ejercicios', exerciseId), {
        enunciado: codeWithoutSolution,
        solucionIA: false,
        pdf,
      }, { merge: true })
    }

    exerciseEditor.value.enunciado = codeWithoutSolution
    exerciseEditor.value.solucionIA = false
    exerciseEditor.value.pdf = pdf
    exerciseEditor.value.renderedLatex = codeWithoutSolution
    setActivePreviewPdf('resuelto', null)
    exercisePreviewTab.value = 'statement'
    compilerError.value = ''
    mountLatexEditor()

    if (exerciseId) {
      const index = exercises.value.findIndex((exercise) => exercise.id === exerciseId)
      if (index !== -1) exercises.value[index] = normalizeExercise({ ...exercises.value[index], enunciado: codeWithoutSolution, solucionIA: false, pdf })
    }
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido eliminar la solución.'
    console.error('Error al eliminar solución:', error)
  } finally {
    isDeletingSolution.value = false
  }
}

async function addExerciseVariation(experimental = false) {
  const original = exerciseEditor.value.enunciado.trim()
  if (!original || isGeneratingVariation.value) return
  if (!isAppCheckConfigured) {
    exercisesError.value = 'App Check no está configurado en este entorno. Añade VITE_FIREBASE_APP_CHECK_KEY y registra el token de depuración de localhost en Firebase.'
    return
  }
  isGeneratingVariation.value = true
  const startedAt = Date.now()
  let progressPhase = experimental ? 'Analizando ejercicio' : 'Generando'
  const updateProgressText = () => {
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
    variationProgressText.value = `${progressPhase} · ${elapsedSeconds} s`
  }
  updateProgressText()
  const progressTimer = window.setInterval(updateProgressText, 1_000)
  exercisesError.value = ''
  try {
    const generateVariation = httpsCallable(functions, 'generateExerciseVariation', { timeout: 120_000 })
    const response = await generateVariation({
      enunciado: original,
      tags: exerciseEditor.value.tags,
      variaciones: exerciseEditor.value.variaciones.map((variation) => variation.enunciado),
      model: selectedAiModel.value,
      experimental,
    })
    progressPhase = experimental ? 'Aplicando estrategia' : 'Preparando variante'
    updateProgressText()
    const enunciado = response.data?.enunciado?.trim()
    if (!enunciado) throw new Error('La IA no ha devuelto un ejercicio válido.')
    exerciseEditor.value.variaciones.push(normalizeVariation({
      enunciado,
      modelo: response.data?.model || selectedAiModel.value,
    }))
    selectExerciseVersion(exerciseEditor.value.variaciones.length)
    progressPhase = 'Compilando PDF'
    updateProgressText()
    await compileExercisePreviews(enunciado, exercisePreambleName())
  } catch (error) {
    const isAppCheckError = error.code === 'functions/unauthenticated'
      || error.code === 'functions/failed-precondition'
    exercisesError.value = isAppCheckError
      ? 'Firebase ha rechazado la llamada de App Check. Registra el token de depuración de localhost en la consola de Firebase y vuelve a intentarlo.'
      : error.message || 'No se ha podido generar la variación con IA.'
    console.error('Error al generar variación:', error)
  } finally {
    window.clearInterval(progressTimer)
    isGeneratingVariation.value = false
    variationProgressText.value = ''
  }
}

async function compilePdfBlob(code, preambleName) {
  const response = await compilerRequest('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeForPreamble(removeBlankLinesInsideAligned(code)), preamble_name: preambleName }),
  })
  return response.blob()
}

async function compileExercisePreviews(code, preambleName = selectedPreamble.value) {
  if (!preambleName) {
    compilerError.value = 'Selecciona una plantilla antes de compilar.'
    return
  }
  isCompiling.value = true
  compilerError.value = ''
  try {
    const statementPdf = await compilePdfBlob(statementLatex(code), preambleName)
    setActivePreviewPdf('enunciado', URL.createObjectURL(statementPdf))

    if (hasExerciseSolutions(code)) {
      const solutionPdf = await compilePdfBlob(code, preambleName)
      setActivePreviewPdf('resuelto', URL.createObjectURL(solutionPdf))
    } else {
      setActivePreviewPdf('resuelto', null)
      exercisePreviewTab.value = 'statement'
    }
    activeExerciseVersion.value.renderedLatex = code
  } catch (error) {
    compilerError.value = error.message || 'No se ha podido compilar el documento LaTeX.'
  } finally {
    isCompiling.value = false
  }
}

function refreshLatexRender() {
  exercisePreviewTab.value = 'statement'
  return compileExercisePreviews(activeExerciseCode.value, exercisePreambleName())
}

async function uploadExercisePdf(exerciseId, pdf, documentType, variationNumber = null) {
  const fileSuffix = variationNumber === null ? exerciseId : `${exerciseId}_${variationNumber}`
  const folder = variationNumber === null ? '' : `variaciones/${variationNumber}/`
  const path = `ejercicios/${exerciseId}/${folder}${documentType}_${fileSuffix}.pdf`
  const reference = storageRef(storage, path)
  await uploadBytes(reference, pdf, {
    contentType: 'application/pdf',
    customMetadata: { exerciseId, documentType },
  })
  return getDownloadURL(reference)
}

async function compileAndUploadExerciseVersion(exerciseId, code, variationNumber = null) {
  const preambleName = exercisePreambleName()
  const statementPdf = await compilePdfBlob(statementLatex(code), preambleName)
  const statementPdfUrl = await uploadExercisePdf(exerciseId, statementPdf, 'enunciado', variationNumber)
  let solutionPdfUrl = null
  if (hasExerciseSolutions(code)) {
    const solutionPdf = await compilePdfBlob(code, preambleName)
    solutionPdfUrl = await uploadExercisePdf(exerciseId, solutionPdf, 'resuelto', variationNumber)
  }
  return { enunciado: statementPdfUrl, resuelto: solutionPdfUrl }
}

async function saveExercise() {
  if (!exerciseEditor.value.enunciado.trim()) return
  isSavingExercise.value = true
  exercisesError.value = ''
  try {
    const reference = exerciseEditor.value.id
      ? doc(db, 'ejercicios', exerciseEditor.value.id)
      : doc(collection(db, 'ejercicios'))
    const previousSnapshot = await getDoc(reference)
    const previousData = previousSnapshot.exists() ? previousSnapshot.data() : {}
    const code = exerciseEditor.value.enunciado
    const pdf = await compileAndUploadExerciseVersion(reference.id, code)
    const variaciones = []
    for (const [index, variation] of exerciseEditor.value.variaciones.entries()) {
      if (!variation.enunciado.trim()) continue
      const variationPdf = await compileAndUploadExerciseVersion(reference.id, variation.enunciado, index + 1)
      variaciones.push({ enunciado: variation.enunciado, modelo: variation.modelo || null, pdf: variationPdf })
    }
    const data = {
      id: reference.id,
      enunciado: code,
      tags: tagsToObject(exerciseEditor.value.tags),
      pdf,
      solucionIA: Boolean(exerciseEditor.value.solucionIA),
      variaciones,
    }
    await setDoc(reference, data, { merge: true })
    const savedExercise = normalizeExercise({ ...previousData, ...data })
    const index = exercises.value.findIndex((exercise) => exercise.id === reference.id)
    if (index === -1) exercises.value.push(savedExercise)
    else exercises.value[index] = savedExercise
    exercises.value.sort((a, b) => a.id.localeCompare(b.id))
    selectedExerciseId.value = reference.id
    destroyLatexEditor()
    clearExercisePreviews()
    exerciseEditor.value = emptyExercise()
    selectedExerciseVersion.value = 0
    exerciseView.value = 'search'
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido compilar y guardar el ejercicio.'
    console.error('Error al guardar ejercicio:', error)
  } finally {
    isSavingExercise.value = false
  }
}

function createGroupId() {
  return globalThis.crypto?.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function currentAcademicYear() {
  const today = new Date()
  const startYear = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1
  return `${startYear}-${startYear + 1}`
}

function serializeSchedule(blocks) {
  const coursesByYear = new Map()

  blocks.forEach((block) => {
    const year = currentAcademicYear()
    if (!coursesByYear.has(year)) coursesByYear.set(year, new Map())
    const groups = coursesByYear.get(year)
    const groupKey = block.groupId || [block.course, block.subject, block.classroom, block.color].join('|')
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: groupKey,
        nombre: block.course,
        asignatura: block.subject,
        aula: block.classroom,
        color: block.color,
        horario: [],
      })
    }
    groups.get(groupKey).horario.push({ dia: block.dayIndex, tramo: block.moduleIndex })
  })

  return {
    carrera: {
      cursos: [...coursesByYear.entries()].map(([year, groups]) => ({
        year,
        grupos: [...groups.values()],
      })),
    },
  }
}

function deserializeSchedule(data) {
  return (data?.carrera?.cursos || []).flatMap((course) =>
    (course.grupos || []).flatMap((group) =>
      (group.horario || []).map((segment) => {
        const legacyGroupId = [group.nombre, group.asignatura, group.aula, group.color].join('|')
        return {
          groupId: group.id || legacyGroupId,
          course: group.nombre,
          subject: group.asignatura || '',
          classroom: group.aula || '',
          color: group.color,
          dayIndex: segment.dia,
          moduleIndex: segment.tramo,
        }
      }),
    ),
  )
}

async function loadTeacherSchedule() {
  firestoreError.value = ''
  try {
    const snapshot = await getDoc(teacherDocument)
    if (snapshot.exists()) {
      scheduleBlocks.value = deserializeSchedule(snapshot.data())
    } else {
      await setDoc(teacherDocument, { carrera: { cursos: [] } })
    }
  } catch (error) {
    firestoreError.value = 'No se ha podido cargar el horario de Firestore.'
    console.error('Error al cargar teachers/test:', error)
  }
}

function uniqueScheduleValues(field) {
  return [...new Set(scheduleBlocks.value.map((block) => block[field]).filter(Boolean))]
}

function scheduleBlock(dayIndex, moduleIndex) {
  return scheduleBlocks.value.find((block) => block.dayIndex === dayIndex && block.moduleIndex === moduleIndex)
}

function openScheduleDialog(dayIndex, moduleIndex) {
  if (!scheduleConfigMode.value) return
  selectedSlot.value = { dayIndex, moduleIndex }
  const currentBlock = scheduleBlock(dayIndex, moduleIndex)
  scheduleForm.value = currentBlock
    ? {
        groupId: currentBlock.groupId,
        course: currentBlock.course,
        subject: currentBlock.subject,
        classroom: currentBlock.classroom,
        color: currentBlock.color,
      }
    : emptyScheduleForm()
  selectedSchedulePreset.value = null
  scheduleDialog.value = true
}

async function applySchedulePreset(preset) {
  if (!preset) return
  scheduleForm.value = {
    groupId: preset.groupId,
    course: preset.course,
    subject: preset.subject,
    classroom: preset.classroom,
    color: preset.color,
  }
  await saveScheduleBlock()
}

async function saveScheduleBlock() {
  if (!scheduleForm.value.course || !scheduleForm.value.color) return
  const slot = selectedSlot.value
  const currentBlock = scheduleBlock(slot.dayIndex, slot.moduleIndex)
  const groupId = currentBlock?.groupId || scheduleForm.value.groupId || createGroupId()
  const block = { ...scheduleForm.value, groupId, ...slot }
  const previousBlocks = [...scheduleBlocks.value]
  const existingIndex = scheduleBlocks.value.findIndex((item) => item.dayIndex === slot.dayIndex && item.moduleIndex === slot.moduleIndex)
  if (existingIndex === -1) {
    scheduleBlocks.value.push(block)
  } else {
    scheduleBlocks.value = scheduleBlocks.value.map((item) => (item.groupId === groupId ? { ...item, ...scheduleForm.value, groupId } : item))
  }
  isSavingSchedule.value = true
  firestoreError.value = ''
  try {
    await setDoc(teacherDocument, serializeSchedule(scheduleBlocks.value))
    scheduleDialog.value = false
  } catch (error) {
    scheduleBlocks.value = previousBlocks
    firestoreError.value = 'No se ha podido guardar el horario en Firestore.'
    console.error('Error al guardar teachers/test:', error)
  } finally {
    isSavingSchedule.value = false
  }
}

async function clearScheduleBlock() {
  if (!selectedSlot.value || !hasSelectedScheduleBlock.value) return
  const previousBlocks = [...scheduleBlocks.value]
  const { dayIndex, moduleIndex } = selectedSlot.value
  scheduleBlocks.value = scheduleBlocks.value.filter((block) => block.dayIndex !== dayIndex || block.moduleIndex !== moduleIndex)
  isSavingSchedule.value = true
  firestoreError.value = ''
  try {
    await setDoc(teacherDocument, serializeSchedule(scheduleBlocks.value))
    scheduleDialog.value = false
  } catch (error) {
    scheduleBlocks.value = previousBlocks
    firestoreError.value = 'No se ha podido eliminar el segmento en Firestore.'
    console.error('Error al eliminar un segmento de teachers/test:', error)
  } finally {
    isSavingSchedule.value = false
  }
}

function changeMonth(offset) {
  if (calendarMode.value === 'year') {
    shownMonth.value = new Date(shownMonth.value.getFullYear() + offset, shownMonth.value.getMonth(), 1)
    return
  }
  if (calendarMode.value === 'week') {
    shownMonth.value = new Date(shownMonth.value.getFullYear(), shownMonth.value.getMonth(), shownMonth.value.getDate() + offset * 7)
    return
  }
  shownMonth.value = new Date(shownMonth.value.getFullYear(), shownMonth.value.getMonth() + offset, 1)
}

function setCalendarMode(mode) {
  calendarMode.value = mode
  if (mode !== 'week') scheduleConfigMode.value = false
}

function isToday(day) {
  if (!day) return false
  const today = new Date()
  return day === today.getDate() && shownMonth.value.getMonth() === today.getMonth() && shownMonth.value.getFullYear() === today.getFullYear()
}

function isTodayDate(date) {
  const today = new Date()
  return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function currentTimePosition(date, module) {
  const now = currentTime.value
  if (date.getDate() !== now.getDate() || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return null
  const nowInMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const start = timeToMinutes(module.start)
  const end = timeToMinutes(module.end)
  if (nowInMinutes < start || nowInMinutes > end) return null
  return `${((nowInMinutes - start) / (end - start)) * 100}%`
}

const navigation = [
  { title: 'Matemáticas', icon: 'mdi-function-variant' },
  { title: 'Ejercicios', icon: 'mdi-pencil-ruler' },
  { title: 'Documentos', icon: 'mdi-file-document-outline' },
  { title: 'Plantillas', icon: 'mdi-content-duplicate' },
]

const groups = computed(() => {
  const completeGroups = new Map()
  scheduleBlocks.value
    .filter((block) => block.course && block.subject)
    .forEach((block) => {
      const key = `${block.course}|${block.subject}`
      if (!completeGroups.has(key)) {
        completeGroups.set(key, {
          title: block.course,
          subtitle: block.subject,
          icon: 'mdi-function-variant',
        })
      }
    })
  return [...completeGroups.values()]
})

function fitMathConceptView() {
  nextTick(() => mathConceptViewRef.value?.fitView?.())
}

let currentTimeInterval
onMounted(() => {
  loadTeacherSchedule()
  loadExercises()
  loadMathConcepts()
  loadTemplates()
  currentTimeInterval = window.setInterval(() => { currentTime.value = new Date() }, 30_000)
})

onBeforeUnmount(() => {
  window.clearInterval(currentTimeInterval)
  destroyLatexEditor()
  destroyTemplateEditor()
  clearExercisePreviews()
})

</script>

<template>
  <v-app>
    <v-navigation-drawer
      v-model="drawer"
      :permanent="$vuetify.display.mdAndUp"
      :temporary="$vuetify.display.smAndDown"
      width="272"
      class="neope-drawer"
    >
      <div class="drawer-brand">
        <img src="/brand/neope-logo.png" alt="Neope" />
      </div>

      <v-list nav density="comfortable" class="navigation-list">
        <v-list-item
          v-for="item in navigation"
          :key="item.title"
          :prepend-icon="item.icon"
          :title="item.title"
          :active="active === item.title"
          color="primary"
          @click="active = item.title"
        />
      </v-list>

      <v-divider class="mx-5 my-3" />

      <v-list nav density="comfortable" class="navigation-list groups-list">
        <v-list-subheader>GRUPOS</v-list-subheader>
        <v-list-item
          v-for="group in groups"
          :key="`${group.title}-${group.subtitle}`"
          :prepend-icon="group.icon"
          :title="group.title"
          :subtitle="group.subtitle"
          :active="active === group.title"
          color="primary"
          @click="active = group.title"
        >
          <template v-if="group.tutor" #append>
            <v-tooltip text="Mi tutoría" location="end">
              <template #activator="{ props }"><v-icon v-bind="props" icon="mdi-star-circle-outline" size="18" color="primary" /></template>
            </v-tooltip>
          </template>
        </v-list-item>
      </v-list>

      <template #append>
        <div class="drawer-footer">
          <v-btn variant="text" prepend-icon="mdi-cog-outline" block justify="start">Ajustes</v-btn>
          <v-divider class="my-3" />
          <v-list-item prepend-avatar="/brand/carlos-sanchez-catala.png" title="Carlos Sánchez Catalá" subtitle="Profesor" />
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar flat class="app-bar" height="76">
      <v-btn icon="mdi-menu" variant="text" class="d-md-none" aria-label="Abrir menú" @click="drawer = !drawer" />
      <template v-if="active === 'Ejercicios' && exerciseView === 'edit'">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" class="app-toolbar-back" @click="cancelExerciseEdit">Volver</v-btn>
        <v-spacer />
        <v-btn-toggle
          :model-value="selectedExerciseVersion"
          mandatory
          density="compact"
          class="exercise-version-selector"
          aria-label="Variación del ejercicio"
          @update:model-value="selectExerciseVersion"
        >
          <v-btn :value="0" aria-label="Ejercicio original">0</v-btn>
          <v-btn
            v-for="(variation, index) in exerciseEditor.variaciones"
            :key="index"
            :value="index + 1"
            :aria-label="`Variación ${index + 1}`"
            :title="variation.modelo ? `Generada con ${variation.modelo}` : `Variación ${index + 1}`"
          >{{ index + 1 }}</v-btn>
        </v-btn-toggle>
        <v-tooltip text="Generar una variación con IA" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              color="primary"
              variant="flat"
              :prepend-icon="isGeneratingVariation ? undefined : 'mdi-dice-multiple'"
              class="exercise-add-variation app-toolbar-primary-action"
              :disabled="!exerciseEditor.enunciado.trim() || isSavingExercise"
              @click="addExerciseVariation"
            >
              <template v-if="isGeneratingVariation">
                <v-progress-circular indeterminate :size="16" :width="2" />
                <span class="exercise-variation-progress" role="status" aria-live="polite">{{ variationProgressText }}</span>
              </template>
              <template v-else>Añadir variante</template>
            </v-btn>
          </template>
        </v-tooltip>
        <v-tooltip text="Generar variación experimental con análisis didáctico" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-flask-outline"
              variant="tonal"
              color="secondary"
              rounded="circle"
              aria-label="Generar variación experimental"
              class="mx-2"
              :disabled="!exerciseEditor.enunciado.trim() || isSavingExercise || isGeneratingVariation"
              @click="addExerciseVariation(true)"
            />
          </template>
        </v-tooltip>
        <v-select
          v-model="selectedAiModel"
          :items="aiModelOptions"
          item-title="title"
          item-value="value"
          aria-label="Modelo de inteligencia artificial"
          prepend-inner-icon="mdi-brain"
          variant="outlined"
          density="compact"
          rounded="pill"
          single-line
          hide-details
          :disabled="isGeneratingVariation || isSavingExercise"
          class="exercise-ai-model"
        >
          <template #item="{ props, item }">
            <v-list-item v-bind="props" :subtitle="item.raw.subtitle" />
          </template>
        </v-select>
        <v-spacer />
        <v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" class="app-toolbar-primary-action mr-3" :disabled="!exerciseEditor.enunciado.trim()" :loading="isSavingExercise" @click="saveExercise">Guardar</v-btn>
      </template>
      <template v-else-if="active === 'Matemáticas'">
        <v-tooltip :text="mathConceptConfigurationMode ? 'Salir de la configuración' : 'Configurar mapa de contenidos'" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-cog-outline"
              rounded="circle"
              :color="mathConceptConfigurationMode ? 'primary' : undefined"
              :variant="mathConceptConfigurationMode ? 'tonal' : 'text'"
              :aria-label="mathConceptConfigurationMode ? 'Salir de la configuración' : 'Configurar mapa de contenidos'"
              class="ml-2"
              :disabled="isSavingMathConcepts"
              @click="toggleMathConceptConfiguration"
            />
          </template>
        </v-tooltip>
        <v-spacer />
        <v-tooltip text="Centrar y encajar el mapa" location="bottom">
          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-fit-to-screen-outline" variant="text" aria-label="Centrar y encajar el mapa" @click="fitMathConceptView" /></template>
        </v-tooltip>
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="active = 'Calendario'" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
        <v-btn icon="mdi-account-circle-outline" variant="text" aria-label="Perfil" class="mr-2" />
      </template>
      <template v-else-if="active === 'Plantillas'">
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action ml-2" @click="openNewTemplate">Nueva plantilla</v-btn>
        <v-spacer />
        <v-btn v-if="selectedTemplate" color="error" variant="text" prepend-icon="mdi-delete-outline" :loading="isSavingTemplate" @click="removeTemplate">Eliminar</v-btn>
        <v-btn v-if="isEditingTemplate" color="primary" variant="flat" prepend-icon="mdi-content-save-outline" class="app-toolbar-primary-action mr-3 ml-2" :disabled="!templateEditor.nombre.trim() || !templateEditor.codigo.trim()" :loading="isSavingTemplate" @click="saveTemplate">Guardar</v-btn>
      </template>
      <template v-else-if="active === 'Calendario'">
        <v-tooltip :text="calendarMode === 'week' ? 'Configurar horario semanal' : 'Configuración disponible en la vista semanal'" location="bottom">
          <template #activator="{ props }">
            <span v-bind="props" class="calendar-config-control"><v-btn icon="mdi-cog-outline" :disabled="calendarMode !== 'week'" :color="scheduleConfigMode ? 'primary' : undefined" :variant="scheduleConfigMode ? 'tonal' : 'text'" aria-label="Configurar horario semanal" @click="scheduleConfigMode = !scheduleConfigMode" /></span>
          </template>
        </v-tooltip>
        <v-btn icon="mdi-chevron-left" variant="text" aria-label="Periodo anterior" @click="changeMonth(-1)" />
        <div class="calendar-toolbar-title">{{ calendarTitle }}</div>
        <v-btn icon="mdi-chevron-right" variant="text" aria-label="Periodo siguiente" @click="changeMonth(1)" />
        <v-spacer />
        <v-btn-toggle :model-value="calendarMode" mandatory density="compact" class="calendar-toolbar-modes" aria-label="Modo de calendario" @update:model-value="setCalendarMode">
          <v-btn value="week">Semana</v-btn>
          <v-btn value="month">Mes</v-btn>
          <v-btn value="year">Curso</v-btn>
        </v-btn-toggle>
        <v-spacer />
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" disabled icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
        <v-btn icon="mdi-account-circle-outline" variant="text" aria-label="Perfil" class="mr-2" />
      </template>
      <template v-else>
        <v-toolbar-title v-if="active !== 'Ejercicios' && active !== 'Matemáticas'" class="page-title">{{ active }}</v-toolbar-title>
        <v-text-field
          v-if="active === 'Ejercicios'"
          v-model="exerciseSearchQuery"
          aria-label="Buscar ejercicios por texto o etiquetas"
          placeholder="Buscar por texto o etiquetas"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          rounded="pill"
          clearable
          hide-details
          class="app-toolbar-search"
        />
        <v-spacer v-if="active === 'Ejercicios'" />
        <v-btn v-if="active === 'Ejercicios'" color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action app-toolbar-new-exercise mr-2" @click="openNewExercise">Nuevo ejercicio</v-btn>
        <v-spacer v-if="active === 'Ejercicios'" />
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="active = 'Calendario'" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
        <v-btn icon="mdi-account-circle-outline" variant="text" aria-label="Perfil" class="mr-2" />
      </template>
    </v-app-bar>

    <v-main>
      <div class="page-shell" :class="{ 'page-shell-mathematics': active === 'Matemáticas', 'page-shell-exercise-search': active === 'Ejercicios' && exerciseView === 'search', 'page-shell-exercise-edit': active === 'Ejercicios' && exerciseView === 'edit', 'page-shell-templates': active === 'Plantillas', 'page-shell-calendar': active === 'Calendario' }">
        <section v-if="active === 'Matemáticas'" class="mathematics-page">
          <v-alert v-if="mathConceptsError" type="error" variant="tonal" density="compact" class="math-concepts-error">{{ mathConceptsError }}</v-alert>
          <div v-if="isLoadingMathConcepts" class="math-concepts-loading"><v-progress-circular indeterminate color="primary" /><span>Cargando mapa de conceptos…</span></div>
          <MathConceptMap
            v-else
            ref="mathConceptViewRef"
            :nodes="mathConceptNodes"
            :configuration-mode="mathConceptConfigurationMode"
            :active-subject-id="activeMathSubjectId"
            :subject-node-ids="activeMathSubjectNodeIds"
            :disabled="isSavingMathConcepts"
            @add-node="addMathConcept"
            @rename-node="renameMathConcept"
            @delete-node="requestDeleteMathConcept"
            @reorder-nodes="reorderMathConcepts"
            @group-nodes="groupMathConcepts"
            @select-subject="selectMathSubject"
            @update-subject-node-ids="updateMathSubjectNodeIds"
          />
        </section>
        <section v-else-if="active === 'Ejercicios'" class="exercises-page">
          <v-alert v-if="exercisesError && exerciseView === 'search'" type="error" variant="tonal" density="compact" class="mb-5">{{ exercisesError }}</v-alert>
          <template v-if="exerciseView === 'search'">
            <div v-if="isLoadingExercises" class="exercise-grid-empty"><v-progress-circular indeterminate color="primary" /><span>Cargando ejercicios…</span></div>
            <MasonryGrid v-else-if="filteredExercises.length" :items="filteredExercises" :item-key="(exercise) => exercise.id" class="exercise-results-grid">
              <template #default="{ item: exercise }">
                <v-card class="exercise-result-card" elevation="1">
                  <div class="exercise-result-pdf">
                    <ExercisePdfPreview v-if="exercise.pdf?.enunciado" :src="exercise.pdf.enunciado" :title="`PDF del ejercicio ${exercise.id}`" />
                    <div v-else class="exercise-result-no-pdf"><v-icon icon="mdi-file-pdf-box" size="38" /><span>PDF pendiente</span></div>
                    <v-tooltip text="Editar ejercicio" location="top">
                      <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-pencil-outline" size="small" color="primary" class="exercise-card-edit" aria-label="Editar ejercicio" @click="editExercise(exercise)" /></template>
                    </v-tooltip>
                  </div>
                  <v-divider />
                  <v-card-text class="exercise-result-details">
                    <div class="exercise-result-meta">
                      <v-chip size="x-small" variant="tonal" color="primary" prepend-icon="mdi-dice-multiple-outline" :title="`${exercise.variaciones.length} variantes IA`">
                        {{ exercise.variaciones.length }} {{ exercise.variaciones.length === 1 ? 'variante' : 'variantes' }}
                      </v-chip>
                      <v-chip
                        size="x-small"
                        variant="tonal"
                        :color="exerciseSolutionBadge(exercise).color"
                        :prepend-icon="exerciseSolutionBadge(exercise).icon"
                      >{{ exerciseSolutionBadge(exercise).label }}</v-chip>
                    </div>
                    <div class="exercise-result-tags">
                      <v-chip v-for="tag in exercise.tags" :key="tag" :title="tag" size="x-small" color="primary" variant="tonal">{{ displayTag(tag) }}</v-chip>
                      <span v-if="!exercise.tags.length" class="exercise-no-tags">Sin etiquetas</span>
                    </div>
                  </v-card-text>
                </v-card>
              </template>
            </MasonryGrid>
            <div v-else class="exercise-grid-empty"><v-icon icon="mdi-file-search-outline" size="42" /><span>No hay ejercicios que coincidan con los filtros.</span></div>
          </template>

          <template v-else>
            <div class="exercise-edit-workspace">
              <section class="exercise-editor-pane" aria-label="Editor LaTeX del ejercicio">
                <v-alert v-if="exercisesError" type="error" variant="tonal" density="compact" class="exercise-edit-error">{{ exercisesError }}</v-alert>
                <div ref="latexEditorHost" class="latex-editor-shell exercise-editor-shell" />
                <div class="exercise-editor-tags">
                  <v-combobox v-model="exerciseEditor.tags" :items="availableExerciseTags" label="Etiquetas" placeholder="Añadir etiqueta" multiple chips closable-chips density="compact" variant="outlined" hide-details />
                </div>
              </section>
              <section class="exercise-preview-pane" aria-label="PDF compilado del ejercicio">
                <div class="exercise-preview-toolbar">
                  <v-tabs v-model="exercisePreviewTab" density="compact">
                    <v-tab value="statement">Enunciado</v-tab>
                    <v-tab value="solution" :disabled="!compiledSolutionPdfUrl">Resuelto</v-tab>
                  </v-tabs>
                  <div class="exercise-preview-variation-actions">
                    <v-tooltip v-if="selectedExerciseVersion === 0" text="Generar solución" location="bottom">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-lightbulb-on-outline" size="small" variant="tonal" color="primary" rounded="circle" aria-label="Generar solución" :disabled="hasExerciseSolutions(activeExerciseCode)" :loading="isGeneratingSolution" @click="generateOriginalExerciseSolution" />
                      </template>
                    </v-tooltip>
                    <v-tooltip v-if="selectedExerciseVersion === 0 && hasExerciseSolutions(activeExerciseCode)" text="Eliminar solución" location="bottom">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-lightbulb-off-outline" size="small" variant="tonal" color="error" rounded="circle" aria-label="Eliminar solución" :disabled="isGeneratingSolution" :loading="isDeletingSolution" @click="deleteOriginalExerciseSolution" />
                      </template>
                    </v-tooltip>
                    <v-tooltip v-if="selectedExerciseVersion > 0" text="Eliminar variante" location="bottom">
                      <template #activator="{ props }">
                        <v-btn v-bind="props" icon="mdi-delete-outline" size="small" variant="tonal" color="error" rounded="circle" aria-label="Eliminar variante" :disabled="isGeneratingSolution" @click="deleteSelectedVariation" />
                      </template>
                    </v-tooltip>
                  </div>
                  <v-tooltip text="Compilar vista previa" location="bottom">
                    <template #activator="{ props }">
                      <v-btn v-bind="props" icon="mdi-refresh" variant="text" color="primary" class="exercise-preview-compile" aria-label="Compilar vista previa" :disabled="!activeExerciseCode.trim()" :loading="isCompiling" @click="refreshLatexRender" />
                    </template>
                  </v-tooltip>
                </div>
                <v-alert v-if="compilerError" type="error" variant="tonal" density="compact" class="exercise-preview-error">{{ compilerError }}</v-alert>
                <div class="exercise-preview-document">
                  <ExercisePdfPreview v-if="activeExercisePdfUrl" :src="activeExercisePdfUrl" :title="exercisePreviewTab === 'statement' ? 'PDF del enunciado' : 'PDF del ejercicio resuelto'" />
                  <div v-else class="exercise-preview-empty">
                    <v-icon :icon="exercisePreviewTab === 'statement' ? 'mdi-file-pdf-box' : 'mdi-file-check-outline'" size="46" color="primary" />
                    <p>{{ exercisePreviewTab === 'statement' ? 'Todavía no hay una vista previa compilada.' : 'Este ejercicio todavía no tiene un PDF resuelto.' }}</p>
                    <v-btn v-if="exercisePreviewTab === 'statement'" color="primary" variant="tonal" prepend-icon="mdi-refresh" :disabled="!activeExerciseCode.trim()" :loading="isCompiling" @click="refreshLatexRender">Compilar</v-btn>
                  </div>
                </div>
              </section>
            </div>
          </template>
        </section>

        <section v-else-if="active === 'Plantillas'" class="templates-page">
          <div class="templates-workspace">
            <aside class="template-list-pane" aria-label="Plantillas disponibles">
              <v-list v-if="!isLoadingTemplates && templates.length" nav density="comfortable" class="templates-list">
                <v-list-item v-for="template in templates" :key="template.id" :active="selectedTemplateId === template.id" color="primary" @click="selectTemplate(template)">
                  <v-list-item-title>{{ template.nombre }}</v-list-item-title>
                  <v-list-item-subtitle>{{ template.descripcion || 'Sin descripción' }}</v-list-item-subtitle>
                </v-list-item>
              </v-list>
              <div v-else class="template-list-empty">
                <v-progress-circular v-if="isLoadingTemplates" indeterminate color="primary" size="28" width="3" />
                <span>{{ isLoadingTemplates ? 'Cargando plantillas…' : 'Aún no hay plantillas.' }}</span>
              </div>
            </aside>
            <section class="template-editor-pane" aria-label="Editor de plantilla">
              <v-alert v-if="templatesError" type="error" variant="tonal" density="compact" class="template-editor-error">{{ templatesError }}</v-alert>
              <template v-if="isEditingTemplate">
                <div class="template-editor-fields">
                  <v-text-field v-model="templateEditor.nombre" label="Nombre" density="compact" variant="outlined" hide-details />
                  <v-textarea v-model="templateEditor.descripcion" label="Descripción" rows="2" max-rows="4" auto-grow density="compact" variant="outlined" hide-details />
                </div>
                <div ref="templateEditorHost" class="latex-editor-shell template-code-editor" />
              </template>
              <div v-else class="template-editor-empty"><v-icon icon="mdi-content-duplicate" size="42" color="primary" /><p>Selecciona una plantilla o crea una nueva desde la toolbar.</p></div>
            </section>
          </div>
        </section>

        <section v-else class="calendar-workspace">
          <div v-if="calendarMode === 'month'" class="calendar-grid" :style="{ '--calendar-weeks': calendarDays.length / 7 }">
            <div v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day" class="calendar-weekday">{{ day }}</div>
            <div v-for="(day, index) in calendarDays" :key="index" class="calendar-day" :class="{ 'calendar-day-empty': !day, 'calendar-day-today': isToday(day), 'calendar-weekend': index % 7 >= 5 }"><span class="calendar-day-number">{{ day }}</span></div>
          </div>
          <div v-else-if="calendarMode === 'week'" class="week-calendar">
            <div class="week-header">
              <div />
              <div v-for="date in weekDays" :key="date.toISOString()" class="week-day" :class="{ 'week-day-today': isTodayDate(date) }">
                <span>{{ new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(date) }}</span>
                <strong v-if="!scheduleConfigMode" class="week-day-number">{{ date.getDate() }}</strong>
              </div>
            </div>
            <div v-for="(module, moduleIndex) in scheduleModules" :key="module.start" class="schedule-row" :class="{ 'schedule-break': module.break }" :style="{ '--duration': module.minutes }">
              <div class="schedule-time"><span class="schedule-start">{{ module.start }}</span><span v-if="moduleIndex === scheduleModules.length - 1" class="schedule-end">{{ module.end }}</span></div>
              <button
                v-for="(date, dayIndex) in weekDays"
                :key="`${module.start}-${date.toISOString()}`"
                type="button"
                class="schedule-cell"
                :class="{ 'schedule-cell-configurable': scheduleConfigMode, 'schedule-cell-filled': scheduleBlock(dayIndex, moduleIndex) }"
                :style="scheduleBlock(dayIndex, moduleIndex) ? { '--schedule-color': scheduleBlock(dayIndex, moduleIndex).color } : undefined"
                :aria-label="scheduleConfigMode ? `Configurar ${new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(date)}, ${module.start}` : undefined"
                @click="openScheduleDialog(dayIndex, moduleIndex)"
              >
                <span v-if="scheduleBlock(dayIndex, moduleIndex)" class="schedule-block">
                  <span class="schedule-block-top"><strong>{{ scheduleBlock(dayIndex, moduleIndex).course }}</strong><small>{{ scheduleBlock(dayIndex, moduleIndex).classroom }}</small></span>
                  <span class="schedule-block-subject">{{ scheduleBlock(dayIndex, moduleIndex).subject }}</span>
                </span>
                <span v-if="currentTimePosition(date, module)" class="current-time-line" :style="{ top: currentTimePosition(date, module) }" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div v-else class="academic-calendar">
            <section v-for="month in academicMonths" :key="month.toISOString()" class="academic-month">
              <h2>{{ new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(month) }}</h2>
              <div class="academic-weekdays"><span v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day">{{ day }}</span></div>
              <div class="academic-days">
                <span v-for="(day, index) in getMonthDays(month)" :key="index" :class="{ 'academic-empty': !day, 'academic-weekend': index % 7 >= 5, 'academic-today': day && month.getMonth() === new Date().getMonth() && month.getFullYear() === new Date().getFullYear() && day === new Date().getDate() }">{{ day }}</span>
              </div>
            </section>
          </div>
        </section>
      </div>
    </v-main>

    <v-dialog v-model="mathConceptDeleteDialog" max-width="620">
      <v-card>
        <v-card-title class="pt-5 px-6">Eliminar sector con descendientes</v-card-title>
        <v-card-text class="px-6 pb-2">
          <p>«{{ mathConceptDeleteTarget?.title }}» contiene otros sectores. Puedes eliminarlos con él o conservarlos, haciendo que pasen a depender directamente de su actual abuelo.</p>
        </v-card-text>
        <v-card-actions class="px-6 pb-5 flex-wrap ga-2">
          <v-btn variant="text" :disabled="isSavingMathConcepts" @click="mathConceptDeleteDialog = false">Cancelar</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="tonal" :disabled="isSavingMathConcepts" @click="deleteMathConceptKeepingChildren()">Conservar descendientes</v-btn>
          <v-btn color="error" variant="flat" :disabled="isSavingMathConcepts" @click="deleteMathConceptBranch()">Borrar descendientes</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="scheduleDialog" max-width="480">
      <v-card>
        <v-card-title class="pt-5 px-6">Configurar segmento horario</v-card-title>
        <v-card-text class="px-6 pb-2">
          <p class="text-body-2 text-medium-emphasis mb-5">Esta configuración se aplicará a este día y tramo horario en todas las semanas.</p>
          <v-alert v-if="firestoreError" type="error" variant="tonal" density="compact" class="mb-4">{{ firestoreError }}</v-alert>
          <v-select v-if="schedulePresets.length" v-model="selectedSchedulePreset" :items="schedulePresets" item-title="title" return-object clearable label="Reutilizar configuración" @update:model-value="applySchedulePreset">
            <template #item="{ props, item }"><v-list-item v-bind="props" class="schedule-preset-option" :style="{ backgroundColor: item.raw.color }" /></template>
          </v-select>
          <v-combobox v-model="scheduleForm.course" :items="courseOptions" label="Curso" />
          <v-combobox v-model="scheduleForm.subject" :items="subjectOptions" label="Asignatura" />
          <v-combobox v-model="scheduleForm.classroom" :items="classroomOptions" label="Aula" />
          <v-select v-model="scheduleForm.color" :items="colorOptions" item-title="title" item-value="value" label="Color">
            <template #selection="{ item }"><span class="color-dot mr-3" :style="{ background: item.raw.value }" />{{ item.title }}</template>
            <template #item="{ props, item }"><v-list-item v-bind="props"><template #prepend><span class="color-dot mr-3" :style="{ background: item.raw.value }" /></template></v-list-item></template>
          </v-select>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-btn color="error" variant="text" :disabled="isSavingSchedule || !hasSelectedScheduleBlock" @click="clearScheduleBlock">Limpiar segmento</v-btn>
          <v-spacer />
          <v-btn variant="text" :disabled="isSavingSchedule" @click="scheduleDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="isSavingSchedule" :disabled="!scheduleForm.course || !scheduleForm.color" @click="saveScheduleBlock">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>
