<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query as firestoreQuery,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getIdTokenResult, onIdTokenChanged, signOut } from 'firebase/auth'
import { deleteObject, getDownloadURL, listAll, ref as storageRef, uploadBytes } from 'firebase/storage'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { latex } from 'codemirror-lang-latex'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { auth, db, functions, isAppCheckConfigured, storage } from './services/firebase'
import MasonryGrid from './components/MasonryGrid.vue'
import ExerciseCurriculumPicker from './components/ExerciseCurriculumPicker.vue'
import ExerciseCompetencyEditor from './components/ExerciseCompetencyEditor.vue'
import ExerciseVariantSelector from './components/ExerciseVariantSelector.vue'
import MathConceptMap from './components/MathConceptMap.vue'
import DocumentCreator from './components/DocumentCreator.vue'
import Gradebook from './components/Gradebook.vue'
import Classroom from './components/Classroom.vue'
import GroupProgramming from './components/GroupProgramming.vue'
import StudentDetail from './components/StudentDetail.vue'
import AppErrorToast from './components/AppErrorToast.vue'
import AuthGateway from './components/AuthGateway.vue'
import InvitationManager from './components/InvitationManager.vue'
import LocalStudentDataTransfer from './components/LocalStudentDataTransfer.vue'
import StudentPortal from './components/StudentPortal.vue'
import RubricManager from './components/RubricManager.vue'
import { programmingDatesForGroup } from './services/programmingRepository'
import { mathSubjects, normalizeHierarchySelection } from './data/mathCurriculum'
import { deleteStudentIdentitiesEverywhere, saveStudentIdentities } from './services/localStudentIdentity'
import { normalizeDisplayMathDelimiters } from './utils/latexNormalization'
import { showAppErrorToast } from './composables/useAppErrorToast'
import {
  currentAcademicYear,
  loadGroupsForTeacher,
  loadNonTeachingSchedule,
  loadScheduleTimePoints,
  loadStudentsForGroup,
  migrateLegacyGroups,
  saveGroup,
  saveGroupMetadata,
  saveNonTeachingSchedule,
  saveScheduleTimePoints,
} from './services/groupRepository'
import {
  aggregateExerciseStructure,
  analyzeExerciseLatex,
  buildExerciseLatex,
  buildExercisePartLatex,
  exerciseDocumentStructure,
  exercisePdfStoragePaths,
  exerciseStructureFromDocument,
  mergeExerciseStructure,
  parseExerciseLatex,
  pdfReferenceUrl,
  pdfReferenceAspectRatio,
} from './utils/exerciseStructure'
import {
  compactExerciseConceptLabel,
  exerciseStatementText,
  exerciseVersion,
  exerciseVersionAuthors,
} from './utils/exerciseCardMetadata'

const ExercisePdfPreview = defineAsyncComponent(() => import('./components/ExercisePdfPreview.vue'))

const drawer = ref(true)
const authReady = ref(false)
const authUser = ref(null)
const authClaims = ref({})
const authRole = computed(() => authClaims.value.role || '')
const isAdministrator = computed(() => authClaims.value.admin === true)
const currentTeacherId = computed(() => authRole.value === 'teacher' ? authUser.value?.uid || null : null)
const currentUserName = computed(() => authUser.value?.displayName || authUser.value?.email || 'Profesor')
const currentUserInitials = computed(() => currentUserName.value.split(/\s+/u).map((part) => part[0]).join('').slice(0, 2).toUpperCase())
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
const courseCalendarConfigMode = ref(false)
const scheduleDialog = ref(false)
const scheduleDeleteDialog = ref(false)
const courseCalendarDialog = ref(false)
const selectedSlot = ref(null)
const selectedCourseCalendarDate = ref('')
const scheduleBlocks = ref([])
const defaultScheduleTimePoints = Object.freeze(['08:15', '09:10', '10:05', '11:00', '11:20', '12:15', '13:10', '14:05', '15:00'])
const scheduleTimePoints = ref([...defaultScheduleTimePoints])
const schoolCalendar = ref({ types: [], days: {} })
const teacherGroups = ref([])
const selectedCareerGroupId = ref(null)
const isLoadingSelectedGroup = ref(false)
const gradebookRef = ref(null)
const gradebookDirty = ref(false)
const gradebookValid = ref(true)
const isSavingGradebook = ref(false)
const gradebookConfigurationMode = ref(false)
const groupView = ref('evaluation')
const classroomDate = ref('')
const selectedStudentDetail = ref(null)
const studentDetailConfigurationMode = ref(false)
const scheduleForm = ref(emptyScheduleForm())
const scheduleClipboard = ref(null)
const courseCalendarForm = ref(emptyCourseCalendarForm())
const isSavingSchedule = ref(false)
const firestoreError = ref('')
const teacherDocument = computed(() => currentTeacherId.value ? doc(db, 'teachers', currentTeacherId.value) : null)
const teacherProfile = ref({ centros: [] })
const teacherProfileEditing = ref(false)
const teacherProfileEditingCenterId = ref(null)
const isSavingTeacherProfile = ref(false)
const teacherProfileError = ref('')
const profileImageInput = ref(null)
const profileImageTarget = ref(null)
const exercises = ref([])
const selectedExerciseId = ref(null)
const exerciseEditor = ref(emptyExercise())
const exerciseView = ref('search')
const exerciseSearchQuery = ref('')
const exerciseSearchCurriculum = ref(emptyCurriculum())
const exerciseSearchCurriculumDialog = ref(false)
const isLoadingExercises = ref(false)
const isLoadingMoreExercises = ref(false)
const hasMoreExercises = ref(true)
const isSavingExercise = ref(false)
const isDeletingExercise = ref(false)
const exerciseDeleteDialog = ref(false)
const exerciseDeleteError = ref('')
const isGeneratingVariation = ref(false)
const isGeneratingSolution = ref(false)
const isDeletingSolution = ref(false)
const variationProgressText = ref('')
const selectedExerciseVersion = ref(0)
const exerciseSearchVersions = ref({})
const exerciseEditorTab = ref('code')
const exerciseContentTarget = ref(null)
const exerciseCompetencyTarget = ref(null)
const exerciseAttachmentInput = ref(null)
const isUploadingExerciseFiles = ref(false)
const isGeneratingPartSolution = ref(null)
const sessionUploadedAttachmentPaths = new Set()
const pendingDeletedAttachments = []
const aiModelOptions = Object.freeze([
  { title: 'Gemini 3 Flash', value: 'google/gemini-3-flash-preview', subtitle: 'Predeterminado · rápido y fiable' },
  { title: 'Gemini 3.7 Flash', value: 'google/gemini-3.7-flash', subtitle: 'Nueva generación · rápido y preciso' },
  { title: 'Gemini 3.8 Flash', value: 'google/gemini-3.8-flash', subtitle: 'Nueva generación · rápido y preciso' },
  { title: 'GPT-5 Mini', value: 'openai/gpt-5-mini', subtitle: 'Equilibrio entre coste y calidad' },
  { title: 'GPT-5.6 Luna', value: 'openai/gpt-5.6-luna', subtitle: 'Premium · rápida y estructurada' },
  { title: 'GPT-5.6 Terra', value: 'openai/gpt-5.6-terra', subtitle: 'Premium · razonamiento equilibrado' },
  { title: 'GPT-5.6 Sol', value: 'openai/gpt-5.6-sol', subtitle: 'Premium · máxima capacidad' },
  { title: 'GPT-6 Astra', value: 'openai/gpt-6-astra', subtitle: 'Premium · máxima capacidad' },
  { title: 'Claude Fable 5.1', value: 'anthropic/claude-fable-5.1', subtitle: 'Premium · razonamiento y redacción' },
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

;[
  mathConceptsError,
  teacherProfileError,
  exercisesError,
  templatesError,
  firestoreError,
  exerciseDeleteError,
].forEach((source) => watch(source, (message) => {
  if (message) showAppErrorToast(message)
}))
const templateEditorHost = ref(null)
const templateFileInput = ref(null)
let templateCodeEditor
const compilerBaseUrl = '/compiler-api/v1'
const selectedPreamble = ref('')
const exercisePreviewTab = ref('statement')
const exercisePreviewMode = ref('segmented')
const compilerError = ref('')
const exerciseCompilerErrorSnackbar = computed({
  get: () => Boolean(compilerError.value && exerciseView.value === 'edit'),
  set: (visible) => {
    if (!visible) compilerError.value = ''
  },
})
const isCompiling = ref(false)
const exerciseCompilationStatus = ref('ready')
let stopExerciseCompilationWatch = null
const exerciseCompilationListWatches = new Map()
const documentCreatorRef = ref(null)
const programmingRef = ref(null)
const isCompilingDocument = ref(false)
const documentSearchQuery = ref('')
const documentsTab = ref('documents')
const documentWorkflow = ref({ mode: 'library', step: 0, totalSteps: 4, canContinue: false, canGoBack: false, canSave: false, isSaving: false })
const rubricManagerRef = ref(null)
const rubricSearchQuery = ref('')
const rubricSubjectFilter = ref('')
const rubricWorkflow = ref({ mode: 'library', canSave: false, isSaving: false, persisted: false })
const rubricSubjectOptions = Object.freeze(mathSubjects.map((subject) => ({
  title: `${subject.course} · ${subject.title}`,
  value: subject.id,
})))
const mathSubjectsById = new Map(mathSubjects.map((subject) => [subject.id, subject]))
const isAppleTouchDevice = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const exerciseBatchSize = isAppleTouchDevice ? 6 : 9
let lastExerciseDocument = null
let exerciseScrollFrame = 0

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
const scheduleModules = computed(() => scheduleTimePoints.value.slice(0, -1).map((start, index) => {
  const end = scheduleTimePoints.value[index + 1]
  const minutes = timeToMinutes(end) - timeToMinutes(start)
  return { start, end, minutes, break: minutes <= 25 }
}))
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
  const startYear = shownMonth.value.getMonth() >= 7 ? shownMonth.value.getFullYear() : shownMonth.value.getFullYear() - 1
  return Array.from({ length: 10 }, (_, index) => new Date(startYear, 8 + index, 1))
})

const filteredExercises = computed(() => {
  const search = String(exerciseSearchQuery.value || '').trim().toLocaleLowerCase('es')
  const filters = exerciseSearchCurriculum.value
  const terminalFilterIds = terminalConceptIds(filters.conceptIds)
  return exercises.value.filter((exercise) => {
    const matchesSearch = !search
      || exerciseStatementText(exercise).toLocaleLowerCase('es').includes(search)
    if (!matchesSearch) return false
    if (filters.course && exercise.curriculum.course !== filters.course) return false
    if (filters.subjectId && exercise.curriculum.subjectId !== filters.subjectId) return false
    if (filters.competencial && !exercise.curriculum.competencial) return false
    if (terminalFilterIds.length) {
      const closure = exerciseConceptClosure(exercise.curriculum.conceptIds)
      if (!terminalFilterIds.some((id) => closure.has(id))) return false
    }
    return true
  })
})
const activeMathExerciseCountByConcept = computed(() => countExercisesByConcept(activeMathSubjectId.value
  ? exercises.value.filter((exercise) => exercise.curriculum.subjectId === activeMathSubjectId.value)
  : exercises.value))
const editorExerciseCountByConcept = computed(() => countExercisesByConcept(exercises.value.filter((exercise) => (
  !exerciseEditor.value.curriculum.subjectId || exercise.curriculum.subjectId === exerciseEditor.value.curriculum.subjectId
))))
const searchExerciseCountByConcept = computed(() => countExercisesByConcept(exercises.value.filter((exercise) => (
  (!exerciseSearchCurriculum.value.course || exercise.curriculum.course === exerciseSearchCurriculum.value.course)
  && (!exerciseSearchCurriculum.value.subjectId || exercise.curriculum.subjectId === exerciseSearchCurriculum.value.subjectId)
))))
const activeMathSubjectTitle = computed(() => mathSubjectsById.get(activeMathSubjectId.value)?.title || 'Matemáticas')
const exerciseEditorCurriculumLabel = computed(() => exerciseCurriculumLabel(exerciseEditor.value))
const exerciseSearchFilterCount = computed(() => Number(Boolean(exerciseSearchCurriculum.value.course))
  + Number(Boolean(exerciseSearchCurriculum.value.subjectId))
  + exerciseSearchCurriculum.value.conceptIds.length
  + Number(Boolean(exerciseSearchCurriculum.value.competencial)))
const selectedExercise = computed(() => exercises.value.find((exercise) => exercise.id === selectedExerciseId.value) || null)
const isEditingPersistedExercise = computed(() => Boolean(
  exerciseEditor.value.id && exercises.value.some((exercise) => exercise.id === exerciseEditor.value.id),
))
const activeExerciseVersion = computed(() => selectedExerciseVersion.value === 0
  ? exerciseEditor.value
  : exerciseEditor.value.variaciones[selectedExerciseVersion.value - 1] || exerciseEditor.value)
const activeExerciseCode = computed(() => activeExerciseVersion.value.enunciado || '')
const activeExerciseStructure = computed(() => activeExerciseVersion.value.structure || parseExerciseLatex(activeExerciseCode.value))
const activeExerciseHasSections = computed(() => activeExerciseStructure.value.apartados.length > 0)
const compiledPdfUrl = computed(() => activeExerciseVersion.value.previewPdf?.enunciado || activeExerciseVersion.value.pdf?.enunciado || '')
const compiledSolutionPdfUrl = computed(() => activeExerciseVersion.value.previewPdf?.resuelto || activeExerciseVersion.value.pdf?.resuelto || '')
const activeCompletePdfUrl = computed(() => exercisePreviewTab.value === 'solution' ? compiledSolutionPdfUrl.value : compiledPdfUrl.value)
const segmentedExercisePreview = computed(() => activeExerciseHasSections.value && exercisePreviewMode.value === 'segmented')
const hasLatexChanges = computed(() => activeExerciseCode.value !== (activeExerciseVersion.value.renderedLatex || ''))
const activeExercisePdfUrl = computed(() => exercisePreviewTab.value === 'statement'
  ? compiledPdfUrl.value
  : compiledSolutionPdfUrl.value)
const exerciseCompilationLabel = computed(() => ({
  outdated: 'Cambios sin compilar',
  queued: 'En cola',
  compiling: 'Compilando',
  error: 'Error de compilación',
}[exerciseCompilationStatus.value] || 'PDF actualizado'))
const selectedTemplate = computed(() => templates.value.find((template) => template.id === selectedTemplateId.value) || null)
const preambleOptions = computed(() => templates.value.filter((template) => template.archivo))

const scheduleSubjectOptions = Object.freeze(mathSubjects.map((subject) => ({
  title: `${subject.course} — ${subject.title}`,
  value: subject.id,
  course: subject.course,
  subject: subject.title,
})))
const filteredScheduleSubjectOptions = computed(() => {
  const course = scheduleCourseLevel(scheduleForm.value.course)
  if (!course) return scheduleSubjectOptions
  return scheduleSubjectOptions
    .filter((option) => option.course === course)
    .map((option) => ({ ...option, title: option.subject }))
})
const scheduleAssignmentOptions = computed(() => scheduleForm.value.course.trim()
  ? [
      ...filteredScheduleSubjectOptions.value,
      ...scheduleTutorOptions.map((option) => ({
        ...option,
        value: option.value,
        subject: option.title,
        isTutor: true,
      })),
    ]
  : [])
const scheduleAssignmentValue = computed({
  get: () => scheduleForm.value.tutorType || scheduleForm.value.subjectId,
  set: (value) => selectScheduleAssignment(value),
})
const scheduleSegmentTypeOptions = Object.freeze([
  { title: 'Actividad complementaria', value: 'actividad-complementaria', color: '#2F6F4E' },
  { title: 'Guardia', value: 'guardia', color: '#B85C1E' },
  { title: 'Apoyo a Guardia', value: 'apoyo-guardia', color: '#806A00' },
  { title: 'Reunión de Departamento', value: 'reunion-departamento', color: '#315F94' },
  { title: 'Reunión de Tutores', value: 'reunion-tutores', color: '#674C8F' },
])
const scheduleTutorOptions = Object.freeze([
  { title: 'Tutoría Individual', value: 'tutoria-individual' },
  { title: 'Tutoría con grupo', value: 'tutoria-grupo' },
])
const canSaveScheduleBlock = computed(() => (
  scheduleForm.value.course.trim()
    ? Boolean(scheduleForm.value.subjectId)
    : Boolean(scheduleForm.value.nonTeachingKind)
))
const hasSelectedScheduleBlock = computed(() => selectedSlot.value
  && Boolean(scheduleBlock(selectedSlot.value.dayIndex, selectedSlot.value.moduleIndex)))
const scheduleSubjectColors = Object.freeze({
  '1eso-matematicas': '#E8F0FB',
  '2eso-matematicas': '#D8E5F7',
  '3eso-matematicas': '#C5D8F0',
  '4eso-matematicas-a': '#AEC8E7',
  '4eso-matematicas-b': '#9AB8DC',
  '1bto-matematicas-i': '#7FA5D1',
  '1bto-matematicas-ccss-i': '#6F96C5',
  '2bto-matematicas-ii': '#557FB4',
  '2bto-matematicas-ccss-ii': '#416C9F',
})
const courseCalendarEventOptions = Object.freeze([
  { title: 'Inicio de curso', value: 'inicio-curso', color: '#D8E5F7', requiresCourses: true, lectivo: true },
  { title: 'Fin de curso', value: 'fin-curso', color: '#315F94', requiresCourses: true, lectivo: true },
  { title: 'Evaluación', value: 'evaluacion', color: '#4B74A8', requiresCourses: true, lectivo: true },
  { title: 'Examen', value: 'examen', color: '#D8E5F7', requiresCourses: true, lectivo: true },
  { title: 'Salida', value: 'salida', color: '#F2D56B', requiresCourses: true, lectivo: true },
  { title: 'Claustro', value: 'claustro', color: '#956F55', requiresCourses: false, lectivo: true },
  { title: 'Festivo', value: 'festivo', color: '#BFE88D', requiresCourses: false, lectivo: false },
  { title: 'Libre disposición', value: 'libre-disposicion', color: '#F2A36F', requiresCourses: false, lectivo: false },
  { title: 'Baja', value: 'baja', color: '#D96868', requiresCourses: false, lectivo: false },
  { title: 'Servicio especial', value: 'servicio-especial', color: '#8065A8', requiresCourses: false, lectivo: true },
])

const academicCalendarYear = computed(() => {
  const first = academicMonths.value[0]
  return `${first.getFullYear()}-${first.getFullYear() + 1}`
})
const academicCalendarCourseOptions = computed(() => groups.value
  .map((group) => ({
    title: [group.title, group.subtitle].filter(Boolean).join(' · '),
    groupName: group.title,
    value: group.id,
  })))
const selectedCourseCalendarEvent = computed(() => courseCalendarEventOptions.find((event) => event.value === courseCalendarForm.value.eventKey) || null)
const canSaveCourseCalendarDay = computed(() => Boolean(
  selectedCourseCalendarEvent.value
  && (!selectedCourseCalendarEvent.value.requiresCourses || courseCalendarForm.value.cursos.length > 0),
))
const selectedCourseCalendarDateLabel = computed(() => {
  const [year, month, day] = String(selectedCourseCalendarDate.value || '').split('-').map(Number)
  if (!year || !month || !day) return 'Configurar día'
  const label = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day))
  return `Configurar ${label}`
})

function emptyCourseCalendarForm() {
  return { typeId: null, eventKey: null, color: '', lectivo: true, mensaje: '', cursos: [] }
}

function normalizeSchoolCalendar(value) {
  const types = Array.isArray(value?.types) ? value.types.map((type) => ({
    id: type.id || createGroupId(),
    eventKey: String(type.eventKey || ''),
    title: String(type.title || ''),
    color: type.color || '#E7F5C9',
    lectivo: type.lectivo !== false,
    mensaje: String(type.mensaje || ''),
    cursos: Array.isArray(type.cursos) ? [...type.cursos] : [],
  })) : []
  const validIds = new Set(types.map((type) => type.id))
  const days = Object.fromEntries(Object.entries(value?.days || {}).filter(([, typeId]) => validIds.has(typeId)))
  return { types, days }
}

function academicCalendarKey(month, day) {
  if (!day) return ''
  const date = new Date(month.getFullYear(), month.getMonth(), day)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function academicCalendarEntry(month, day) {
  const typeId = schoolCalendar.value.days?.[academicCalendarKey(month, day)]
  return (schoolCalendar.value.types || []).find((type) => type.id === typeId) || null
}

function schoolCalendarEntryForDate(date) {
  if (!date) return null
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const typeId = schoolCalendar.value.days?.[key]
  return (schoolCalendar.value.types || []).find((type) => type.id === typeId) || null
}

function schoolCalendarWeekendEntry(date) {
  return date && (date.getDay() === 0 || date.getDay() === 6)
    ? { eventKey: 'festivo', title: 'Festivo', color: '#BFE88D', lectivo: false, mensaje: '', cursos: [] }
    : null
}

function displayedSchoolCalendarEntry(date) {
  return schoolCalendarEntryForDate(date) || schoolCalendarWeekendEntry(date)
}

function calendarTypeCourses(entry) {
  if (!entry?.cursos?.length) return ''
  return entry.cursos.map((id) => academicCalendarCourseOptions.value.find((course) => course.value === id)?.title || id).join(', ')
}

function courseCalendarEvent(entry) {
  return courseCalendarEventOptions.find((event) => event.value === entry?.eventKey) || null
}

function courseCalendarEntryTitle(entry) {
  return courseCalendarEvent(entry)?.title || entry?.title || 'Evento'
}

function courseCalendarTooltipLines(entry) {
  if (!entry) return []
  const title = courseCalendarEntryTitle(entry)
  const courseLines = (entry.cursos || []).map((id) => {
    const course = academicCalendarCourseOptions.value.find((option) => option.value === id)
    return `${title} ${course?.groupName || course?.title || id}`
  })
  return [
    ...(courseLines.length ? courseLines : [title]),
    ...(entry.mensaje ? [entry.mensaje] : []),
  ]
}

function calendarEntryColor(entry) {
  return courseCalendarEvent(entry)?.color || entry?.color || '#E7F5C9'
}

function readableTextColor(backgroundColor) {
  const hex = String(backgroundColor || '').trim().replace('#', '')
  const normalized = hex.length === 3 ? hex.split('').map((character) => character + character).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#173452'
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  const darkForegroundLuminance = 0.00655
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithDark = (luminance + 0.05) / (darkForegroundLuminance + 0.05)
  return contrastWithWhite >= contrastWithDark ? '#FFFFFF' : '#071421'
}

function courseCalendarTooltipStyle(entry) {
  const backgroundColor = calendarEntryColor(entry)
  return {
    '--school-calendar-tooltip-background': backgroundColor,
    '--school-calendar-tooltip-foreground': readableTextColor(backgroundColor),
  }
}

function academicCalendarDayStyle(month, day) {
  if (!day) return undefined
  const entry = displayedSchoolCalendarEntry(new Date(month.getFullYear(), month.getMonth(), day))
  if (!entry) return undefined
  const backgroundColor = calendarEntryColor(entry)
  return {
    backgroundColor,
    color: readableTextColor(backgroundColor),
    '--academic-day-color': backgroundColor,
  }
}

function openCourseCalendarDialog(month, day) {
  if (!courseCalendarConfigMode.value || !day) return
  const clickedDate = new Date(month.getFullYear(), month.getMonth(), day)
  if (clickedDate.getDay() === 0 || clickedDate.getDay() === 6) return
  const key = academicCalendarKey(month, day)
  const entry = academicCalendarEntry(month, day)
  selectedCourseCalendarDate.value = key
  courseCalendarForm.value = entry ? { ...entry, cursos: [...(entry.cursos || [])] } : emptyCourseCalendarForm()
  courseCalendarDialog.value = true
}

function selectCourseCalendarEvent(eventKey) {
  const event = courseCalendarEventOptions.find((option) => option.value === eventKey)
  if (!event) return
  courseCalendarForm.value = {
    ...courseCalendarForm.value,
    eventKey: event.value,
    title: event.title,
    color: event.color,
    lectivo: event.lectivo,
    cursos: event.requiresCourses ? courseCalendarForm.value.cursos : [],
  }
}

async function saveCourseCalendarDay() {
  if (!selectedCourseCalendarDate.value || !canSaveCourseCalendarDay.value) return
  const form = courseCalendarForm.value
  const event = selectedCourseCalendarEvent.value
  const previousTypeId = schoolCalendar.value.days?.[selectedCourseCalendarDate.value]
  const typeId = createGroupId()
  const type = {
    id: typeId,
    eventKey: event.value,
    title: event.title,
    color: event.color,
    lectivo: event.lectivo,
    mensaje: String(form.mensaje || '').trim(),
    cursos: event.requiresCourses ? [...new Set(form.cursos || [])] : [],
  }
  const previous = schoolCalendar.value
  const days = { ...(previous.days || {}), [selectedCourseCalendarDate.value]: typeId }
  const stillUsedTypeIds = new Set(Object.values(days))
  const types = [
    ...(previous.types || []).filter((item) => item.id !== previousTypeId || stillUsedTypeIds.has(item.id)),
    type,
  ]
  schoolCalendar.value = { types, days }
  try {
    await updateDoc(teacherDocument.value, {
      [`calendariosEscolares.${academicCalendarYear.value}`]: schoolCalendar.value,
    })
    courseCalendarDialog.value = false
  } catch (error) {
    schoolCalendar.value = previous
    firestoreError.value = 'No se ha podido guardar la configuración del calendario escolar.'
    console.error('Error al guardar calendario escolar:', error)
  }
}

async function clearCourseCalendarDay() {
  if (!selectedCourseCalendarDate.value) return
  const previous = schoolCalendar.value
  const days = { ...(previous.days || {}) }
  const removedTypeId = days[selectedCourseCalendarDate.value]
  delete days[selectedCourseCalendarDate.value]
  const usedTypeIds = new Set(Object.values(days))
  const types = (previous.types || []).filter((type) => type.id !== removedTypeId || usedTypeIds.has(type.id))
  schoolCalendar.value = { types, days }
  try {
    await updateDoc(teacherDocument.value, {
      [`calendariosEscolares.${academicCalendarYear.value}`]: schoolCalendar.value,
    })
    courseCalendarDialog.value = false
  } catch (error) {
    schoolCalendar.value = previous
    firestoreError.value = 'No se ha podido limpiar el día del calendario escolar.'
    console.error('Error al limpiar día del calendario escolar:', error)
  }
}

function emptyScheduleForm() {
  return { id: null, type: 'nonTeaching', nonTeachingKind: null, tutorType: null, groupId: null, course: '', subjectId: null, subject: '', classroom: '', color: null }
}

function scheduleSubjectId(course, subject) {
  const normalizedCourse = String(course || '').trim().replace(/\s+[A-Z]$/u, '')
  const normalizedSubject = String(subject || '').trim()
  return mathSubjects.find((candidate) => (
    candidate.course === normalizedCourse && candidate.title === normalizedSubject
  ))?.id || null
}

function scheduleCourseLevel(groupName) {
  const normalizedGroup = String(groupName || '').toLocaleUpperCase('es').replace(/\s+/gu, '')
  if (!normalizedGroup) return null
  return [...new Set(mathSubjects.map((subject) => subject.course))]
    .find((course) => normalizedGroup.startsWith(course.toLocaleUpperCase('es').replace(/\s+/gu, ''))) || null
}

function updateScheduleCourse(groupName) {
  const course = scheduleCourseLevel(groupName)
  if (!String(groupName || '').trim()) {
    selectScheduleSubject(null)
    return
  }
  scheduleForm.value.type = 'teaching'
  scheduleForm.value.nonTeachingKind = null
  if (!course || !scheduleForm.value.subjectId) return
  const selectedSubject = mathSubjectsById.get(scheduleForm.value.subjectId)
  if (selectedSubject?.course !== course) selectScheduleSubject(null)
}

function selectScheduleSubject(subjectId) {
  const selectedSubject = mathSubjectsById.get(subjectId)
  scheduleForm.value.subjectId = selectedSubject?.id || null
  scheduleForm.value.subject = selectedSubject?.title || ''
  scheduleForm.value.type = selectedSubject ? 'teaching' : 'nonTeaching'
  if (!selectedSubject) scheduleForm.value.tutorType = null
  scheduleForm.value.nonTeachingKind = selectedSubject ? null : scheduleForm.value.nonTeachingKind
  scheduleForm.value.color = scheduleColorFor(scheduleForm.value)
}

function selectScheduleAssignment(value) {
  const tutorOption = scheduleTutorOptions.find((option) => option.value === value)
  if (tutorOption) {
    const subjectId = scheduleForm.value.subjectId || filteredScheduleSubjectOptions.value[0]?.value || null
    const subject = mathSubjectsById.get(subjectId)
    scheduleForm.value.subjectId = subjectId
    scheduleForm.value.subject = subject?.title || ''
    scheduleForm.value.tutorType = tutorOption.value
    scheduleForm.value.type = 'teaching'
    scheduleForm.value.color = scheduleColorFor(scheduleForm.value)
    return
  }
  scheduleForm.value.tutorType = null
  selectScheduleSubject(value)
}

function scheduleSegmentType(valueOrTitle) {
  return scheduleSegmentTypeOptions.find((option) => (
    option.value === valueOrTitle || option.title === valueOrTitle
  )) || null
}

function selectScheduleSegmentType(segmentType) {
  scheduleForm.value.nonTeachingKind = scheduleSegmentType(segmentType)?.value || null
  scheduleForm.value.type = 'nonTeaching'
  scheduleForm.value.subjectId = null
  scheduleForm.value.subject = ''
  scheduleForm.value.color = scheduleColorFor(scheduleForm.value)
}

function scheduleColorFor(block = {}) {
  if (block.subjectId && scheduleSubjectColors[block.subjectId]) {
    const base = scheduleSubjectColors[block.subjectId]
    if (block.tutorType) {
      const hex = base.replace('#', '')
      const channels = [0, 2, 4].map((offset) => Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * 0.48))
      return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    }
    return base
  }
  return scheduleSegmentType(block.nonTeachingKind)?.color
    || scheduleSegmentType(block.course)?.color
    || '#536273'
}

function scheduleTextColor(backgroundColor) {
  const hex = String(backgroundColor || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/iu.test(hex)) return '#19375f'
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
  return luminance < 0.56 ? '#ffffff' : '#19375f'
}

function scheduleCellStyle(block) {
  if (!block) return undefined
  return {
    '--schedule-color': block.color,
    '--schedule-text-color': scheduleTextColor(block.color),
  }
}

function emptyExercise() {
  const structure = parseExerciseLatex('')
  return {
    id: null,
    schemaVersion: 3,
    revision: 0,
    enunciado: '',
    tags: [],
    curriculum: emptyCurriculum(),
    archivos: [],
    pdf: emptyPdfPair(),
    solucionIA: false,
    variaciones: [],
    previewPdf: null,
    renderedLatex: '',
    compilation: { status: 'ready', requestedRevision: 0, readyRevision: 0, error: null },
    analysis: { valid: true, ambiguous: false },
    structure,
  }
}

function emptyCurriculum() {
  return { course: null, subjectId: null, conceptIds: [], competencial: false }
}

function normalizeCurriculum(curriculum = {}) {
  const subject = mathSubjectsById.get(curriculum.subjectId)
  const course = subject?.course || (typeof curriculum.course === 'string' ? curriculum.course : null)
  return {
    course,
    subjectId: subject?.id || null,
    conceptIds: [...new Set(Array.isArray(curriculum.conceptIds)
      ? curriculum.conceptIds.filter((id) => typeof id === 'string')
      : [])],
    competencial: Boolean(curriculum.competencial),
  }
}

function exerciseImageExtension(file = {}) {
  const mimeExtensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'application/pdf': 'pdf',
  }
  if (mimeExtensions[file.type]) return mimeExtensions[file.type]
  const sourceName = file.originalName || file.nombre || file.name || file.path || ''
  const extension = sourceName.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)?.[1]?.toLowerCase()
  if (extension === 'jpeg') return 'jpg'
  return ['png', 'jpg', 'pdf'].includes(extension) ? extension : ''
}

function normalizeExerciseFiles(files) {
  const usedNames = new Set()
  let nextNumber = 1
  return (Array.isArray(files) ? files : [])
    .filter((file) => file && typeof file.path === 'string' && typeof file.url === 'string')
    .map((file) => {
      let latexName = /^imagen[1-9]\d*$/.test(file.latexName || '') ? file.latexName : ''
      if (!latexName || usedNames.has(latexName)) {
        while (usedNames.has(`imagen${nextNumber}`)) nextNumber += 1
        latexName = `imagen${nextNumber}`
      }
      usedNames.add(latexName)
      nextNumber = Math.max(nextNumber, Number(latexName.slice(6)) + 1)
      const extension = exerciseImageExtension(file) || 'png'
      const compilerName = `${latexName}.${extension}`
      return {
        id: file.id || file.path,
        nombre: compilerName,
        originalName: file.originalName || file.nombre || file.name || file.path.split('/').at(-1),
        latexName,
        compilerName,
        path: file.path,
        url: file.url,
        type: file.type || (extension === 'pdf' ? 'application/pdf' : `image/${extension === 'jpg' ? 'jpeg' : extension}`),
        size: Number(file.size) || 0,
      }
    })
}

function emptyPdfPair() {
  return { enunciado: '', resuelto: null }
}

function normalizePdfPair(pdf) {
  if (typeof pdf === 'string') return { enunciado: pdf, resuelto: null }
  return {
    enunciado: pdfReferenceUrl(pdf?.statement || pdf?.enunciado),
    resuelto: pdfReferenceUrl(pdf?.solved || pdf?.resuelto) || null,
  }
}

function normalizePdfLayout(pdf) {
  if (!pdf || typeof pdf !== 'object') return { enunciado: 0, resuelto: 0 }
  return {
    enunciado: pdfReferenceAspectRatio(pdf.statement || pdf.enunciado),
    resuelto: pdfReferenceAspectRatio(pdf.solved || pdf.resuelto),
  }
}

function normalizeExercisePreview(preview = {}) {
  const raw = preview?.statement || preview?.enunciado || null
  if (!raw) return { enunciado: null }
  if (typeof raw === 'string') return { enunciado: { url: raw, sourceUrl: '' } }
  return {
    enunciado: {
      url: raw.url || raw.downloadUrl || '',
      storagePath: raw.storagePath || '',
      sourceUrl: raw.sourceUrl || '',
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      aspectRatio: Number(raw.aspectRatio) || 0,
    },
  }
}

const pendingPdfMetricWrites = new Set()

async function rememberExercisePdfMetrics(exercise, metrics = {}) {
  const aspectRatio = Number(metrics.aspectRatio) || 0
  const width = Number(metrics.width) || 0
  const height = Number(metrics.height) || 0
  if (!exercise?.id || aspectRatio <= 0) return
  if (!exercise.pdfLayout) exercise.pdfLayout = { enunciado: 0, resuelto: 0 }
  const alreadyStored = exercise.pdfLayout.enunciado > 0
  exercise.pdfLayout.enunciado = aspectRatio
  if (alreadyStored || width <= 0 || height <= 0 || pendingPdfMetricWrites.has(exercise.id)) return

  pendingPdfMetricWrites.add(exercise.id)
  try {
    await updateDoc(doc(db, 'ejercicios', exercise.id), {
      'pdf.statement.width': width,
      'pdf.statement.height': height,
      'pdf.statement.aspectRatio': aspectRatio,
    })
  } catch (error) {
    console.warn('No se han podido guardar las dimensiones del PDF:', error)
  } finally {
    pendingPdfMetricWrites.delete(exercise.id)
  }
}

function normalizeVariation(variation = {}) {
  const structured = Number(variation.schemaVersion) >= 3 && variation.statement
  const structure = structured
    ? exerciseStructureFromDocument(variation)
    : mergeExerciseStructure(parseExerciseLatex(variation.codigo || variation.latex || variation.enunciado || ''), variation)
  const code = structured
    ? buildExerciseLatex(structure, { preserveApartadosEnvironment: true })
    : variation.codigo || variation.latex || variation.enunciado || ''
  const pdf = normalizePdfPair(variation.pdf || {
    enunciado: variation.pdfenunciadocompleto,
    resuelto: variation.pdfsolucioncompleto,
  })
  const pdfLayout = normalizePdfLayout(variation.pdf)
  return {
    ...variation,
    enunciado: code,
    modelo: variation.modelo || '',
    pdf,
    pdfLayout,
    preview: normalizeExercisePreview(variation.preview),
    structure: mergeExerciseStructure(structure, { ...variation, pdf }),
    previewPdf: null,
    renderedLatex: pdf.enunciado ? code : '',
    analysis: { valid: true, ambiguous: false },
  }
}

function normalizeExercise(exercise) {
  const structured = Number(exercise.schemaVersion) >= 3 && exercise.statement
  const sourceStructure = structured
    ? exerciseStructureFromDocument(exercise)
    : mergeExerciseStructure(parseExerciseLatex(exercise.codigo || exercise.latex || exercise.enunciado || ''), exercise)
  const code = structured
    ? buildExerciseLatex(sourceStructure, { preserveApartadosEnvironment: true })
    : exercise.codigo || exercise.latex || exercise.enunciado || ''
  const pdf = normalizePdfPair(exercise.pdf || {
    enunciado: exercise.pdfenunciadocompleto,
    resuelto: exercise.pdfsolucioncompleto,
  })
  const pdfLayout = normalizePdfLayout(exercise.pdf)
  const structure = mergeExerciseStructure(sourceStructure, { ...exercise, pdf })
  const curriculum = normalizeCurriculum({
    ...exercise.curriculum,
    conceptIds: structure.apartados.length
      ? structure.contenidos
      : structure.contenidos.length ? structure.contenidos : exercise.curriculum?.conceptIds,
  })
  return {
    ...exercise,
    enunciado: code,
    tags: normalizeTags(exercise.tags),
    curriculum,
    archivos: normalizeExerciseFiles(exercise.archivos),
    pdf,
    pdfLayout,
    preview: normalizeExercisePreview(exercise.preview),
    structure,
    solucionIA: Boolean(exercise.solucionIA),
    variaciones: Array.isArray(exercise.variaciones) ? exercise.variaciones.map(normalizeVariation) : [],
    previewPdf: null,
    renderedLatex: pdf.enunciado ? code : '',
    analysis: { valid: true, ambiguous: false },
  }
}

function conceptAncestors(conceptId) {
  const nodesById = new Map(mathConceptNodes.value.map((node) => [node.id, node]))
  const ids = []
  let current = nodesById.get(conceptId)
  while (current) {
    ids.push(current.id)
    current = current.parentId ? nodesById.get(current.parentId) : null
  }
  return ids
}

function exerciseConceptClosure(conceptIds = []) {
  const closure = new Set()
  conceptIds.forEach((conceptId) => conceptAncestors(conceptId).forEach((id) => closure.add(id)))
  return closure
}

function terminalConceptIds(conceptIds = []) {
  const selected = [...new Set(conceptIds)]
  return selected.filter((id) => !selected.some((otherId) => (
    otherId !== id && conceptAncestors(otherId).includes(id)
  )))
}

function countExercisesByConcept(sourceExercises) {
  const exerciseIdsByConcept = new Map()
  sourceExercises.forEach((exercise) => {
    exerciseConceptClosure(exercise.curriculum.conceptIds).forEach((conceptId) => {
      if (!exerciseIdsByConcept.has(conceptId)) exerciseIdsByConcept.set(conceptId, new Set())
      exerciseIdsByConcept.get(conceptId).add(exercise.id)
    })
  })
  return Object.fromEntries([...exerciseIdsByConcept].map(([conceptId, ids]) => [conceptId, ids.size]))
}

function conceptTitlePath(conceptId) {
  const nodesById = new Map(mathConceptNodes.value.map((node) => [node.id, node]))
  const titles = []
  let current = nodesById.get(conceptId)
  while (current && current.id !== 'matematicas') {
    titles.unshift(current.title)
    current = current.parentId ? nodesById.get(current.parentId) : null
  }
  return titles
}

function conceptSelectionLabel(conceptIds = []) {
  const nodesById = new Map(mathConceptNodes.value.map((node) => [node.id, node]))
  const selectedIds = [...new Set(conceptIds)].filter((id) => nodesById.has(id) && id !== 'matematicas')
  const isAncestorOf = (ancestorId, candidateId) => {
    let current = nodesById.get(candidateId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true
      current = nodesById.get(current.parentId)
    }
    return false
  }
  // El selector guarda también los ascendientes para mantener la selección del mapa.
  // Para la etiqueta solo deben aparecer los conceptos más específicos.
  const terminalIds = selectedIds.filter((id) => !selectedIds.some((otherId) => otherId !== id && isAncestorOf(id, otherId)))
  const paths = terminalIds.map(conceptTitlePath).filter((path) => path.length)
  if (!paths.length) return ''
  if (paths.length === 1) return paths[0].join(' · ')
  let commonLength = 0
  while (paths.every((path) => path[commonLength] && path[commonLength] === paths[0][commonLength])) commonLength += 1
  const prefix = paths[0].slice(0, commonLength)
  const alternatives = paths.map((path) => path.slice(commonLength).join(' › ') || path.at(-1))
  return [...prefix, `(${alternatives.join(' · ')})`].join(' · ')
}

function exerciseAiCurriculum() {
  const curriculum = normalizeCurriculum(exerciseEditor.value?.curriculum)
  if (!curriculum.subjectId) return null
  return {
    subjectId: curriculum.subjectId,
    course: curriculum.course,
    conceptPaths: terminalConceptIds(curriculum.conceptIds)
      .map((conceptId) => conceptTitlePath(conceptId))
      .filter((path) => path.length),
  }
}

function exerciseCurriculumLabel(exercise) {
  const curriculum = normalizeCurriculum(exercise?.curriculum)
  const subject = mathSubjectsById.get(curriculum.subjectId)
  if (!curriculum.course || !subject) return 'Sin clasificar'
  const concepts = conceptSelectionLabel(curriculum.conceptIds)
  return `${curriculum.course} - ${subject.title}${concepts ? ` \\ ${concepts}` : ''}`
}

function exerciseSubjectLabel(exercise) {
  const curriculum = normalizeCurriculum(exercise?.curriculum)
  const subject = mathSubjectsById.get(curriculum.subjectId)
  return curriculum.course && subject ? `${curriculum.course} · ${subject.title}` : 'Sin asignatura'
}

function exerciseConceptLabel(exercise) {
  return compactExerciseConceptLabel(
    normalizeCurriculum(exercise?.curriculum).conceptIds,
    mathConceptNodes.value,
  )
}

function searchExerciseVersionIndex(exercise) {
  const selected = Number(exerciseSearchVersions.value[exercise?.id]) || 0
  return Math.min(Math.max(0, selected), exercise?.variaciones?.length || 0)
}

function setSearchExerciseVersion(exercise, version) {
  if (!exercise?.id) return
  exerciseSearchVersions.value[exercise.id] = Number(version) || 0
}

function searchExerciseVersion(exercise) {
  return exerciseVersion(exercise, searchExerciseVersionIndex(exercise)) || exercise
}

function searchExercisePdf(exercise) {
  return searchExerciseVersion(exercise)?.pdf?.enunciado || ''
}

function searchExercisePdfAspectRatio(exercise) {
  return Number(searchExerciseVersion(exercise)?.pdfLayout?.enunciado) || 0
}

function searchExerciseThumbnail(exercise) {
  return searchExerciseThumbnailMetadata(exercise)?.url || ''
}

function searchExerciseThumbnailMetadata(exercise) {
  const version = searchExerciseVersion(exercise)
  const thumbnail = version?.preview?.enunciado
  if (!thumbnail?.url) return null
  return !thumbnail.sourceUrl || thumbnail.sourceUrl === version?.pdf?.enunciado
    ? thumbnail
    : null
}

function searchExerciseThumbnailAspectRatio(exercise) {
  const thumbnail = searchExerciseThumbnailMetadata(exercise)
  const storedRatio = Number(thumbnail?.aspectRatio) || 0
  if (storedRatio > 0) return storedRatio
  const width = Number(thumbnail?.width) || 0
  const height = Number(thumbnail?.height) || 0
  if (width > 0 && height > 0) return width / height
  return searchExercisePdfAspectRatio(exercise)
}

function searchExerciseThumbnailStyle(exercise) {
  const aspectRatio = searchExerciseThumbnailAspectRatio(exercise)
  return aspectRatio > 0 ? { aspectRatio: String(aspectRatio) } : undefined
}

function revealSearchExerciseThumbnail(event) {
  event.currentTarget?.parentElement?.classList.add('is-loaded')
}

const pendingExerciseThumbnailWrites = new Set()

async function persistExerciseThumbnail(exercise, payload = {}) {
  if (!exercise?.id || searchExerciseVersionIndex(exercise) !== 0 || !payload?.blob) return
  const sourceUrl = searchExercisePdf(exercise)
  if (!sourceUrl || payload.source !== sourceUrl || pendingExerciseThumbnailWrites.has(exercise.id)) return
  pendingExerciseThumbnailWrites.add(exercise.id)
  try {
    const bytes = new Uint8Array(await payload.blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    const callable = httpsCallable(functions, 'saveExerciseThumbnail')
    const response = await callable({
      exerciseId: exercise.id,
      sourceUrl,
      imageBase64: btoa(binary),
      width: Number(payload.width) || 0,
      height: Number(payload.height) || 0,
      aspectRatio: Number(payload.aspectRatio) || searchExercisePdfAspectRatio(exercise),
    })
    const thumbnail = response.data
    exercise.preview = { ...(exercise.preview || {}), enunciado: thumbnail }
  } catch (error) {
    console.error('No se ha podido guardar la miniatura del ejercicio:', error)
  } finally {
    pendingExerciseThumbnailWrites.delete(exercise.id)
  }
}

function searchExerciseAuthors(exercise) {
  return exerciseVersionAuthors(exercise, searchExerciseVersionIndex(exercise))
}

const conceptMathDelimiterPattern = /(\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\])/g

function escapeConceptHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function exerciseConceptRichLabel(exercise) {
  const source = exerciseConceptLabel(exercise)
  let cursor = 0
  let rendered = ''
  conceptMathDelimiterPattern.lastIndex = 0
  for (const match of source.matchAll(conceptMathDelimiterPattern)) {
    rendered += escapeConceptHtml(source.slice(cursor, match.index))
    const expression = match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    rendered += katex.renderToString(expression, {
      displayMode: false,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'html',
    })
    cursor = match.index + match[0].length
  }
  return rendered + escapeConceptHtml(source.slice(cursor))
}

async function syncExerciseConceptIndex(exerciseId, previousConceptIds = [], nextConceptIds = [], existingBatch = null) {
  const previousClosure = exerciseConceptClosure(previousConceptIds)
  const nextClosure = exerciseConceptClosure(nextConceptIds)
  const additions = [...nextClosure].filter((id) => !previousClosure.has(id))
  const removals = [...previousClosure].filter((id) => !nextClosure.has(id))
  if (!additions.length && !removals.length) return
  const batch = existingBatch || writeBatch(db)
  additions.forEach((conceptId) => {
    const conceptReference = doc(db, 'especialidades', 'Matemáticas', 'conceptos', conceptId)
    batch.set(conceptReference, { conceptId }, { merge: true })
    batch.set(doc(conceptReference, 'ejercicios', exerciseId), { exerciseId, conceptId })
  })
  removals.forEach((conceptId) => {
    const conceptReference = doc(db, 'especialidades', 'Matemáticas', 'conceptos', conceptId)
    batch.delete(doc(conceptReference, 'ejercicios', exerciseId))
  })
  if (!existingBatch) await batch.commit()
}

function emptyTemplate() {
  return { id: null, nombre: '', descripcion: '', codigo: '', archivo: '' }
}

function emptyTeacherCenter() {
  return { id: crypto.randomUUID(), curso: '', centro: '', descripcion: '', imagenes: [] }
}

function normalizeTeacherProfile(profile) {
  const centros = Array.isArray(profile?.centros) ? profile.centros : []
  return {
    centros: centros.map((center) => ({
      id: center.id || crypto.randomUUID(),
      curso: String(center.curso || center.cursoAcademico || ''),
      centro: String(center.centro || center.nombre || ''),
      descripcion: String(center.descripcion || ''),
      imagenes: Array.isArray(center.imagenes) ? center.imagenes.filter((image) => image?.url).map((image) => ({
        id: image.id || crypto.randomUUID(),
        nombre: image.nombre || 'Logo',
        url: image.url,
        path: image.path || '',
      })) : [],
    })),
  }
}

function addTeacherCenter() {
  teacherProfileEditing.value = true
  const center = emptyTeacherCenter()
  teacherProfile.value.centros.push(center)
  teacherProfileEditingCenterId.value = center.id
  teacherProfileError.value = ''
}

function isTeacherCenterEditing(center) {
  return teacherProfileEditing.value && teacherProfileEditingCenterId.value === center.id
}

function editTeacherCenter(center) {
  teacherProfileEditing.value = true
  teacherProfileEditingCenterId.value = center.id
}

async function saveTeacherCenter(center) {
  await saveTeacherProfile()
  if (!teacherProfileError.value) {
    teacherProfileEditingCenterId.value = null
    teacherProfileEditing.value = false
  }
}

function removeTeacherCenter(center) {
  teacherProfile.value.centros = teacherProfile.value.centros.filter((item) => item.id !== center.id)
  if (teacherProfileEditingCenterId.value === center.id) {
    teacherProfileEditingCenterId.value = null
    teacherProfileEditing.value = false
  }
  saveTeacherProfile()
}

function openProfileImagePicker(center) {
  profileImageTarget.value = center
  profileImageInput.value?.click()
}

async function uploadProfileImages(event) {
  const center = profileImageTarget.value
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!center || !files.length) return
  isSavingTeacherProfile.value = true
  teacherProfileError.value = ''
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const imageId = crypto.randomUUID()
      const path = `teachers/${currentTeacherId.value}/profile/${center.id}/${imageId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const reference = storageRef(storage, path)
      await uploadBytes(reference, file, { contentType: file.type })
      const url = await getDownloadURL(reference)
      center.imagenes.push({ id: imageId, nombre: file.name, url, path })
    }
    await saveTeacherProfile()
  } catch (error) {
    teacherProfileError.value = 'No se han podido subir todas las imágenes.'
    console.error('Error al subir imágenes del perfil:', error)
  } finally {
    isSavingTeacherProfile.value = false
    profileImageTarget.value = null
  }
}

async function removeProfileImage(center, image) {
  center.imagenes = center.imagenes.filter((item) => item.id !== image.id)
  if (image.path) {
    try { await deleteObject(storageRef(storage, image.path)) } catch (error) { console.warn('No se pudo eliminar el logo anterior:', error) }
  }
  await saveTeacherProfile()
}

async function saveTeacherProfile() {
  isSavingTeacherProfile.value = true
  teacherProfileError.value = ''
  try {
    await setDoc(teacherDocument.value, { perfil: { centros: teacherProfile.value.centros } }, { merge: true })
  } catch (error) {
    teacherProfileError.value = 'No se ha podido guardar el perfil del profesor.'
    console.error('Error al guardar el perfil del profesor:', error)
  } finally {
    isSavingTeacherProfile.value = false
  }
}

async function toggleTeacherProfileEditing() {
  if (!teacherProfileEditing.value) {
    teacherProfileEditing.value = true
    return
  }
  await saveTeacherProfile()
  if (!teacherProfileError.value) teacherProfileEditing.value = false
}

const documentTemplateMetadataGuide = `% Añade los marcadores al final de las líneas donde se usan los argumentos:
% \\newcommand{\\logo}[4]{
%   \\textbf{#1} %% asignatura %%
%   \\hfill #4 / #2 / #3 %% grupo, título, fecha %%
% }

`

function preambleFileName(name) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plantilla'
  return `${normalized}.tex`
}

function templateCodeForCompiler(code = '') {
  return typeof code === 'string' ? code : String(code ?? '')
}

function templateCompilerFileName(template = {}) {
  const explicit = String(template.archivo || '').trim()
  const fallback = preambleFileName(template.nombre || 'plantilla')
  const name = explicit || fallback
  return /\.tex$/i.test(name) ? name : `${name}.tex`
}

async function syncTemplateWithCompiler(template, { retries = 1 } = {}) {
  const name = templateCompilerFileName(template)
  const content = templateCodeForCompiler(template.codigo)
  if (!content.trim()) throw new Error(`La plantilla «${template.nombre || name}» no tiene código.`)

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await compilerRequest('/preambles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      })
      return name
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => window.setTimeout(resolve, 350))
    }
  }
  throw new Error(`${template.nombre || name}: ${lastError?.message || 'error desconocido'}`)
}

function validateDocumentToolCommands(code = '') {
  const expectedArguments = { obligatorios: 0, optativos: 2, salto: 0 }
  const definitions = Object.fromEntries(Object.keys(expectedArguments).map((name) => [name, []]))
  const commandPattern = /\\(?:newcommand|renewcommand|providecommand)\s*\{\s*\\(obligatorios|optativos|salto)\s*\}\s*(?:\[(\d+)\])?/g
  const defPattern = /\\def\s*\\(obligatorios|optativos|salto)([^\{]*)\{/g

  for (const match of code.matchAll(commandPattern)) {
    definitions[match[1]].push(Number(match[2] || 0))
  }
  for (const match of code.matchAll(defPattern)) {
    definitions[match[1]].push(new Set(match[2].match(/#\d/g) || []).size)
  }

  const duplicated = Object.entries(definitions).filter(([, arities]) => arities.length > 1).map(([name]) => `\\${name}`)
  if (duplicated.length) return `Hay comandos de herramientas definidos más de una vez: ${duplicated.join(', ')}.`

  const incompatible = Object.entries(definitions)
    .filter(([name, arities]) => arities.length === 1 && arities[0] !== expectedArguments[name])
    .map(([name, arities]) => `\\${name} debe tener ${expectedArguments[name]} argumento${expectedArguments[name] === 1 ? '' : 's'}, pero tiene ${arities[0]}`)
  return incompatible.length ? `${incompatible.join('. ')}.` : ''
}

function exercisePreambleName() {
  const exerciseTemplate = templates.value.find((template) => {
    const name = template.nombre?.trim().toLocaleLowerCase('es')
    const file = template.archivo?.replace(/\.tex$/i, '').trim().toLocaleLowerCase('es')
    return name === 'ejercicio' || file === 'ejercicio'
  })
  return exerciseTemplate?.archivo || 'ejercicio.tex'
}

const exerciseRenderProfiles = Object.freeze({
  segment: 'segment',
  statement: 'statement',
  solved: 'solved',
})

function internalSegmentTemplate(code) {
  return `\\noindent
\\hspace*{2.5mm}
\\begin{minipage}{8.5cm}
\\vspace*{2.5mm}
${String(code || '').trim()}
\\par
\\vspace*{2.5mm}
\\end{minipage}
\\hspace*{2.5mm}`
}

function internalCompleteExerciseTemplate(code) {
  return `\\begin{ejercicios}\n${String(code || '').trim()}\n\\end{ejercicios}`
}

function codeForPreamble(code, profile = exerciseRenderProfiles.statement) {
  const compilableCode = normalizeDisplayMathDelimiters(stripExerciseDurationMetadata(code))
  const body = profile === exerciseRenderProfiles.segment
    ? internalSegmentTemplate(compilableCode)
    : internalCompleteExerciseTemplate(compilableCode)
  return `\\shorthandoff{<>}\n${body}`
}

function stripExerciseDurationMetadata(code = '') {
  return String(code || '')
    .replace(/(\\ej\b(?:\s*\\(?:M|P)\s*\{[^{}]*\})?\s*)\\T\s*\{[^{}]*\}/g, '$1')
    .replace(/(\\ap\b(?:\s*\\p\s*\{[^{}]*\})?\s*)\\t\s*\{[^{}]*\}/g, '$1')
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

function compilationArtifactLatex(errorMessage = '') {
  const structure = activeExerciseStructure.value
  const key = errorMessage.match(/Vista\s+([^:\n]+):/)?.[1] || ''
  const partMatch = key.match(/^parts\.([^.]+)\.(statement|workedSolution)\.pdf$/)
  let title = 'vista completa'
  let code = ''
  let profile = exerciseRenderProfiles.statement

  if (key === 'pdf.statement') {
    title = 'vista completa del enunciado'
    code = buildExerciseLatex(structure, {
      includeSolutions: false,
      includeAnswers: false,
      preserveApartadosEnvironment: true,
    })
  } else if (key === 'pdf.solved') {
    title = 'vista completa resuelta'
    profile = exerciseRenderProfiles.solved
    code = buildExerciseLatex(structure, {
      includeSolutions: true,
      includeAnswers: true,
      preserveApartadosEnvironment: false,
    })
  } else if (key === 'statement.pdf') {
    title = 'segmento del enunciado general'
    profile = exerciseRenderProfiles.segment
    code = buildExercisePartLatex(structure, null, {
      includeSolutions: false,
      includeAnswers: false,
    })
  } else if (key === 'workedSolution.pdf') {
    title = 'segmento resuelto del enunciado general'
    profile = exerciseRenderProfiles.segment
    code = buildExercisePartLatex(structure, null, {
      includeSolutions: true,
      includeAnswers: true,
    })
  } else if (partMatch) {
    const partIndex = structure.apartados.findIndex((part) => part.id === partMatch[1])
    const partLabel = partIndex >= 0 ? String.fromCharCode(97 + partIndex) : partMatch[1]
    const solved = partMatch[2] === 'workedSolution'
    profile = exerciseRenderProfiles.segment
    title = `apartado ${partLabel}${solved ? ' resuelto' : ''}`
    code = buildExercisePartLatex(structure, partMatch[1], {
      includeSolutions: solved,
      includeAnswers: solved,
    })
  } else {
    const solved = hasExerciseSolutions(activeExerciseCode.value)
    profile = solved ? exerciseRenderProfiles.solved : exerciseRenderProfiles.statement
    title = solved ? 'vista completa resuelta' : 'vista completa del enunciado'
    code = buildExerciseLatex(structure, {
      includeSolutions: solved,
      includeAnswers: solved,
      preserveApartadosEnvironment: !solved,
    })
  }

  const compilerCode = removeBlankLinesInsideAligned(codeForPreamble(code, profile))
  return { title, code: prettyPrintLatex(compilerCode) }
}

function compilationErrorWithLatex(error) {
  const rawMessage = typeof error === 'string' ? error : error?.message
  const message = !rawMessage || /^(?:firebase:\s*)?internal\.?$/i.test(rawMessage.trim())
    ? 'La función de compilación ha devuelto un error interno.'
    : rawMessage
  const source = compilationArtifactLatex(message)
  return `${message}\n\nLaTeX enviado al compilador (${source.title}):\n\n${source.code}`
}

async function copyTextToClipboard(value) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

async function copyCompilerError() {
  await copyTextToClipboard(compilerError.value)
}

function hasExerciseSolutions(code) {
  return /\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/.test(code)
}

function statementLatex(code) {
  return code
    .replace(/\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

function resolvedLatex(code) {
  return String(code || '')
    // La versión resuelta se compone en una sola columna. Algunos
    // preámbulos implementan \ap con un \columnbreak pensado para
    // apartadosc; aquí ese salto no es válido y debe ser inocuo.
    .replace(/\\begin\s*\{apartadosc\}/g, '\\begin{apartados}')
    .replace(/\\end\s*\{apartadosc\}/g, '\\end{apartados}')
    .replace(/^/,'\\def\\columnbreak{}\n')
}

function clearVersionPreview(version) {
  if (!version) return
  if (version.previewPdf) {
    Object.values(version.previewPdf).forEach((url) => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    })
    version.previewPdf = null
  }
  const structure = version.structure
  if (!structure) return
  ;[structure, ...(structure.apartados || [])].forEach((part) => {
    ;['previewPdfEnunciado', 'previewPdfSolucion'].forEach((field) => {
      if (part[field]?.startsWith('blob:')) URL.revokeObjectURL(part[field])
      delete part[field]
    })
  })
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

function setPartPreviewPdf(part, field, blob = null) {
  const previousUrl = part?.[field]
  if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
  if (part) part[field] = blob ? URL.createObjectURL(blob) : null
}

async function compilerRequest(path, options = {}) {
  const token = await auth.currentUser?.getIdToken()
  const response = await fetch(`${compilerBaseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
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

async function loadExercises({ reset = false } = {}) {
  // Los eventos de scroll y búsqueda siguen activos mientras se muestra el
  // acceso. No consultamos Firestore hasta disponer de una sesión docente;
  // las reglas rechazan correctamente cualquier lectura anónima.
  if (!currentTeacherId.value) return
  if (reset && isLoadingExercises.value) return
  if (!reset && (isLoadingMoreExercises.value || !hasMoreExercises.value)) return
  if (reset) {
    isLoadingExercises.value = true
    exercisesError.value = ''
    lastExerciseDocument = null
    hasMoreExercises.value = true
  } else {
    isLoadingMoreExercises.value = true
  }
  try {
    const constraints = [orderBy(documentId()), firestoreLimit(exerciseBatchSize)]
    if (lastExerciseDocument) constraints.splice(1, 0, startAfter(lastExerciseDocument))
    const snapshot = await getDocs(firestoreQuery(collection(db, 'ejercicios'), ...constraints))
    const loadedExercises = snapshot.docs.map((exercise) => normalizeExercise({ id: exercise.id, ...exercise.data() }))
    if (reset) {
      exercises.value = loadedExercises
    } else {
      const byId = new Map(exercises.value.map((exercise) => [exercise.id, exercise]))
      loadedExercises.forEach((exercise) => byId.set(exercise.id, exercise))
      // La consulta ya llega ordenada por documentId y cada página comienza
      // después de la anterior. Conservar el orden de inserción permite añadir
      // la tanda al final sin recolocar las tarjetas que ya estaban visibles.
      exercises.value = [...byId.values()]
    }
    lastExerciseDocument = snapshot.docs.at(-1) || lastExerciseDocument
    hasMoreExercises.value = snapshot.size === exerciseBatchSize
  } catch (error) {
    exercisesError.value = reset
      ? 'No se han podido cargar los ejercicios de Firestore.'
      : 'No se han podido cargar más ejercicios de Firestore.'
    console.error('Error al cargar ejercicios:', error)
  } finally {
    if (reset) isLoadingExercises.value = false
    else isLoadingMoreExercises.value = false
  }
}

function loadNextExerciseBatch() {
  if (!currentTeacherId.value) return
  if (active.value !== 'Ejercicios' || exerciseView.value !== 'search') return
  void loadExercises()
}

function handleExerciseScroll() {
  if (exerciseScrollFrame) return
  exerciseScrollFrame = window.requestAnimationFrame(() => {
    exerciseScrollFrame = 0
    if (!currentTeacherId.value) return
    if (active.value !== 'Ejercicios' || exerciseView.value !== 'search') return
    const scrollingElement = document.scrollingElement || document.documentElement
    const distanceToBottom = scrollingElement.scrollHeight - scrollingElement.scrollTop - scrollingElement.clientHeight
    if (distanceToBottom <= 420) loadNextExerciseBatch()
  })
}

watch(exerciseSearchQuery, async () => {
  await nextTick()
  handleExerciseScroll()
})

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
    templates.value = metadataSnapshot.docs.map((template) => {
      const data = template.data()
      return {
        id: template.id,
        archivo: templateCompilerFileName({ archivo: data.archivo, nombre: data.nombre }),
        nombre: data.nombre || 'Plantilla',
        descripcion: data.descripcion || '',
        codigo: data.codigo || '',
      }
    })
    templates.value.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    if (!selectedPreamble.value && templates.value.length) selectedPreamble.value = templates.value[0].archivo

    // El servicio de compilación escribe cada preámbulo en disco. Las peticiones
    // concurrentes podían perderse entre sí (y ocultaban qué plantilla fallaba),
    // por lo que sincronizamos de forma ordenada y reintentamos errores transitorios.
    const failures = []
    for (const template of templates.value) {
      try {
        const archivo = await syncTemplateWithCompiler(template)
        if (template.archivo !== archivo) template.archivo = archivo
      } catch (error) {
        failures.push(error.message)
        console.error('Error al sincronizar plantilla con el compilador:', error)
      }
    }
    if (failures.length) {
      templatesError.value = `Las plantillas se han cargado desde Firestore, pero no se han podido sincronizar ${failures.length} con el servidor LaTeX: ${failures.join(' · ')}`
    }
  } catch (error) {
    templatesError.value = 'No se han podido cargar las plantillas de Firestore.'
    console.error('Error al cargar plantillas:', error)
  } finally {
    isLoadingTemplates.value = false
  }
}

function selectExercise(exercise) {
  selectedExerciseId.value = exercise.id
  exerciseView.value = 'search'
}

function stopWatchingExerciseCompilation() {
  stopExerciseCompilationWatch?.()
  stopExerciseCompilationWatch = null
}

function copyCompiledStructureReferences(target, source) {
  if (!target || !source) return
  target.pdfenunciado = source.pdfenunciado || ''
  target.pdfsolucion = source.pdfsolucion || null
  target.pdfenunciadocompleto = source.pdfenunciadocompleto || ''
  target.pdfsolucioncompleto = source.pdfsolucioncompleto || null
  const sourceParts = new Map((source.apartados || []).map((part) => [part.id, part]))
  ;(target.apartados || []).forEach((part, index) => {
    const compiled = sourceParts.get(part.id) || source.apartados?.[index]
    if (!compiled) return
    part.pdfenunciado = compiled.pdfenunciado || ''
    part.pdfsolucion = compiled.pdfsolucion || null
  })
}

function copyPreviewStructureReferences(target, source) {
  if (!target || !source) return
  target.previewPdfEnunciado = source.previewPdfEnunciado || null
  target.previewPdfSolucion = source.previewPdfSolucion || null
  const sourceParts = new Map((source.apartados || []).map((part) => [part.id, part]))
  ;(target.apartados || []).forEach((part, index) => {
    const preview = sourceParts.get(part.id) || source.apartados?.[index]
    if (!preview) return
    part.previewPdfEnunciado = preview.previewPdfEnunciado || null
    part.previewPdfSolucion = preview.previewPdfSolucion || null
  })
}

function updateExerciseListFromSnapshot(snapshot) {
  if (!snapshot.exists()) return null
  const normalized = normalizeExercise({ id: snapshot.id, ...snapshot.data() })
  const listIndex = exercises.value.findIndex((exercise) => exercise.id === snapshot.id)
  if (listIndex >= 0) exercises.value[listIndex] = normalized
  else exercises.value.push(normalized)
  return normalized
}

function watchExerciseCompilationInList(exerciseId) {
  if (!exerciseId || exerciseCompilationListWatches.has(exerciseId)) return
  const unsubscribe = onSnapshot(doc(db, 'ejercicios', exerciseId), (snapshot) => {
    const normalized = updateExerciseListFromSnapshot(snapshot)
    const status = normalized?.compilation?.status
    if (!['ready', 'error'].includes(status)) return
    exerciseCompilationListWatches.get(exerciseId)?.()
    exerciseCompilationListWatches.delete(exerciseId)
  }, (error) => {
    console.error('Error al actualizar la compilación en el buscador:', error)
    exerciseCompilationListWatches.delete(exerciseId)
  })
  exerciseCompilationListWatches.set(exerciseId, unsubscribe)
}

function watchExerciseCompilation(exerciseId) {
  stopWatchingExerciseCompilation()
  if (!exerciseId) return
  stopExerciseCompilationWatch = onSnapshot(doc(db, 'ejercicios', exerciseId), (snapshot) => {
    const normalized = updateExerciseListFromSnapshot(snapshot)
    if (!normalized) return
    if (exerciseEditor.value.id !== exerciseId) return

    exerciseEditor.value.pdf = normalized.pdf
    exerciseEditor.value.compilation = normalized.compilation
    exerciseEditor.value.revision = normalized.revision
    copyCompiledStructureReferences(exerciseEditor.value.structure, normalized.structure)
    normalized.variaciones.forEach((variation, index) => {
      const current = exerciseEditor.value.variaciones[index]
      if (!current) return
      current.pdf = variation.pdf
      current.compilation = variation.compilation
      current.revision = variation.revision
      copyCompiledStructureReferences(current.structure, variation.structure)
    })

    const target = selectedExerciseVersion.value === 0
      ? normalized
      : normalized.variaciones[selectedExerciseVersion.value - 1]
    const status = target?.compilation?.status || normalized.compilation?.status || 'ready'
    exerciseCompilationStatus.value = status
    if (status === 'error') {
      compilerError.value = compilationErrorWithLatex(
        target?.compilation?.error || normalized.compilation?.error || 'No se ha podido compilar el ejercicio.',
      )
    }
    if (['ready', 'error'].includes(status)) isCompiling.value = false
  }, (error) => {
    console.error('Error al seguir la compilación del ejercicio:', error)
    isCompiling.value = false
  })
}

function destroyLatexEditor() {
  latexCodeEditor?.destroy()
  latexCodeEditor = null
}

function destroyTemplateEditor() {
  templateCodeEditor?.destroy()
  templateCodeEditor = null
}

function hiddenExerciseMarkerDecorations(view) {
  const decorations = []
  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    if (/^\s*%\s*neope:part\s+id=[A-Za-z0-9_-]+\s*$/.test(line.text)) {
      decorations.push(Decoration.line({ attributes: { class: 'cm-neope-marker-line' } }).range(line.from))
    }
  }
  return Decoration.set(decorations)
}

const hiddenExerciseMarkers = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = hiddenExerciseMarkerDecorations(view)
  }

  update(update) {
    if (update.docChanged || update.viewportChanged) this.decorations = hiddenExerciseMarkerDecorations(update.view)
  }
}, { decorations: (plugin) => plugin.decorations })

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
          hiddenExerciseMarkers,
          latex({ enableAutocomplete: false, autoCloseBrackets: true, autoCloseTags: true, enableTooltips: true }),
          autocompletion({ override: [latexCompletion] }),
          keymap.of([
            indentWithTab,
            { key: 'Mod-s', run: () => { refreshLatexRender(); return true } },
            { key: 'Ctrl-s', run: () => { refreshLatexRender(); return true } },
            { key: 'Mod-f', run: () => { formatExerciseLatex(); return true } },
            { key: 'Ctrl-f', run: () => { formatExerciseLatex(); return true } },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              activeExerciseVersion.value.enunciado = update.state.doc.toString()
              syncStructureFromCode(activeExerciseVersion.value)
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
  templateEditor.value = { ...emptyTemplate(), codigo: documentTemplateMetadataGuide }
  isEditingTemplate.value = true
  mountTemplateEditor()
}

function chooseTemplateFile() {
  if (!templateFileInput.value) return
  templateFileInput.value.value = ''
  templateFileInput.value.click()
}

async function importTemplateFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.tex$/i.test(file.name)) {
    templatesError.value = 'Solo se pueden importar archivos LaTeX con extensión .tex.'
    return
  }
  try {
    const code = await file.text()
    selectedTemplateId.value = null
    templateEditor.value = {
      id: null,
      nombre: file.name.replace(/\.tex$/i, ''),
      descripcion: '',
      codigo: code,
      archivo: file.name,
    }
    isEditingTemplate.value = true
    templatesError.value = ''
    mountTemplateEditor()
  } catch (error) {
    templatesError.value = 'No se ha podido leer el archivo seleccionado.'
    console.error('Error al importar plantilla:', error)
  }
}

function selectTemplate(template) {
  selectedTemplateId.value = template.id
  templateEditor.value = { ...template }
  isEditingTemplate.value = true
  mountTemplateEditor()
}

async function saveTemplate() {
  if (!templateEditor.value.nombre.trim() || !templateEditor.value.codigo.trim()) return
  const toolCommandError = validateDocumentToolCommands(templateEditor.value.codigo)
  if (toolCommandError) {
    templatesError.value = toolCommandError
    return
  }
  isSavingTemplate.value = true
  templatesError.value = ''
  try {
    const reference = templateEditor.value.id
      ? doc(db, 'plantillas', templateEditor.value.id)
      : doc(collection(db, 'plantillas'))
    const archivo = templateCompilerFileName(templateEditor.value)
    const data = {
      id: reference.id,
      archivo,
      nombre: templateEditor.value.nombre.trim(),
      descripcion: templateEditor.value.descripcion.trim(),
      codigo: templateEditor.value.codigo,
    }
    await setDoc(reference, data)
    const index = templates.value.findIndex((template) => template.id === reference.id)
    if (index === -1) templates.value.push(data)
    else templates.value[index] = data
    templates.value.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    selectedTemplateId.value = reference.id
    templateEditor.value = { ...data }
    try {
      await syncTemplateWithCompiler(data)
    } catch (error) {
      templatesError.value = 'La plantilla se ha guardado en Firestore, pero no se ha podido sincronizar con el servidor LaTeX. Se reintentará al volver a cargar la aplicación.'
      console.error('Error al sincronizar plantilla:', error)
    }
  } catch (error) {
    templatesError.value = 'No se ha podido guardar la plantilla en Firestore.'
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
    const templateToDelete = { ...selectedTemplate.value }
    await deleteDoc(doc(db, 'plantillas', templateToDelete.id))
    templates.value = templates.value.filter((template) => template.id !== templateToDelete.id)
    selectedTemplateId.value = null
    templateEditor.value = emptyTemplate()
    isEditingTemplate.value = false
    destroyTemplateEditor()
    try {
      await compilerRequest(`/preambles/${encodeURIComponent(templateToDelete.archivo)}`, { method: 'DELETE' })
    } catch (error) {
      templatesError.value = 'La plantilla se ha eliminado de Firestore, pero no se ha podido retirar del servidor LaTeX.'
      console.error('Error al eliminar la plantilla del compilador:', error)
    }
  } catch (error) {
    templatesError.value = 'No se ha podido eliminar la plantilla de Firestore.'
    console.error('Error al eliminar plantilla:', error)
  } finally {
    isSavingTemplate.value = false
  }
}

function openNewExercise() {
  stopWatchingExerciseCompilation()
  selectedExerciseId.value = null
  exerciseEditor.value = emptyExercise()
  exerciseEditorTab.value = 'code'
  exerciseContentTarget.value = null
  exerciseCompetencyTarget.value = null
  sessionUploadedAttachmentPaths.clear()
  pendingDeletedAttachments.splice(0)
  selectedExerciseVersion.value = 0
  compilerError.value = ''
  exercisePreviewTab.value = 'statement'
  exercisePreviewMode.value = 'segmented'
  exerciseView.value = 'edit'
  mountLatexEditor()
}

function editExercise(exercise = selectedExercise.value) {
  if (!exercise) return
  selectedExerciseId.value = exercise.id
  exerciseEditor.value = normalizeExercise(exercise)
  exerciseEditorTab.value = 'code'
  exerciseContentTarget.value = null
  exerciseCompetencyTarget.value = null
  sessionUploadedAttachmentPaths.clear()
  pendingDeletedAttachments.splice(0)
  selectedExerciseVersion.value = 0
  compilerError.value = ''
  exercisePreviewTab.value = 'statement'
  exercisePreviewMode.value = 'segmented'
  exerciseView.value = 'edit'
  exerciseCompilationStatus.value = exerciseEditor.value.compilation?.status || 'ready'
  isCompiling.value = ['queued', 'compiling'].includes(exerciseCompilationStatus.value)
  watchExerciseCompilation(exercise.id)
  mountLatexEditor()
}

async function cancelExerciseEdit() {
  stopWatchingExerciseCompilation()
  destroyLatexEditor()
  clearExercisePreviews()
  await cleanupSessionExerciseFiles()
  pendingDeletedAttachments.splice(0)
  exerciseView.value = 'search'
  exerciseEditor.value = emptyExercise()
  exerciseContentTarget.value = null
  exerciseCompetencyTarget.value = null
  selectedExerciseVersion.value = 0
  exercisePreviewMode.value = 'segmented'
}

function selectExerciseEditorTab(tab) {
  exerciseEditorTab.value = tab
  if (tab === 'contents' && exerciseContentTarget.value === null) {
    exerciseContentTarget.value = activeExerciseHasSections.value ? 0 : 'exercise'
  }
  if (tab === 'competencies' && exerciseCompetencyTarget.value === null) {
    exerciseCompetencyTarget.value = activeExerciseHasSections.value ? 0 : 'exercise'
  }
  if (tab === 'code') nextTick(() => latexCodeEditor?.requestMeasure())
}

const exerciseContentModel = computed({
  get() {
    const structure = activeExerciseStructure.value
    const target = exerciseContentTarget.value
    const conceptIds = typeof target === 'number'
      ? structure.apartados[target]?.contenidos || []
      : target === 'global' && structure.apartados.length
        ? aggregateExerciseStructure(structure).contenidos
        : structure.contenidos || []
    return {
      ...normalizeCurriculum(exerciseEditor.value.curriculum),
      conceptIds: [...conceptIds],
    }
  },
  set(value) {
    const normalized = normalizeCurriculum(value)
    const structure = activeExerciseStructure.value
    const target = exerciseContentTarget.value
    if (target === 'global' && structure.apartados.length) {
      const previousCompleteConcepts = new Set(aggregateExerciseStructure(structure).contenidos)
      const nextCompleteConcepts = new Set(normalized.conceptIds)
      const addedConcepts = normalized.conceptIds.filter((conceptId) => !previousCompleteConcepts.has(conceptId))
      const removedConcepts = new Set([...previousCompleteConcepts].filter((conceptId) => !nextCompleteConcepts.has(conceptId)))
      structure.contenidosGenerales = [...new Set([
        ...(structure.contenidosGenerales || []).filter((conceptId) => !removedConcepts.has(conceptId)),
        ...addedConcepts,
      ])]
      structure.apartados.forEach((apartado) => {
        apartado.contenidos = [...new Set([
          ...(apartado.contenidos || []).filter((conceptId) => !removedConcepts.has(conceptId)),
          ...addedConcepts,
          ...structure.contenidosGenerales,
        ])]
      })
    } else if (typeof target === 'number' && structure.apartados[target]) {
      structure.apartados[target].contenidos = [...new Set([
        ...normalized.conceptIds,
        ...(structure.contenidosGenerales || []),
      ])]
    } else {
      structure.contenidos = [...normalized.conceptIds]
    }
    activeExerciseVersion.value.structure = aggregateExerciseStructure(structure)
    exerciseEditor.value.curriculum = {
      ...normalized,
      conceptIds: [...activeExerciseVersion.value.structure.contenidos],
    }
  },
})

function syncStructureFromCode(version = activeExerciseVersion.value) {
  const analysis = analyzeExerciseLatex(version.enunciado || '', version.structure || {})
  version.analysis = { valid: analysis.valid, ambiguous: analysis.ambiguous }
  if (!analysis.valid) return version.structure
  version.structure = mergeExerciseStructure(analysis.structure, version.structure || {})
  if (version === exerciseEditor.value) {
    exerciseEditor.value.curriculum = {
      ...normalizeCurriculum(exerciseEditor.value.curriculum),
      conceptIds: [...version.structure.contenidos],
    }
  }
  return version.structure
}

function replaceActiveExerciseCode(code, structure = null) {
  const version = activeExerciseVersion.value
  version.enunciado = code
  version.structure = structure || mergeExerciseStructure(parseExerciseLatex(code), version.structure || {})
  version.renderedLatex = ''
  if (latexCodeEditor && exerciseEditorTab.value === 'code') {
    latexCodeEditor.dispatch({ changes: { from: 0, to: latexCodeEditor.state.doc.length, insert: code } })
  }
}

function rebuildActiveExerciseCode() {
  const structure = aggregateExerciseStructure(activeExerciseStructure.value)
  replaceActiveExerciseCode(buildExerciseLatex(structure, { preserveApartadosEnvironment: true }), structure)
  if (activeExerciseVersion.value === exerciseEditor.value) {
    exerciseEditor.value.curriculum = {
      ...normalizeCurriculum(exerciseEditor.value.curriculum),
      conceptIds: [...structure.contenidos],
    }
  }
}

function updateExerciseMetric(field, value, apartadoIndex = null) {
  const number = Math.max(0, Number(value) || 0)
  const structure = activeExerciseStructure.value
  if (typeof apartadoIndex === 'number' && structure.apartados[apartadoIndex]) {
    structure.apartados[apartadoIndex][field] = field === 'puntuacion' ? Math.round(number * 4) / 4 : Math.round(number)
  } else if (!structure.apartados.length) {
    structure[field] = field === 'puntuacion' ? Math.round(number * 4) / 4 : Math.round(number)
  }
  activeExerciseVersion.value.structure = aggregateExerciseStructure(structure)
  rebuildActiveExerciseCode()
}

function selectExercisePartContents(apartadoIndex) {
  exerciseContentTarget.value = apartadoIndex
  selectExerciseEditorTab('contents')
}

function selectExercisePartCompetencies(apartadoIndex = null) {
  exerciseCompetencyTarget.value = typeof apartadoIndex === 'number'
    ? apartadoIndex
    : activeExerciseHasSections.value ? 0 : 'exercise'
  selectExerciseEditorTab('competencies')
}

function updateExerciseCompetencies(structure) {
  activeExerciseVersion.value.structure = aggregateExerciseStructure(structure)
  const hasAchievements = [
    ...(activeExerciseVersion.value.structure.achievements || []),
    ...(activeExerciseVersion.value.structure.apartados || []).flatMap((part) => part.achievements || []),
  ].length > 0
  if (hasAchievements) exerciseEditor.value.curriculum.competencial = true
}

function selectedCompetencyTargetLabel() {
  if (typeof exerciseCompetencyTarget.value === 'number') {
    return `Competencias del apartado ${String.fromCharCode(97 + exerciseCompetencyTarget.value)}`
  }
  return 'Competencias del ejercicio'
}

function selectedContentTargetLabel() {
  if (typeof exerciseContentTarget.value === 'number') {
    return `Contenidos del apartado ${String.fromCharCode(97 + exerciseContentTarget.value)}`
  }
  return exerciseContentTarget.value === 'global'
    ? 'Contenidos del ejercicio completo'
    : 'Contenidos del ejercicio'
}

function partPdfUrl(apartado, solved = false) {
  return solved
    ? apartado?.previewPdfSolucion || apartado?.pdfsolucion || ''
    : apartado?.previewPdfEnunciado || apartado?.pdfenunciado || ''
}

function mainPartPdfUrl(solved = false) {
  const structure = activeExerciseStructure.value
  return solved
    ? structure.previewPdfSolucion || structure.pdfsolucion || ''
    : structure.previewPdfEnunciado || structure.pdfenunciado || ''
}

const latexCompactEnvironments = new Set([
  'align', 'align*', 'aligned', 'alignedat', 'array', 'bmatrix', 'bmatrix*',
  'cases', 'det', 'detp', 'gather', 'gather*', 'gathered', 'matrix', 'matrix*',
  'matriz', 'matrizb', 'matrizp', 'matrizv', 'pmatrix', 'pmatrix*', 'smallmatrix',
  'split', 'Vmatrix', 'vmatrix',
])
const latexVerbatimEnvironments = new Set(['Verbatim', 'lstlisting', 'minted', 'verbatim'])

function latexEnvironmentTokens(line) {
  return [...line.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/g)].map((match) => ({
    type: match[1],
    name: match[2].trim(),
  }))
}

function removeLatexEnvironment(stack, name) {
  const index = stack.lastIndexOf(name)
  if (index >= 0) stack.splice(index, 1)
}

function compactLatexBlockIsOpen(stack) {
  return stack.some((name) => latexCompactEnvironments.has(name))
}

function prettyPrintLatex(source) {
  const indent = '    '
  const stack = []
  const output = []
  let pendingBlankLine = false
  let verbatimEnvironment = null

  for (const originalLine of String(source || '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = originalLine.trim()

    if (verbatimEnvironment) {
      const closesVerbatim = latexEnvironmentTokens(originalLine)
        .some(({ type, name }) => type === 'end' && name === verbatimEnvironment)
      if (!closesVerbatim) {
        output.push(originalLine)
        continue
      }
      removeLatexEnvironment(stack, verbatimEnvironment)
      output.push(`${indent.repeat(stack.length)}${trimmed}`)
      verbatimEnvironment = null
      continue
    }

    if (!trimmed) {
      if (output.length && !compactLatexBlockIsOpen(stack)) pendingBlankLine = true
      continue
    }

    const tokens = latexEnvironmentTokens(trimmed)
    const leadingEnds = []
    let remainingPrefix = trimmed
    while (true) {
      const match = remainingPrefix.match(/^\\end\s*\{([^{}]+)\}\s*/)
      if (!match) break
      const name = match[1].trim()
      leadingEnds.push(name)
      removeLatexEnvironment(stack, name)
      remainingPrefix = remainingPrefix.slice(match[0].length)
    }

    if (pendingBlankLine) {
      const closesCompactBlock = leadingEnds.some((name) => latexCompactEnvironments.has(name))
      if (!closesCompactBlock && output.at(-1) !== '') output.push('')
      pendingBlankLine = false
    }

    output.push(`${indent.repeat(stack.length)}${trimmed}`)

    let skippedLeadingEnds = 0
    for (const token of tokens) {
      if (token.type === 'end' && skippedLeadingEnds < leadingEnds.length) {
        skippedLeadingEnds += 1
        continue
      }
      if (token.type === 'begin') {
        stack.push(token.name)
        if (latexVerbatimEnvironments.has(token.name)) verbatimEnvironment = token.name
      } else {
        removeLatexEnvironment(stack, token.name)
      }
    }
  }

  return output.join('\n')
}

function formattedCursorOffset(text, lineNumber, column) {
  const lines = text.split('\n')
  const targetLine = Math.min(Math.max(lineNumber, 1), lines.length)
  const lineStart = lines.slice(0, targetLine - 1).reduce((total, line) => total + line.length + 1, 0)
  return lineStart + Math.min(column, lines[targetLine - 1].length)
}

function formatExerciseLatex() {
  if (!latexCodeEditor) return
  const source = latexCodeEditor.state.doc.toString()
  const formatted = prettyPrintLatex(source)
  if (formatted === source) {
    latexCodeEditor.focus()
    return
  }

  const selection = latexCodeEditor.state.selection.main
  const anchorLine = latexCodeEditor.state.doc.lineAt(selection.anchor)
  const headLine = latexCodeEditor.state.doc.lineAt(selection.head)
  latexCodeEditor.dispatch({
    changes: { from: 0, to: source.length, insert: formatted },
    selection: {
      anchor: formattedCursorOffset(formatted, anchorLine.number, selection.anchor - anchorLine.from),
      head: formattedCursorOffset(formatted, headLine.number, selection.head - headLine.from),
    },
    scrollIntoView: true,
  })
  latexCodeEditor.focus()
}

function ensureExerciseId() {
  if (!exerciseEditor.value.id) exerciseEditor.value.id = doc(collection(db, 'ejercicios')).id
  return exerciseEditor.value.id
}

function nextExerciseImageNumber() {
  const numbers = [...exerciseEditor.value.archivos, ...pendingDeletedAttachments]
    .map((file) => Number(String(file.latexName || '').match(/^imagen(\d+)$/)?.[1]) || 0)
  return Math.max(0, ...numbers) + 1
}

function openExerciseFilePicker() {
  exerciseAttachmentInput.value?.click()
}

async function uploadExerciseFiles(event) {
  const files = [...(event?.target?.files || [])]
  if (!files.length || isUploadingExerciseFiles.value) return
  isUploadingExerciseFiles.value = true
  exercisesError.value = ''
  try {
    const exerciseId = ensureExerciseId()
    const rejected = []
    let imageNumber = nextExerciseImageNumber()
    for (const file of files) {
      const extension = exerciseImageExtension(file)
      if (!extension || file.size > 5 * 1024 * 1024) {
        rejected.push(file.name)
        continue
      }
      const latexName = `imagen${imageNumber}`
      const compilerName = `${latexName}.${extension}`
      const path = `ejercicios/${exerciseId}/archivos/${compilerName}`
      const reference = storageRef(storage, path)
      await uploadBytes(reference, file, {
        contentType: file.type || 'application/octet-stream',
        customMetadata: { exerciseId, originalName: file.name, latexName, compilerName },
      })
      const url = await getDownloadURL(reference)
      exerciseEditor.value.archivos.push({
        id: latexName,
        nombre: compilerName,
        originalName: file.name,
        latexName,
        compilerName,
        path,
        url,
        type: file.type || 'application/octet-stream',
        size: file.size,
      })
      sessionUploadedAttachmentPaths.add(path)
      imageNumber += 1
    }
    if (rejected.length) exercisesError.value = `No se han añadido: ${rejected.join(', ')}. Usa PNG, JPG o PDF de hasta 5 MB.`
  } catch (error) {
    exercisesError.value = error.message || 'No se han podido subir los archivos.'
    console.error('Error al subir archivos del ejercicio:', error)
  } finally {
    if (event?.target) event.target.value = ''
    isUploadingExerciseFiles.value = false
  }
}

async function removeExerciseFile(file) {
  exerciseEditor.value.archivos = exerciseEditor.value.archivos.filter((item) => item.path !== file.path)
  if (sessionUploadedAttachmentPaths.has(file.path)) {
    sessionUploadedAttachmentPaths.delete(file.path)
    try { await deleteObject(storageRef(storage, file.path)) } catch (error) { console.warn('No se ha podido retirar el archivo recién subido:', error) }
    return
  }
  pendingDeletedAttachments.push(file)
}

async function cleanupSessionExerciseFiles() {
  const paths = [...sessionUploadedAttachmentPaths]
  sessionUploadedAttachmentPaths.clear()
  await Promise.all(paths.map(async (path) => {
    try { await deleteObject(storageRef(storage, path)) } catch (error) { console.warn('No se ha podido limpiar un archivo temporal:', error) }
  }))
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clearExerciseCurriculumFilters() {
  exerciseSearchCurriculum.value = emptyCurriculum()
}

function selectExerciseVersion(version) {
  if (version === null || version < 0 || version > exerciseEditor.value.variaciones.length) return
  selectedExerciseVersion.value = version
  exerciseContentTarget.value = null
  exerciseCompetencyTarget.value = null
  exerciseCompilationStatus.value = activeExerciseVersion.value.compilation?.status || exerciseEditor.value.compilation?.status || 'ready'
  isCompiling.value = ['queued', 'compiling'].includes(exerciseCompilationStatus.value)
  exercisePreviewTab.value = compiledSolutionPdfUrl.value && exercisePreviewTab.value === 'solution' ? 'solution' : 'statement'
  if (!activeExerciseHasSections.value) exercisePreviewMode.value = 'complete'
  compilerError.value = ''
  mountLatexEditor()
}

function setExercisePreviewMode(mode) {
  if (!['complete', 'segmented'].includes(mode)) return
  exercisePreviewMode.value = mode
}

function deleteSelectedVariation() {
  const index = selectedExerciseVersion.value - 1
  if (index < 0 || index >= exerciseEditor.value.variaciones.length) return
  const [deletedVariation] = exerciseEditor.value.variaciones.splice(index, 1)
  clearVersionPreview(deletedVariation)
  selectedExerciseVersion.value = 0
  exercisePreviewTab.value = 'statement'
  exercisePreviewMode.value = activeExerciseHasSections.value ? 'segmented' : 'complete'
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
        curriculum: exerciseAiCurriculum(),
        previousAttempt,
        compileError,
      })
      const candidate = removeBlankLinesInsideAligned(response.data?.enunciado?.trim() || '')
      if (!candidate) throw new Error('La IA no ha devuelto un ejercicio resuelto válido.')

      try {
        solutionPdf = await compilePdfBlob(resolvedLatex(candidate), preambleName, undefined, exerciseRenderProfiles.solved)
        statementPdf = await compilePdfBlob(statementLatex(candidate), preambleName, undefined, exerciseRenderProfiles.statement)
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

    const generatedStructure = mergeExerciseStructure(
      parseExerciseLatex(solvedExercise),
      activeExerciseVersion.value.structure || {},
    )
    activeExerciseVersion.value.enunciado = solvedExercise
    activeExerciseVersion.value.structure = generatedStructure
    activeExerciseVersion.value.renderedLatex = ''
    activeExerciseVersion.value.solucionIA = true
    setActivePreviewPdf('enunciado', URL.createObjectURL(statementPdf))
    setActivePreviewPdf('resuelto', URL.createObjectURL(solutionPdf))
    mountLatexEditor()
    exercisePreviewTab.value = 'solution'
    await compileExerciseSolutionPreviews(solvedExercise, generatedStructure, preambleName, { compileFull: false })
    const queued = await refreshLatexRender({ preservePreviews: true, preferredPreviewTab: 'solution' })
    if (!queued) throw new Error(compilerError.value || 'La solución se ha generado, pero no se ha podido guardar y encolar su compilación.')
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
    const pdf = { ...exerciseEditor.value.pdf, resuelto: null }
    const structure = mergeExerciseStructure(parseExerciseLatex(codeWithoutSolution), exerciseEditor.value.structure || {})
    structure.solucion = ''
    structure.pdfsolucion = null
    structure.pdfsolucioncompleto = null
    setPartPreviewPdf(structure, 'previewPdfSolucion')
    structure.apartados.forEach((apartado) => {
      apartado.solucion = ''
      apartado.pdfsolucion = null
      setPartPreviewPdf(apartado, 'previewPdfSolucion')
    })

    exerciseEditor.value.enunciado = codeWithoutSolution
    exerciseEditor.value.solucionIA = false
    exerciseEditor.value.pdf = pdf
    exerciseEditor.value.structure = aggregateExerciseStructure(structure)
    exerciseEditor.value.renderedLatex = codeWithoutSolution
    setActivePreviewPdf('resuelto', null)
    exercisePreviewTab.value = 'statement'
    compilerError.value = ''
    mountLatexEditor()
    await refreshLatexRender()
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido eliminar la solución.'
    console.error('Error al eliminar solución:', error)
  } finally {
    isDeletingSolution.value = false
  }
}

async function generateExercisePartSolution(apartadoIndex) {
  const structure = activeExerciseStructure.value
  const apartado = structure.apartados[apartadoIndex]
  if (!apartado || apartado.solucion?.trim() || isGeneratingPartSolution.value !== null) return
  if (!isAppCheckConfigured) {
    exercisesError.value = 'App Check no está configurado en este entorno. Añade VITE_FIREBASE_APP_CHECK_KEY y registra el token de depuración de localhost en Firebase.'
    return
  }

  isGeneratingPartSolution.value = apartadoIndex
  exercisesError.value = ''
  try {
    const generateSolution = httpsCallable(functions, 'generateExerciseSolution', { timeout: 120_000 })
    const focusedStructure = {
      ...structure,
      apartados: [{ ...apartado }],
      final: '',
    }
    const sourceExercise = buildExerciseLatex(focusedStructure, { includeSolutions: false, includeAnswers: true })
    const response = await generateSolution({
      enunciado: sourceExercise,
      model: selectedAiModel.value,
      curriculum: exerciseAiCurriculum(),
      previousAttempt: '',
      compileError: '',
    })
    const candidate = removeBlankLinesInsideAligned(response.data?.enunciado?.trim() || '')
    if (!candidate) throw new Error('La IA no ha devuelto una solución válida.')
    await compilePdfBlob(resolvedLatex(candidate), exercisePreambleName(), undefined, exerciseRenderProfiles.solved)
    const generated = parseExerciseLatex(candidate)
    const generatedPart = generated.apartados[0]
    const solution = generatedPart?.solucion || generated.solucion
    if (!solution?.trim()) throw new Error('La IA no ha incluido el entorno solucion para este apartado.')
    apartado.solucion = solution
    if (!apartado.respuesta && generatedPart?.respuesta) apartado.respuesta = generatedPart.respuesta
    activeExerciseVersion.value.solucionIA = true
    rebuildActiveExerciseCode()
    exercisePreviewTab.value = 'solution'
    await compileExerciseSolutionPreviews(
      activeExerciseCode.value,
      activeExerciseStructure.value,
      exercisePreambleName(),
      { apartadoIndex },
    )
    const queued = await refreshLatexRender({ preservePreviews: true, preferredPreviewTab: 'solution' })
    if (!queued) throw new Error(compilerError.value || 'La solución se ha generado, pero no se ha podido guardar y encolar su compilación.')
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido generar la solución del apartado.'
    console.error('Error al generar la solución del apartado:', error)
  } finally {
    isGeneratingPartSolution.value = null
  }
}

function deleteExercisePartSolution(apartadoIndex) {
  const apartado = activeExerciseStructure.value.apartados[apartadoIndex]
  if (!apartado?.solucion?.trim()) return
  apartado.solucion = ''
  apartado.pdfsolucion = null
  if (apartado.previewPdfSolucion?.startsWith('blob:')) URL.revokeObjectURL(apartado.previewPdfSolucion)
  apartado.previewPdfSolucion = null
  rebuildActiveExerciseCode()
  setActivePreviewPdf('resuelto', null)
  exercisePreviewTab.value = 'statement'
  if (!hasExerciseSolutions(activeExerciseCode.value)) {
    activeExerciseVersion.value.solucionIA = false
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
      curriculum: exerciseAiCurriculum(),
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

function exerciseCompileAssets(files = exerciseEditor.value.archivos) {
  return Object.fromEntries(normalizeExerciseFiles(files)
    .filter((file) => file.compilerName && file.url && exerciseImageExtension(file))
    .map((file) => [file.compilerName, { url: file.url }]))
}

async function compilePdfBlob(code, preambleName, assets = exerciseCompileAssets(), profile = exerciseRenderProfiles.statement) {
  const response = await compilerRequest('/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: codeForPreamble(removeBlankLinesInsideAligned(code), profile),
      preamble_name: preambleName,
      assets,
    }),
  })
  return response.blob()
}

async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  const errors = []
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = await task(items[index], index)
      } catch (error) {
        errors.push(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  if (errors.length) throw errors[0]
  return results
}

async function compileExerciseSolutionPreviews(code, structure, preambleName, options = {}) {
  const apartadoIndex = Number.isInteger(options.apartadoIndex) ? options.apartadoIndex : null
  if (options.compileFull !== false) {
    if (hasExerciseSolutions(code)) {
      const completeSolution = await compilePdfBlob(resolvedLatex(code), preambleName, undefined, exerciseRenderProfiles.solved)
      setActivePreviewPdf('resuelto', URL.createObjectURL(completeSolution))
    } else {
      setActivePreviewPdf('resuelto', null)
    }
  }

  if (apartadoIndex === null) {
    const solutionJobs = []
    if (!structure.solucion?.trim()) setPartPreviewPdf(structure, 'previewPdfSolucion')
    else solutionJobs.push({ target: structure, index: null })
    structure.apartados.forEach((apartado, index) => {
      if (!apartado.solucion?.trim()) setPartPreviewPdf(apartado, 'previewPdfSolucion')
      else solutionJobs.push({ target: apartado, index })
    })
    await runWithConcurrency(solutionJobs, 3, async ({ target, index }) => {
      const solutionPdf = await compilePdfBlob(buildExercisePartLatex(structure, index, {
          includeSolutions: true,
          includeAnswers: true,
      }), preambleName, undefined, exerciseRenderProfiles.segment)
      setPartPreviewPdf(target, 'previewPdfSolucion', solutionPdf)
    })
    return
  }

  const apartado = structure.apartados[apartadoIndex]
  if (!apartado) return
  if (!apartado.solucion?.trim()) {
    setPartPreviewPdf(apartado, 'previewPdfSolucion')
    return
  }
  const partSolution = await compilePdfBlob(buildExercisePartLatex(structure, apartadoIndex, {
    includeSolutions: true,
    includeAnswers: true,
  }), preambleName, undefined, exerciseRenderProfiles.segment)
  setPartPreviewPdf(apartado, 'previewPdfSolucion', partSolution)
}

async function compileExercisePreviews(code, preambleName = selectedPreamble.value) {
  if (!preambleName) {
    compilerError.value = 'Selecciona una plantilla antes de compilar.'
    return
  }
  isCompiling.value = true
  compilerError.value = ''
  try {
    activeExerciseVersion.value.enunciado = code
    const structure = syncStructureFromCode(activeExerciseVersion.value)
    const rebuiltCode = buildExerciseLatex(structure, {
      includeSolutions: true,
      includeAnswers: true,
      preserveApartadosEnvironment: true,
    })
    const statementPdf = await compilePdfBlob(statementLatex(rebuiltCode), preambleName, undefined, exerciseRenderProfiles.statement)
    setActivePreviewPdf('enunciado', URL.createObjectURL(statementPdf))

    if (hasExerciseSolutions(rebuiltCode)) {
      await compileExerciseSolutionPreviews(rebuiltCode, structure, preambleName)
    } else {
      setActivePreviewPdf('resuelto', null)
      setPartPreviewPdf(structure, 'previewPdfSolucion')
      structure.apartados.forEach((apartado) => setPartPreviewPdf(apartado, 'previewPdfSolucion'))
      exercisePreviewTab.value = 'statement'
    }

    const statementJobs = [{ target: structure, index: null }, ...structure.apartados.map((apartado, index) => ({ target: apartado, index }))]
    await runWithConcurrency(statementJobs, 3, async ({ target, index }) => {
      const statement = await compilePdfBlob(buildExercisePartLatex(structure, index, {
        includeSolutions: false,
        includeAnswers: false,
      }), preambleName, undefined, exerciseRenderProfiles.segment)
      setPartPreviewPdf(target, 'previewPdfEnunciado', statement)
    })
    activeExerciseVersion.value.renderedLatex = code
  } catch (error) {
    compilerError.value = compilationErrorWithLatex(error)
  } finally {
    isCompiling.value = false
  }
}

async function refreshLatexRender(options = {}) {
  const preambleName = exercisePreambleName()
  if (!preambleName || !activeExerciseCode.value.trim() || isCompiling.value) return false
  const variationIndex = selectedExerciseVersion.value > 0 ? selectedExerciseVersion.value - 1 : null
  const mode = activeExerciseVersion.value.analysis?.ambiguous ? 'full' : 'selective'
  const previewPdf = options.preservePreviews ? { ...(activeExerciseVersion.value.previewPdf || {}) } : null
  const previewStructure = options.preservePreviews ? activeExerciseVersion.value.structure : null
  isCompiling.value = true
  compilerError.value = ''
  exerciseCompilationStatus.value = 'queued'
  try {
    const savedExercise = await saveExercise({ closeAfterSave: false })
    if (!savedExercise) {
      isCompiling.value = false
      exerciseCompilationStatus.value = 'error'
      return false
    }
    const queueCompilation = httpsCallable(functions, 'queueExerciseCompilation', { timeout: 30_000 })
    await queueCompilation({
      exerciseId: savedExercise.id,
      variationIndex,
      mode,
      preambleName,
    })
    const target = variationIndex === null
      ? exerciseEditor.value
      : exerciseEditor.value.variaciones[variationIndex]
    if (target) {
      target.compilation = { ...(target.compilation || {}), status: 'queued' }
      if (options.preservePreviews) {
        target.previewPdf = previewPdf
        copyPreviewStructureReferences(target.structure, previewStructure)
      }
    }
    watchExerciseCompilationInList(savedExercise.id)
    exercisePreviewTab.value = options.preferredPreviewTab === 'solution' && compiledSolutionPdfUrl.value
      ? 'solution'
      : 'statement'
    return true
  } catch (error) {
    compilerError.value = compilationErrorWithLatex(error)
    isCompiling.value = false
    exerciseCompilationStatus.value = 'error'
    return false
  }
}

function compilationSource(document = {}) {
  const block = (value) => value?.latex || ''
  return JSON.stringify({
    statement: block(document.statement),
    answer: block(document.answer),
    workedSolution: block(document.workedSolution),
    points: Number(document.points) || 0,
    partsEnvironment: document.partsEnvironment || null,
    parts: (document.parts || []).map((part) => ({
      id: part.id,
      statement: block(part.statement),
      answer: block(part.answer),
      workedSolution: block(part.workedSolution),
      points: Number(part.points) || 0,
    })),
    final: document.final || '',
    info: document.info || '',
  })
}

function compilationStateAfterSave(previous = {}, revision, sourceChanged = true) {
  if (!sourceChanged) return { ...previous, sourceRevision: revision }
  return {
    requestedRevision: Number(previous.requestedRevision) || null,
    readyRevision: Number(previous.readyRevision) || 0,
    status: 'outdated',
    requestedAt: previous.requestedAt || null,
    completedAt: previous.completedAt || null,
    error: null,
    sourceRevision: revision,
  }
}

function structuredVariationForSave(variation, previous = {}) {
  const analysis = analyzeExerciseLatex(variation.enunciado || '', variation.structure || {})
  if (!analysis.valid) throw new Error('La variante contiene una estructura LaTeX incompleta.')
  variation.analysis = { valid: true, ambiguous: analysis.ambiguous }
  variation.structure = mergeExerciseStructure(analysis.structure, variation.structure || {})
  const candidate = exerciseDocumentStructure(variation.structure, previous, (Number(previous.revision) || 0) + 1)
  const sourceChanged = Number(previous.schemaVersion || 0) < 3 || compilationSource(candidate) !== compilationSource(previous)
  const revision = sourceChanged ? (Number(previous.revision) || 0) + 1 : Number(previous.revision) || 1
  const persisted = {
    ...exerciseDocumentStructure(variation.structure, previous, revision),
    modelo: variation.modelo || previous.modelo || null,
    solucionIA: Boolean(variation.solucionIA),
    compilation: compilationStateAfterSave(previous.compilation, revision, sourceChanged),
  }
  const nextPaths = new Set(exercisePdfStoragePaths(persisted))
  persisted.pendingStorageCleanup = [...new Set([
    ...(previous.pendingStorageCleanup || []),
    ...exercisePdfStoragePaths(previous).filter((path) => !nextPaths.has(path)),
  ])]
  return persisted
}

async function saveExercise(options = {}) {
  const closeAfterSave = options?.closeAfterSave !== false
  if (!exerciseEditor.value.enunciado.trim()) return null
  isSavingExercise.value = true
  exercisesError.value = ''
  try {
    const reference = exerciseEditor.value.id
      ? doc(db, 'ejercicios', exerciseEditor.value.id)
      : doc(collection(db, 'ejercicios'))
    const previousSnapshot = await getDoc(reference)
    const previousData = previousSnapshot.exists() ? previousSnapshot.data() : {}
    const previousCurriculum = normalizeCurriculum(previousData.curriculum)
    const code = exerciseEditor.value.enunciado
    const analysis = analyzeExerciseLatex(code, exerciseEditor.value.structure || {})
    if (!analysis.valid) throw new Error('El código LaTeX está incompleto. Corrige las llaves o entornos antes de guardar.')
    exerciseEditor.value.analysis = { valid: true, ambiguous: analysis.ambiguous }
    const structure = mergeExerciseStructure(analysis.structure, exerciseEditor.value.structure || {})
    exerciseEditor.value.structure = structure
    const candidateStructure = exerciseDocumentStructure(structure, previousData, (Number(previousData.revision) || 0) + 1)
    const sourceChanged = Number(previousData.schemaVersion || 0) < 3
      || compilationSource(candidateStructure) !== compilationSource(previousData)
    const revision = sourceChanged ? (Number(previousData.revision) || 0) + 1 : Number(previousData.revision) || 1
    const persistedStructure = exerciseDocumentStructure(structure, previousData, revision)
    const previousVariaciones = Array.isArray(previousData.variaciones) ? previousData.variaciones : []
    const variaciones = exerciseEditor.value.variaciones
      .filter((variation) => variation.enunciado.trim())
      .map((variation, index) => structuredVariationForSave(variation, previousVariaciones[index] || {}))
    const nextStoragePaths = new Set([
      ...exercisePdfStoragePaths(persistedStructure),
      ...variaciones.flatMap((variation) => exercisePdfStoragePaths(variation)),
    ])
    const pendingStorageCleanup = [...new Set([
      ...(previousData.pendingStorageCleanup || []),
      ...exercisePdfStoragePaths(previousData).filter((path) => !nextStoragePaths.has(path)),
      ...previousVariaciones
        .slice(variaciones.length)
        .flatMap((variation) => exercisePdfStoragePaths(variation)),
    ])]
    const curriculum = {
      ...normalizeCurriculum(exerciseEditor.value.curriculum),
      conceptIds: [...persistedStructure.contenidos],
    }
    const now = new Date().toISOString()
    const data = {
      ...persistedStructure,
      id: reference.id,
      ownerId: previousData.ownerId || currentTeacherId.value,
      visibility: previousData.visibility === 'public' ? 'public' : 'private',
      curriculum,
      tags: normalizeTags(exerciseEditor.value.tags),
      archivos: normalizeExerciseFiles(exerciseEditor.value.archivos),
      solucionIA: Boolean(exerciseEditor.value.solucionIA),
      variaciones,
      // Se conserva como referencia obsoleta hasta que la nueva miniatura se
      // publique; el sourceUrl evita mostrarla y la función elimina el objeto anterior.
      preview: previousData.preview || {},
      pendingStorageCleanup,
      compilation: compilationStateAfterSave(previousData.compilation, revision, sourceChanged),
      createdAt: previousData.createdAt || now,
      updatedAt: now,
    }
    const batch = writeBatch(db)
    batch.set(reference, data)
    await syncExerciseConceptIndex(reference.id, previousCurriculum.conceptIds, data.curriculum.conceptIds, batch)
    await batch.commit()
    const filesToDelete = pendingDeletedAttachments.splice(0)
    await Promise.all(filesToDelete.map(async (file) => {
      try { await deleteObject(storageRef(storage, file.path)) } catch (error) { console.warn('No se ha podido eliminar un archivo retirado:', error) }
    }))
    sessionUploadedAttachmentPaths.clear()
    const savedExercise = normalizeExercise({ ...previousData, ...data })
    const index = exercises.value.findIndex((exercise) => exercise.id === reference.id)
    if (index === -1) exercises.value.push(savedExercise)
    else exercises.value[index] = savedExercise
    exercises.value.sort((a, b) => a.id.localeCompare(b.id))
    selectedExerciseId.value = reference.id
    if (closeAfterSave) {
      stopWatchingExerciseCompilation()
      destroyLatexEditor()
      clearExercisePreviews()
      exerciseEditor.value = emptyExercise()
      selectedExerciseVersion.value = 0
      exerciseCompetencyTarget.value = null
      exerciseView.value = 'search'
    } else {
      const activeVersionIndex = selectedExerciseVersion.value
      exerciseEditor.value = savedExercise
      selectedExerciseVersion.value = Math.min(activeVersionIndex, savedExercise.variaciones.length)
      exerciseCompilationStatus.value = 'outdated'
      watchExerciseCompilation(reference.id)
      mountLatexEditor()
    }
    return savedExercise
  } catch (error) {
    exercisesError.value = error.message || 'No se ha podido guardar el ejercicio.'
    console.error('Error al guardar ejercicio:', error)
    return null
  } finally {
    isSavingExercise.value = false
  }
}

function requestDeleteExercise() {
  if (!isEditingPersistedExercise.value || isDeletingExercise.value) return
  exerciseDeleteError.value = ''
  exerciseDeleteDialog.value = true
}

async function exerciseStorageObjects(reference) {
  const listing = await listAll(reference)
  const nestedObjects = await Promise.all(listing.prefixes.map((prefix) => exerciseStorageObjects(prefix)))
  return [...listing.items, ...nestedObjects.flat()]
}

async function deleteExerciseStorage(exerciseId) {
  const rootReference = storageRef(storage, `ejercicios/${exerciseId}`)
  const objects = await exerciseStorageObjects(rootReference)
  await Promise.all(objects.map(async (reference) => {
    try {
      await deleteObject(reference)
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') throw error
    }
  }))
}

async function deleteExercise() {
  const exerciseId = exerciseEditor.value.id
  if (!exerciseId || isDeletingExercise.value) return

  isDeletingExercise.value = true
  exerciseDeleteError.value = ''
  exercisesError.value = ''
  try {
    const indexedConcepts = await getDocs(collection(db, 'especialidades', 'Matemáticas', 'conceptos'))
    const conceptIds = new Set([
      ...mathConceptNodes.value.map((node) => node.id),
      ...indexedConcepts.docs.map((concept) => concept.id),
    ])
    const batch = writeBatch(db)
    batch.delete(doc(db, 'ejercicios', exerciseId))
    conceptIds.forEach((conceptId) => {
      batch.delete(doc(db, 'especialidades', 'Matemáticas', 'conceptos', conceptId, 'ejercicios', exerciseId))
    })
    await batch.commit()
    await deleteExerciseStorage(exerciseId)

    destroyLatexEditor()
    clearExercisePreviews()
    sessionUploadedAttachmentPaths.clear()
    pendingDeletedAttachments.splice(0)
    exercises.value = exercises.value.filter((exercise) => exercise.id !== exerciseId)
    selectedExerciseId.value = null
    selectedExerciseVersion.value = 0
    exerciseCompetencyTarget.value = null
    exerciseEditor.value = emptyExercise()
    exercisePreviewTab.value = 'statement'
    exerciseView.value = 'search'
    exerciseDeleteDialog.value = false
  } catch (error) {
    exerciseDeleteError.value = error.message || 'No se ha podido eliminar completamente el ejercicio.'
    console.error('Error al eliminar el ejercicio:', error)
  } finally {
    isDeletingExercise.value = false
  }
}

function createGroupId() {
  return globalThis.crypto?.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function migrateLegacyStudentIdentities(courses = []) {
  for (const course of courses) {
    for (const group of course.grupos || []) {
      const groupId = group.id || [group.nombre, group.asignatura, group.aula, group.color].join('|')
      const identities = (group.alumnos || [])
        .filter((student) => student && typeof student === 'object' && student.id && student.nombre)
        .map((student) => ({ ...student }))
      await saveStudentIdentities(groupId, identities)
    }
  }
}

function teachingScheduleBlocks(groups = teacherGroups.value) {
  return groups.flatMap((group) => (group.horario || []).map((segment) => {
    const subjectId = segment.subjectId || group.subjectId || scheduleSubjectId(group.curso || group.nombre, group.asignatura)
    const tutorType = segment.tutorType || null
    return {
      type: 'teaching',
      groupId: group.id,
      course: group.nombre,
      subjectId,
      subject: segment.subject || group.asignatura || '',
      // Los horarios antiguos no guardaban el tipo por segmento. En ese caso se
      // considera clase ordinaria para no ocultar por error días de programación.
      tutorType,
      classroom: segment.aula ?? group.aula ?? '',
      color: segment.color || scheduleColorFor({ subjectId, tutorType, course: group.nombre }),
      dayIndex: segment.dia,
      moduleIndex: segment.tramo,
    }
  }))
}

function groupsFromSchedule(blocks, existingGroups = teacherGroups.value) {
  const teachingBlocks = blocks.filter((block) => block.type !== 'nonTeaching' && block.groupId)
  const blocksByGroup = new Map()
  teachingBlocks.forEach((block) => {
    const entries = blocksByGroup.get(block.groupId) || []
    entries.push(block)
    blocksByGroup.set(block.groupId, entries)
  })

  const groupsById = new Map(existingGroups.map((group) => [group.id, {
    ...group,
    horario: [],
  }]))
  blocksByGroup.forEach((groupBlocks, groupId) => {
    const first = groupBlocks[0]
    const subjectBlock = groupBlocks.find((block) => block.subjectId && !block.tutorType) || first
    const previous = groupsById.get(groupId)
    const relatedAliases = existingGroups
      .filter((group) => String(group.nombre || '').trim().toLocaleUpperCase('es-ES') === String(first.course || '').trim().toLocaleUpperCase('es-ES'))
      .flatMap((group) => [group.id, ...(group.legacyIds || [])])
    groupsById.set(groupId, {
      ...(previous || {
        id: groupId,
        academicYear: currentAcademicYear(),
        teacherId: currentTeacherId.value,
        alumnos: [],
        evaluaciones: { estructura: [], resultados: {}, pesos: {} },
        disposicion: { rows: 4, cols: 5, aisles: [], asientos: [] },
        studentCount: 0,
        studentsLoaded: true,
      }),
      nombre: first.course,
      curso: mathSubjectsById.get(subjectBlock.subjectId)?.course || String(first.course || '').replace(/\s+[A-Z]$/u, ''),
      subjectId: subjectBlock.subjectId || null,
      asignatura: subjectBlock.subject || '',
      tutor: Boolean(groupBlocks.some((block) => block.tutorType)),
      tutorType: groupBlocks.find((block) => block.tutorType)?.tutorType || null,
      aula: first.classroom || '',
      color: scheduleColorFor(first),
      legacyIds: [...new Set([...(previous?.legacyIds || []), ...relatedAliases].filter(Boolean))],
      horario: groupBlocks.map((block) => ({
        dia: block.dayIndex,
        tramo: block.moduleIndex,
        aula: block.classroom || '',
        subjectId: block.subjectId || null,
        subject: block.subject || '',
        tutorType: block.tutorType || null,
        color: block.color || null,
      })),
    })
  })
  return [...groupsById.values()]
}

async function loadTeacherSchedule() {
  firestoreError.value = ''
  try {
    if (!teacherDocument.value || !currentTeacherId.value) return
    const snapshot = await getDoc(teacherDocument.value)
    if (snapshot.exists()) {
      let teacherData = snapshot.data() || {}
      const storedCourses = teacherData?.carrera?.cursos || []
      teacherProfile.value = normalizeTeacherProfile(teacherData.perfil)
      await migrateLegacyStudentIdentities(storedCourses)
      const migrated = await migrateLegacyGroups(snapshot, currentTeacherId.value)
      if (migrated) teacherData = (await getDoc(teacherDocument.value)).data() || teacherData
      schoolCalendar.value = normalizeSchoolCalendar(
        teacherData?.calendariosEscolares?.[academicCalendarYear.value] || teacherData?.calendarioEscolar || {},
      )
    } else {
      teacherProfile.value = normalizeTeacherProfile()
      schoolCalendar.value = normalizeSchoolCalendar()
      await setDoc(teacherDocument.value, { groupMigration: { schemaVersion: 2 } }, { merge: true })
    }
    const [loadedGroups, nonTeachingSchedule, storedScheduleTimePoints] = await Promise.all([
      loadGroupsForTeacher(currentTeacherId.value, currentAcademicYear()),
      loadNonTeachingSchedule(currentTeacherId.value, currentAcademicYear()),
      loadScheduleTimePoints(currentTeacherId.value, currentAcademicYear()),
    ])
    scheduleTimePoints.value = normalizeScheduleTimePoints(storedScheduleTimePoints)
    teacherGroups.value = loadedGroups
    scheduleBlocks.value = [
      ...teachingScheduleBlocks(loadedGroups),
      ...nonTeachingSchedule.map((block) => ({
        ...block,
        subject: '',
        color: scheduleColorFor(block),
      })),
    ]
  } catch (error) {
    firestoreError.value = 'No se ha podido cargar el horario de Firestore.'
    console.error('Error al cargar los grupos y el horario:', error)
  }
}

function scheduleBlock(dayIndex, moduleIndex) {
  return scheduleBlocks.value.find((block) => block.dayIndex === dayIndex && block.moduleIndex === moduleIndex)
}

function openScheduleDialog(dayIndex, moduleIndex) {
  if (!scheduleConfigMode.value) return
  selectedSlot.value = { dayIndex, moduleIndex }
  const currentBlock = scheduleBlock(dayIndex, moduleIndex)
  const isNonTeachingBlock = currentBlock?.type === 'nonTeaching' || (currentBlock && !currentBlock.groupId)
  scheduleForm.value = currentBlock
    ? {
        id: currentBlock.id || null,
        type: isNonTeachingBlock ? 'nonTeaching' : 'teaching',
        nonTeachingKind: isNonTeachingBlock
          ? (scheduleSegmentType(currentBlock.nonTeachingKind)?.value || scheduleSegmentType(currentBlock.course)?.value)
          : null,
        groupId: currentBlock.groupId,
        course: isNonTeachingBlock ? '' : currentBlock.course,
        subjectId: isNonTeachingBlock ? null : (currentBlock.subjectId || scheduleSubjectId(currentBlock.course, currentBlock.subject)),
        subject: isNonTeachingBlock ? '' : currentBlock.subject,
        tutorType: isNonTeachingBlock ? null : (currentBlock.tutorType || null),
        classroom: currentBlock.classroom,
        color: currentBlock.color,
      }
    : emptyScheduleForm()
  scheduleDialog.value = true
}

async function saveScheduleBlock() {
  if (!canSaveScheduleBlock.value) return
  const slot = selectedSlot.value
  const currentBlock = scheduleBlock(slot.dayIndex, slot.moduleIndex)
  const isNonTeaching = !scheduleForm.value.course.trim()
  const selectedSegmentType = scheduleSegmentType(scheduleForm.value.nonTeachingKind)
  const matchingGroupId = scheduleBlocks.value.find((item) => (
    item.type !== 'nonTeaching'
    && item.groupId
    && String(item.course || '').trim().toLocaleUpperCase('es-ES') === scheduleForm.value.course.trim().toLocaleUpperCase('es-ES')
  ))?.groupId || teacherGroups.value.find((group) => (
    String(group.nombre || '').trim().toLocaleUpperCase('es-ES') === scheduleForm.value.course.trim().toLocaleUpperCase('es-ES')
  ))?.id
  const groupId = isNonTeaching ? null : (currentBlock?.groupId || scheduleForm.value.groupId || matchingGroupId || createGroupId())
  const block = {
    ...scheduleForm.value,
    course: isNonTeaching ? selectedSegmentType.title : scheduleForm.value.course.trim(),
    subjectId: isNonTeaching ? null : scheduleForm.value.subjectId,
    subject: isNonTeaching ? '' : scheduleForm.value.subject,
    tutorType: isNonTeaching ? null : scheduleForm.value.tutorType,
    nonTeachingKind: isNonTeaching ? selectedSegmentType.value : null,
    color: scheduleColorFor(scheduleForm.value),
    id: isNonTeaching ? (currentBlock?.id || scheduleForm.value.id || createGroupId()) : null,
    type: isNonTeaching ? 'nonTeaching' : 'teaching',
    groupId,
    ...slot,
  }
  const previousBlocks = [...scheduleBlocks.value]
  const existingIndex = scheduleBlocks.value.findIndex((item) => item.dayIndex === slot.dayIndex && item.moduleIndex === slot.moduleIndex)
  if (existingIndex === -1) {
    scheduleBlocks.value.push(block)
  } else {
    scheduleBlocks.value.splice(existingIndex, 1, block)
  }
  isSavingSchedule.value = true
  firestoreError.value = ''
  try {
    const updatedGroups = groupsFromSchedule(scheduleBlocks.value)
    await Promise.all([
      saveGroupMetadata(updatedGroups, currentTeacherId.value),
      saveNonTeachingSchedule(
        scheduleBlocks.value.filter((item) => item.type === 'nonTeaching'),
        currentTeacherId.value,
        currentAcademicYear(),
      ),
    ])
    teacherGroups.value = updatedGroups
    scheduleDialog.value = false
  } catch (error) {
    scheduleBlocks.value = previousBlocks
    firestoreError.value = 'No se ha podido guardar el horario en Firestore.'
    console.error('Error al guardar el horario:', error)
  } finally {
    isSavingSchedule.value = false
  }
}

function copyScheduleBlock(dayIndex, moduleIndex) {
  const block = scheduleBlock(dayIndex, moduleIndex)
  if (!block) return
  if (isScheduleCopySource(dayIndex, moduleIndex)) {
    scheduleClipboard.value = null
    return
  }
  scheduleClipboard.value = {
    sourceDayIndex: dayIndex,
    sourceModuleIndex: moduleIndex,
    block: JSON.parse(JSON.stringify(block)),
  }
}

function handleScheduleCellClick(dayIndex, moduleIndex) {
  if (scheduleClipboard.value) {
    if (!isScheduleCopySource(dayIndex, moduleIndex)) void pasteScheduleBlock(dayIndex, moduleIndex)
    return
  }
  openScheduleDialog(dayIndex, moduleIndex)
}

function isScheduleCopySource(dayIndex, moduleIndex) {
  return scheduleClipboard.value?.sourceDayIndex === dayIndex
    && scheduleClipboard.value?.sourceModuleIndex === moduleIndex
}

async function pasteScheduleBlock(dayIndex, moduleIndex) {
  if (!scheduleClipboard.value || isScheduleCopySource(dayIndex, moduleIndex)) return
  const previousBlocks = [...scheduleBlocks.value]
  const source = JSON.parse(JSON.stringify(scheduleClipboard.value.block))
  const isNonTeaching = source.type === 'nonTeaching' || !source.subjectId
  const pastedBlock = {
    ...source,
    id: isNonTeaching ? createGroupId() : null,
    type: isNonTeaching ? 'nonTeaching' : 'teaching',
    groupId: isNonTeaching ? null : source.groupId,
    color: scheduleColorFor(source),
    dayIndex,
    moduleIndex,
  }
  const existingIndex = scheduleBlocks.value.findIndex((item) => (
    item.dayIndex === dayIndex && item.moduleIndex === moduleIndex
  ))
  if (existingIndex === -1) scheduleBlocks.value.push(pastedBlock)
  else scheduleBlocks.value.splice(existingIndex, 1, pastedBlock)
  isSavingSchedule.value = true
  firestoreError.value = ''
  try {
    const updatedGroups = groupsFromSchedule(scheduleBlocks.value)
    await Promise.all([
      saveGroupMetadata(updatedGroups, currentTeacherId.value),
      saveNonTeachingSchedule(
        scheduleBlocks.value.filter((item) => item.type === 'nonTeaching'),
        currentTeacherId.value,
        currentAcademicYear(),
      ),
    ])
    teacherGroups.value = updatedGroups
  } catch (error) {
    scheduleBlocks.value = previousBlocks
    firestoreError.value = 'No se ha podido pegar el segmento en Firestore.'
    console.error('Error al pegar un segmento horario:', error)
  } finally {
    isSavingSchedule.value = false
  }
}

async function clearScheduleCell(dayIndex, moduleIndex) {
  selectedSlot.value = { dayIndex, moduleIndex }
  await clearScheduleBlock()
}

async function clearScheduleBlock() {
  if (!selectedSlot.value || !hasSelectedScheduleBlock.value) return
  const currentBlock = scheduleBlock(selectedSlot.value.dayIndex, selectedSlot.value.moduleIndex)
  const remainingGroupSegments = scheduleBlocks.value.filter((block) => (
    block.type !== 'nonTeaching' && block.groupId === currentBlock?.groupId
  )).length
  if (currentBlock?.groupId && remainingGroupSegments <= 1) {
    scheduleDeleteDialog.value = true
    return
  }
  await performClearScheduleBlock()
}

async function performClearScheduleBlock({ deleteGroup = false } = {}) {
  if (!selectedSlot.value || !hasSelectedScheduleBlock.value) return
  const previousBlocks = [...scheduleBlocks.value]
  const { dayIndex, moduleIndex } = selectedSlot.value
  const currentBlock = scheduleBlock(dayIndex, moduleIndex)
  const groupId = deleteGroup ? currentBlock?.groupId : null
  const scheduledGroup = groupId ? teacherGroups.value.find((group) => group.id === groupId) : null
  scheduleBlocks.value = scheduleBlocks.value.filter((block) => block.dayIndex !== dayIndex || block.moduleIndex !== moduleIndex)
  isSavingSchedule.value = true
  firestoreError.value = ''
  try {
    const updatedGroups = groupsFromSchedule(scheduleBlocks.value).filter((group) => group.id !== groupId)
    await Promise.all([
      saveNonTeachingSchedule(
        scheduleBlocks.value.filter((item) => item.type === 'nonTeaching'),
        currentTeacherId.value,
        currentAcademicYear(),
      ),
      groupId ? Promise.resolve() : saveGroupMetadata(updatedGroups, currentTeacherId.value),
    ])
    const deletion = groupId
      ? await httpsCallable(functions, 'deleteTeacherGroup')({ groupId })
      : null
    const deletedStudentIds = deletion?.data?.studentIds || []
    teacherGroups.value = updatedGroups
    if (groupId) {
      const localIds = [...new Set([
        ...deletedStudentIds,
        ...((scheduledGroup?.alumnos || []).map((student) => student.id).filter(Boolean)),
      ])]
      try {
        await deleteStudentIdentitiesEverywhere(localIds)
      } catch (error) {
        console.error('No se han podido borrar todas las identidades locales del grupo:', error)
        showAppErrorToast('El grupo se ha eliminado de Firestore, pero no se han podido borrar todos sus datos locales de este dispositivo.')
      }
      if (selectedCareerGroupId.value === groupId) selectedCareerGroupId.value = null
    }
    scheduleDialog.value = false
  } catch (error) {
    scheduleBlocks.value = previousBlocks
    firestoreError.value = 'No se ha podido eliminar el segmento en Firestore.'
    console.error('Error al eliminar un segmento del horario:', error)
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
  if (mode !== 'week') {
    scheduleConfigMode.value = false
    scheduleClipboard.value = null
  }
  if (mode !== 'year') courseCalendarConfigMode.value = false
}

function toggleCalendarConfiguration() {
  if (calendarMode.value === 'week') {
    scheduleConfigMode.value = !scheduleConfigMode.value
    if (!scheduleConfigMode.value) scheduleClipboard.value = null
    courseCalendarConfigMode.value = false
  } else if (calendarMode.value === 'year') {
    courseCalendarConfigMode.value = !courseCalendarConfigMode.value
    scheduleConfigMode.value = false
  }
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

function minutesToTime(value) {
  const minutes = Math.max(0, Math.min(23 * 60 + 55, Math.round(Number(value) / 5) * 5))
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function normalizeScheduleTimePoints(value) {
  if (!Array.isArray(value) || value.length < 2) return [...defaultScheduleTimePoints]
  const normalized = value.map((time) => String(time || '').trim())
  const valid = normalized.every((time, index) => (
    /^([01]\d|2[0-3]):[0-5]\d$/u.test(time)
    && timeToMinutes(time) % 5 === 0
    && (index === 0 || timeToMinutes(time) > timeToMinutes(normalized[index - 1]))
  ))
  return valid ? normalized : [...defaultScheduleTimePoints]
}

async function persistScheduleTimePoints(previousTimePoints) {
  isSavingSchedule.value = true
  try {
    await saveScheduleTimePoints(scheduleTimePoints.value, currentTeacherId.value, currentAcademicYear())
  } catch (error) {
    scheduleTimePoints.value = previousTimePoints
    showAppErrorToast('No se han podido guardar las horas del horario.')
    console.error('Error al guardar las horas del horario:', error)
  } finally {
    isSavingSchedule.value = false
  }
}

async function updateScheduleTimePoint(index, rawValue, input) {
  const previousTimePoints = [...scheduleTimePoints.value]
  const snappedTime = minutesToTime(timeToMinutes(rawValue))
  const minutes = timeToMinutes(snappedTime)
  const previousMinutes = index > 0 ? timeToMinutes(scheduleTimePoints.value[index - 1]) : -1
  const nextMinutes = index < scheduleTimePoints.value.length - 1
    ? timeToMinutes(scheduleTimePoints.value[index + 1])
    : 24 * 60
  if (!rawValue || minutes <= previousMinutes || minutes >= nextMinutes) {
    if (input) input.value = scheduleTimePoints.value[index]
    showAppErrorToast('Cada hora debe estar separada de las contiguas por al menos cinco minutos.')
    return
  }
  scheduleTimePoints.value = scheduleTimePoints.value.map((time, pointIndex) => (
    pointIndex === index ? snappedTime : time
  ))
  if (input) input.value = snappedTime
  await persistScheduleTimePoints(previousTimePoints)
}

async function saveScheduleStructure(previousTimePoints, previousBlocks, failureMessage) {
  isSavingSchedule.value = true
  try {
    const updatedGroups = groupsFromSchedule(scheduleBlocks.value)
    await Promise.all([
      saveScheduleTimePoints(scheduleTimePoints.value, currentTeacherId.value, currentAcademicYear()),
      saveGroupMetadata(updatedGroups, currentTeacherId.value),
      saveNonTeachingSchedule(
        scheduleBlocks.value.filter((item) => item.type === 'nonTeaching'),
        currentTeacherId.value,
        currentAcademicYear(),
      ),
    ])
    teacherGroups.value = updatedGroups
  } catch (error) {
    scheduleTimePoints.value = previousTimePoints
    scheduleBlocks.value = previousBlocks
    showAppErrorToast(failureMessage)
    console.error(failureMessage, error)
  } finally {
    isSavingSchedule.value = false
  }
}

async function insertScheduleTimePoint(moduleIndex) {
  const previousTimePoints = [...scheduleTimePoints.value]
  const previousBlocks = [...scheduleBlocks.value]
  const start = timeToMinutes(scheduleTimePoints.value[moduleIndex])
  const end = timeToMinutes(scheduleTimePoints.value[moduleIndex + 1])
  if (end - start < 10) {
    showAppErrorToast('Este tramo no se puede dividir en intervalos de cinco minutos.')
    return
  }
  let midpoint = Math.round(((start + end) / 2) / 5) * 5
  if (midpoint <= start) midpoint = start + 5
  if (midpoint >= end) midpoint = end - 5
  scheduleTimePoints.value = [
    ...scheduleTimePoints.value.slice(0, moduleIndex + 1),
    minutesToTime(midpoint),
    ...scheduleTimePoints.value.slice(moduleIndex + 1),
  ]
  scheduleBlocks.value = scheduleBlocks.value.map((block) => ({
    ...block,
    moduleIndex: block.moduleIndex > moduleIndex ? block.moduleIndex + 1 : block.moduleIndex,
  }))
  await saveScheduleStructure(previousTimePoints, previousBlocks, 'No se ha podido dividir el tramo horario.')
}

async function removeScheduleTimePoint(pointIndex) {
  if (pointIndex <= 0 || pointIndex >= scheduleTimePoints.value.length - 1) return
  if (scheduleBlocks.value.some((block) => block.moduleIndex === pointIndex)) {
    showAppErrorToast('Limpia primero el tramo situado debajo de esta hora para poder unir ambos intervalos.')
    return
  }
  const previousTimePoints = [...scheduleTimePoints.value]
  const previousBlocks = [...scheduleBlocks.value]
  scheduleTimePoints.value = scheduleTimePoints.value.filter((_, index) => index !== pointIndex)
  scheduleBlocks.value = scheduleBlocks.value.map((block) => ({
    ...block,
    moduleIndex: block.moduleIndex > pointIndex ? block.moduleIndex - 1 : block.moduleIndex,
  }))
  await saveScheduleStructure(previousTimePoints, previousBlocks, 'No se han podido unir los tramos horarios.')
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

const navigation = computed(() => [
  { title: 'Matemáticas', icon: 'mdi-function-variant' },
  { title: 'Ejercicios', icon: 'mdi-pencil-ruler' },
  { title: 'Rúbricas', icon: 'mdi-table-star' },
  { title: 'Documentos', icon: 'mdi-file-document-outline' },
  ...(isAdministrator.value ? [{ title: 'Invitaciones', icon: 'mdi-account-multiple-plus-outline' }] : []),
])

const groups = computed(() => {
  const buckets = new Map()
  teacherGroups.value
    .filter((group) => Boolean(group.asignatura?.trim()) && Array.isArray(group.horario) && group.horario.length > 0)
    .forEach((group) => {
      const key = String(group.nombre || '').trim().toLocaleUpperCase('es-ES')
      const entries = buckets.get(key) || []
      entries.push(group)
      buckets.set(key, entries)
    })

  return [...buckets.values()].map((entries) => {
    const score = (group) => {
      const students = group.studentsLoaded ? (group.alumnos?.length || 0) : (Number(group.studentCount) || 0)
      const ordinarySessions = (group.horario || []).filter((segment) => !segment?.tutorType).length
      return (students * 1000) + (ordinarySessions * 10) + (group.studentsLoaded ? 1 : 0)
    }
    const primary = [...entries].sort((left, right) => score(right) - score(left))[0]
    const relatedGroupIds = [...new Set(entries.map((group) => group.id).filter(Boolean))]
    const scheduleBySlot = new Map()
    ;[primary, ...entries.filter((group) => group.id !== primary.id)].forEach((group) => {
      ;(group.horario || []).forEach((segment) => {
        const key = `${segment.dia}:${segment.tramo}`
        if (!scheduleBySlot.has(key)) scheduleBySlot.set(key, { ...segment })
      })
    })
    const subjects = [...new Set(entries.map((group) => group.asignatura).filter(Boolean))]
    const ordinaryGroup = entries.find((group) => (group.horario || []).some((segment) => !segment?.tutorType)) || primary
    return {
      ...primary,
      subjectId: ordinaryGroup.subjectId || primary.subjectId,
      asignatura: ordinaryGroup.asignatura || primary.asignatura,
      color: ordinaryGroup.color || primary.color,
      horario: [...scheduleBySlot.values()],
      tutor: entries.some((group) => group.tutor || (group.horario || []).some((segment) => segment?.tutorType)),
      tutorType: entries.find((group) => group.tutorType)?.tutorType || null,
      relatedGroupIds,
      legacyIds: [...new Set(entries.flatMap((group) => [group.id, ...(group.legacyIds || [])]).filter(Boolean))],
      title: primary.nombre,
      subtitle: subjects.join(' · '),
      icon: 'mdi-function-variant',
    }
  })
})

const selectedCareerGroup = computed(() => groups.value.find((group) => group.id === selectedCareerGroupId.value) || null)
const classroomTeachingDates = computed(() => selectedCareerGroup.value
  ? programmingDatesForGroup(schoolCalendar.value, selectedCareerGroup.value)
  : [])
const classroomDateIndex = computed(() => classroomTeachingDates.value.indexOf(classroomDate.value))
const classroomDateLabel = computed(() => {
  const match = classroomDate.value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return 'Sin días lectivos'
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
    .replace('.', '')
})
const existingStudentIds = computed(() => teacherGroups.value.flatMap((group) => (
  (group.alumnos || []).map((student) => student.id).filter(Boolean)
)))

function synchronizeClassroomDate() {
  const dates = classroomTeachingDates.value
  if (!dates.length) {
    classroomDate.value = ''
    return
  }
  if (dates.includes(classroomDate.value)) return
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  classroomDate.value = dates.find((date) => date >= today) || dates.at(-1)
}

function moveClassroomDate(offset) {
  const nextIndex = classroomDateIndex.value + offset
  if (nextIndex < 0 || nextIndex >= classroomTeachingDates.value.length) return
  classroomDate.value = classroomTeachingDates.value[nextIndex]
}

watch(classroomTeachingDates, synchronizeClassroomDate, { immediate: true })

let gradebookSavePromise = null
let groupOpenRequest = 0

async function openCareerGroup(group) {
  const request = ++groupOpenRequest
  isLoadingSelectedGroup.value = false
  if (active.value === 'Grupo' && groupView.value === 'programming' && selectedCareerGroupId.value !== group.id) {
    await programmingRef.value?.flush?.()
  }
  if (active.value === 'Grupo' && selectedCareerGroupId.value !== group.id && gradebookDirty.value) {
    const saved = await saveGradebook({ includeIdentities: gradebookConfigurationMode.value })
    if (!saved || request !== groupOpenRequest) return
  }
  firestoreError.value = ''
  let groupToOpen = teacherGroups.value.find((item) => item.id === group.id) || group
  if (!groupToOpen.studentsLoaded) {
    isLoadingSelectedGroup.value = true
    try {
      const loadedGroup = await loadStudentsForGroup(groupToOpen)
      teacherGroups.value = teacherGroups.value.map((item) => item.id === loadedGroup.id ? loadedGroup : item)
      groupToOpen = loadedGroup
    } catch (error) {
      if (request !== groupOpenRequest) return
      firestoreError.value = 'No se han podido cargar los alumnos y las calificaciones del grupo.'
      console.error('Error al cargar los alumnos del grupo:', error)
      return
    } finally {
      if (request === groupOpenRequest) isLoadingSelectedGroup.value = false
    }
  }
  if (request !== groupOpenRequest) return
  selectedCareerGroupId.value = groupToOpen.id
  gradebookDirty.value = false
  gradebookValid.value = true
  gradebookConfigurationMode.value = false
  selectedStudentDetail.value = null
  studentDetailConfigurationMode.value = false
  groupView.value = 'evaluation'
  active.value = 'Grupo'
}

async function setGroupView(view) {
  if (groupView.value === view) return
  if (groupView.value === 'programming') await programmingRef.value?.flush?.()
  if (gradebookDirty.value) {
    const saved = await saveGradebook({ includeIdentities: gradebookConfigurationMode.value })
    if (!saved) return
  }
  if (view === 'programming') gradebookConfigurationMode.value = false
  groupView.value = view
  gradebookDirty.value = false
}

function openStudentDetail(student) {
  if (gradebookConfigurationMode.value || !student?.id) return
  selectedStudentDetail.value = { ...student }
  studentDetailConfigurationMode.value = false
}

function closeStudentDetail() {
  selectedStudentDetail.value = null
  studentDetailConfigurationMode.value = false
}

function toggleStudentDetailConfiguration() {
  studentDetailConfigurationMode.value = !studentDetailConfigurationMode.value
}

function addGradebookStudent() {
  gradebookRef.value?.addStudent?.()
}

function addGradebookStudents() {
  gradebookRef.value?.openBulkStudentDialog?.()
}

function addGradebookColumn() {
  gradebookRef.value?.openItemDialog?.()
}

function applyDocumentAssessmentToLoadedGroups({ documentId, previousGroupId, groupId, item }) {
  const linkedItemIds = (nodes = []) => nodes.flatMap((node) => {
    if (node?.type === 'item' && node.documentAssessment?.documentId === documentId) return [node.id]
    return node?.type === 'group' ? linkedItemIds(node.children || []) : []
  })
  const removeItem = (nodes = []) => nodes.flatMap((node) => {
    if (node?.type === 'item' && node.documentAssessment?.documentId === documentId) return []
    if (node?.type === 'group') return [{ ...node, children: removeItem(node.children || []) }]
    return [node]
  })
  teacherGroups.value = teacherGroups.value.map((group) => {
    if (![previousGroupId, groupId].filter(Boolean).includes(group.id)) return group
    const previousStructure = group.evaluaciones?.estructura || []
    const removedIds = linkedItemIds(previousStructure).filter((id) => !(group.id === groupId && item?.id === id))
    const structure = removeItem(previousStructure)
    if (group.id === groupId && item) structure.push(JSON.parse(JSON.stringify(item)))
    const resultados = JSON.parse(JSON.stringify(group.evaluaciones?.resultados || {}))
    if (removedIds.length) Object.values(resultados).forEach((studentResults) => removedIds.forEach((id) => delete studentResults[id]))
    return {
      ...group,
      evaluaciones: { ...(group.evaluaciones || {}), estructura: structure, resultados },
    }
  })
}

function removeProgrammingAssessmentFromLoadedGroup({ groupId, itemIds = [] }) {
  const removedIds = new Set(itemIds.filter(Boolean))
  if (!groupId || !removedIds.size) return
  const removeItems = (nodes = []) => nodes.flatMap((node) => {
    if (node?.type === 'item' && removedIds.has(node.id)) return []
    if (node?.type === 'group') return [{ ...node, children: removeItems(node.children || []) }]
    return [node]
  })
  teacherGroups.value = teacherGroups.value.map((group) => {
    if (group.id !== groupId) return group
    const resultados = JSON.parse(JSON.stringify(group.evaluaciones?.resultados || {}))
    Object.values(resultados).forEach((studentResults) => {
      removedIds.forEach((itemId) => delete studentResults[itemId])
    })
    return {
      ...group,
      evaluaciones: {
        ...(group.evaluaciones || {}),
        estructura: removeItems(group.evaluaciones?.estructura || []),
        resultados,
      },
    }
  })
}

async function createProgrammingDocument({ date, ...session }) {
  const group = selectedCareerGroup.value
  if (!group) return
  await setActiveView('Documentos')
  await nextTick()
  documentCreatorRef.value?.newDocumentWithContext?.({
    groupId: group.id,
    date,
    ...session,
  })
}

function fitClassroom() {
  gradebookRef.value?.fitRoom?.()
}

function openClassroomLayoutDialog() {
  gradebookRef.value?.openLayoutDialog?.()
}

async function saveGradebook({ includeIdentities = false } = {}) {
  if (!gradebookValid.value) {
    firestoreError.value = 'Completa correctamente los nombres antes de salir de la configuración.'
    return false
  }
  if (gradebookSavePromise) await gradebookSavePromise
  if (!gradebookDirty.value) return true

  const saveTask = (async () => {
    isSavingGradebook.value = true
    firestoreError.value = ''
    const savedRevision = gradebookRef.value?.getRevision?.()
    try {
      if (includeIdentities) await gradebookRef.value?.persistLocalIdentities?.()
      const updatedGroup = gradebookRef.value?.getGroup?.()
      if (!updatedGroup) return false
      const previousGroup = teacherGroups.value.find((group) => group.id === updatedGroup.id)
      const previousStudentIds = (previousGroup?.alumnos || []).map((student) => student.id).filter(Boolean)
      const savedGroup = await saveGroup(updatedGroup, previousStudentIds, currentTeacherId.value)
      const savedStudentIds = (savedGroup.alumnos || []).map((student) => student.id).filter(Boolean)
      if (previousStudentIds.slice().sort().join('|') !== savedStudentIds.slice().sort().join('|')) {
        await httpsCallable(functions, 'syncStudentAccessCodes')({ groupId: savedGroup.id, codes: savedStudentIds })
      }
      teacherGroups.value = teacherGroups.value.map((group) => group.id === savedGroup.id ? savedGroup : group)
      if (includeIdentities) {
        try {
          await gradebookRef.value?.finalizeIdentityDeletions?.()
        } catch (error) {
          firestoreError.value = 'El cuaderno se ha guardado, pero no se han podido limpiar algunos datos identificativos locales.'
          console.error('Error al limpiar identidades locales:', error)
        }
      }
      gradebookRef.value?.markSaved?.(savedRevision)
      return true
    } catch (error) {
      firestoreError.value = 'No se ha podido guardar el cuaderno del grupo.'
      console.error('Error al guardar el cuaderno del grupo:', error)
      return false
    } finally {
      isSavingGradebook.value = false
    }
  })()

  gradebookSavePromise = saveTask
  const result = await saveTask
  if (gradebookSavePromise === saveTask) gradebookSavePromise = null
  return result
}

async function toggleGradebookConfiguration() {
  if (!gradebookConfigurationMode.value) {
    gradebookConfigurationMode.value = true
    return
  }
  const saved = await saveGradebook({ includeIdentities: true })
  if (saved) gradebookConfigurationMode.value = false
}

async function setActiveView(view) {
  if (active.value === 'Grupo' && groupView.value === 'programming' && view !== 'Grupo') {
    await programmingRef.value?.flush?.()
  }
  if (active.value === 'Grupo' && view !== 'Grupo' && gradebookDirty.value) {
    const saved = await saveGradebook({ includeIdentities: gradebookConfigurationMode.value })
    if (!saved) return
  }
  if (view !== 'Grupo') gradebookConfigurationMode.value = false
  if (view !== 'Grupo') {
    selectedStudentDetail.value = null
    studentDetailConfigurationMode.value = false
  }
  if (view !== 'Perfil') teacherProfileEditing.value = false
  if (view === 'Documentos') documentsTab.value = 'documents'
  active.value = view
}

function autosaveGradebook(options = {}) {
  void saveGradebook(options)
}

function flushGradebookOnPageHide() {
  if (active.value === 'Grupo' && gradebookDirty.value) {
    void saveGradebook({ includeIdentities: gradebookConfigurationMode.value })
  }
}

function flushGradebookWhenHidden() {
  if (document.visibilityState === 'hidden') flushGradebookOnPageHide()
}

function fitMathConceptView() {
  nextTick(() => mathConceptViewRef.value?.fitView?.())
}

function compileActiveDocument() {
  documentCreatorRef.value?.compile?.()
}

function newActiveDocument() {
  documentCreatorRef.value?.newDocument?.()
}

function closeActiveDocument() {
  documentCreatorRef.value?.backToLibrary?.()
}

function previousDocumentStep() {
  documentCreatorRef.value?.previous?.()
}

function nextDocumentStep() {
  documentCreatorRef.value?.next?.()
}

function saveActiveDocument() {
  documentCreatorRef.value?.save?.()
}

function newActiveRubric() {
  rubricManagerRef.value?.newRubric?.()
}

function closeActiveRubric() {
  rubricManagerRef.value?.closeEditor?.()
}

function saveActiveRubric() {
  rubricManagerRef.value?.save?.()
}

function duplicateActiveRubric() {
  rubricManagerRef.value?.duplicateActive?.()
}

function deleteActiveRubric() {
  rubricManagerRef.value?.requestDeleteActive?.()
}

async function closeSession() {
  if (gradebookDirty.value) await saveGradebook({ includeIdentities: gradebookConfigurationMode.value })
  await signOut(auth)
  active.value = 'Ejercicios'
}

let currentTimeInterval
let stopAuthWatch = null
let loadedTeacherUid = null

async function initializeTeacherWorkspace() {
  await Promise.all([
    loadTeacherSchedule(),
    loadExercises({ reset: true }),
    loadMathConcepts(),
    loadTemplates(),
  ])
}

async function handleAuthenticatedUser(user) {
  authUser.value = user
  authClaims.value = {}
  if (!user) {
    loadedTeacherUid = null
    teacherGroups.value = []
    scheduleBlocks.value = []
    exercises.value = []
    templates.value = []
    return
  }
  let token = await getIdTokenResult(user)
  if (user.email?.toLowerCase() === 'carlos.s@educa.madrid.org'
    && (token.claims.role !== 'teacher' || token.claims.admin !== true)) {
    await httpsCallable(functions, 'bootstrapAdminAccount')()
    await user.getIdToken(true)
    token = await getIdTokenResult(user)
  }
  authClaims.value = token.claims || {}
  if (!['teacher', 'student'].includes(authClaims.value.role)) {
    await signOut(auth)
    throw new Error('Esta cuenta no tiene una invitación válida de Neope.')
  }
  if (authClaims.value.role === 'teacher' && loadedTeacherUid !== user.uid) {
    loadedTeacherUid = user.uid
    if (isAdministrator.value) {
      await httpsCallable(functions, 'bootstrapAdminAccount')()
      await user.getIdToken(true)
      authClaims.value = (await getIdTokenResult(user)).claims || authClaims.value
    }
    await initializeTeacherWorkspace()
  }
}

onMounted(() => {
  stopAuthWatch = onIdTokenChanged(auth, async (user) => {
    try {
      await handleAuthenticatedUser(user)
    } catch (error) {
      console.error('No se ha podido inicializar la sesión:', error)
      showAppErrorToast(error?.message || 'No se ha podido iniciar la sesión de Neope.')
    } finally {
      authReady.value = true
    }
  })
  currentTimeInterval = window.setInterval(() => { currentTime.value = new Date() }, 30_000)
  window.addEventListener('scroll', handleExerciseScroll, { passive: true })
  window.addEventListener('wheel', handleExerciseScroll, { passive: true })
  window.addEventListener('touchmove', handleExerciseScroll, { passive: true })
  window.addEventListener('pagehide', flushGradebookOnPageHide)
  document.addEventListener('visibilitychange', flushGradebookWhenHidden)
})

onBeforeUnmount(() => {
  stopAuthWatch?.()
  window.clearInterval(currentTimeInterval)
  window.cancelAnimationFrame(exerciseScrollFrame)
  window.removeEventListener('scroll', handleExerciseScroll)
  window.removeEventListener('wheel', handleExerciseScroll)
  window.removeEventListener('touchmove', handleExerciseScroll)
  window.removeEventListener('pagehide', flushGradebookOnPageHide)
  document.removeEventListener('visibilitychange', flushGradebookWhenHidden)
  flushGradebookOnPageHide()
  stopWatchingExerciseCompilation()
  exerciseCompilationListWatches.forEach((unsubscribe) => unsubscribe())
  exerciseCompilationListWatches.clear()
  destroyLatexEditor()
  destroyTemplateEditor()
  clearExercisePreviews()
})

</script>

<template>
  <v-app>
    <AuthGateway v-if="!authReady || !authUser || !authRole" />
    <StudentPortal v-else-if="authRole === 'student'" />
    <template v-else>
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
          @click="setActiveView(item.title)"
        />
      </v-list>

      <v-divider class="mx-5 my-3" />

      <v-list nav density="comfortable" class="navigation-list groups-list">
        <v-list-subheader>GRUPOS</v-list-subheader>
        <v-list-item
          v-for="group in groups"
          :key="group.id"
          :prepend-icon="group.icon"
          :title="group.title"
          :subtitle="group.subtitle"
          :active="active === 'Grupo' && selectedCareerGroupId === group.id"
          color="primary"
          @click="openCareerGroup(group)"
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
          <v-list-item :title="currentUserName" subtitle="Profesor" @click="setActiveView('Perfil')">
            <template #prepend><v-avatar color="primary" size="36"><img v-if="isAdministrator" src="/brand/carlos-sanchez-catala.png" alt=""><span v-else>{{ currentUserInitials }}</span></v-avatar></template>
          </v-list-item>
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
        <v-tooltip v-if="isEditingPersistedExercise" text="Eliminar ejercicio" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-delete-outline"
              rounded="circle"
              color="error"
              variant="tonal"
              class="mr-2"
              aria-label="Eliminar ejercicio"
              :disabled="isSavingExercise || isGeneratingVariation || isGeneratingSolution || isCompiling"
              @click="requestDeleteExercise"
            />
          </template>
        </v-tooltip>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" class="app-toolbar-primary-action mr-3" :disabled="!exerciseEditor.enunciado.trim() || isDeletingExercise" :loading="isSavingExercise" @click="saveExercise">Guardar</v-btn>
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
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
      </template>
      <template v-else-if="active === 'Rúbricas'">
        <template v-if="rubricWorkflow.mode === 'library'">
          <v-text-field
            v-model="rubricSearchQuery"
            aria-label="Buscar rúbricas por título"
            placeholder="Buscar por título"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            rounded="pill"
            clearable
            hide-details
            class="app-toolbar-search"
          />
          <v-select
            v-model="rubricSubjectFilter"
            :items="rubricSubjectOptions"
            item-title="title"
            item-value="value"
            aria-label="Filtrar rúbricas por asignatura"
            placeholder="Todas las asignaturas"
            prepend-inner-icon="mdi-school-outline"
            variant="outlined"
            density="compact"
            rounded="pill"
            clearable
            hide-details
            class="rubric-toolbar-subject"
          />
          <v-spacer />
          <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action mr-3" @click="newActiveRubric">Nueva rúbrica</v-btn>
          <v-spacer />
        </template>
        <template v-else>
          <v-btn variant="text" prepend-icon="mdi-arrow-left" class="app-toolbar-back ml-1" :disabled="rubricWorkflow.isSaving" @click="closeActiveRubric">Rúbricas</v-btn>
          <v-spacer />
          <v-tooltip v-if="rubricWorkflow.persisted" text="Duplicar rúbrica" location="bottom">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-content-copy" rounded="circle" variant="text" aria-label="Duplicar rúbrica" @click="duplicateActiveRubric" /></template>
          </v-tooltip>
          <v-tooltip v-if="rubricWorkflow.persisted" text="Eliminar rúbrica" location="bottom">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-delete-outline" rounded="circle" variant="text" color="error" aria-label="Eliminar rúbrica" @click="deleteActiveRubric" /></template>
          </v-tooltip>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" class="app-toolbar-primary-action mr-3 ml-2" :disabled="!rubricWorkflow.canSave" :loading="rubricWorkflow.isSaving" @click="saveActiveRubric">Guardar</v-btn>
        </template>
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
      </template>
      <template v-else-if="active === 'Documentos'">
        <v-btn-toggle :model-value="documentsTab" mandatory density="compact" class="calendar-toolbar-modes documents-toolbar-tabs" aria-label="Sección de documentos" @update:model-value="documentsTab = $event">
          <v-btn value="documents">Documentos</v-btn>
          <v-btn value="templates">Plantillas</v-btn>
        </v-btn-toggle>
        <template v-if="documentsTab === 'documents' && documentWorkflow.mode === 'library'">
          <v-text-field
            v-model="documentSearchQuery"
            aria-label="Buscar documentos"
            placeholder="Buscar documentos"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            density="compact"
            rounded="pill"
            clearable
            hide-details
            class="app-toolbar-search"
          />
          <v-spacer />
          <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action mr-3" @click="newActiveDocument">Nuevo documento</v-btn>
          <v-spacer />
        </template>
        <template v-else-if="documentsTab === 'documents' && documentWorkflow.mode === 'viewer'">
          <v-btn variant="text" prepend-icon="mdi-arrow-left" class="app-toolbar-back ml-1" @click="closeActiveDocument">Documentos</v-btn>
          <v-spacer />
          <span class="document-toolbar-step">Vista del documento</span>
          <v-spacer />
        </template>
        <template v-else-if="documentsTab === 'documents'">
          <v-btn variant="text" prepend-icon="mdi-arrow-left" class="app-toolbar-back ml-1" :disabled="isCompilingDocument" @click="closeActiveDocument">Documentos</v-btn>
          <v-spacer />
          <span class="document-toolbar-step">Paso {{ documentWorkflow.step }} de {{ documentWorkflow.totalSteps || 4 }}</span>
          <v-spacer />
          <v-btn v-if="documentWorkflow.step > 1" variant="text" prepend-icon="mdi-chevron-left" :disabled="isCompilingDocument" @click="previousDocumentStep">Anterior</v-btn>
          <v-tooltip v-if="documentWorkflow.step === 4" text="Recompilar documento" location="bottom">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-refresh" variant="text" color="primary" aria-label="Recompilar documento" :loading="isCompilingDocument" @click="compileActiveDocument" /></template>
          </v-tooltip>
          <v-btn
            v-if="documentWorkflow.step < (documentWorkflow.totalSteps || 4)"
            color="primary"
            variant="flat"
            append-icon="mdi-chevron-right"
            class="app-toolbar-primary-action mr-3 ml-2"
            :disabled="!documentWorkflow.canContinue || isCompilingDocument"
            @click="nextDocumentStep"
          >Siguiente</v-btn>
          <template v-else>
            <v-btn
              color="primary"
              variant="flat"
              prepend-icon="mdi-content-save-outline"
              class="app-toolbar-primary-action mr-3 ml-2"
              :disabled="!documentWorkflow.canSave"
              :loading="documentWorkflow.isSaving"
              @click="saveActiveDocument"
            >Guardar</v-btn>
          </template>
        </template>
        <template v-else>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action ml-2" @click="openNewTemplate">Nueva plantilla</v-btn>
          <v-btn variant="text" prepend-icon="mdi-upload-outline" class="ml-2" @click="chooseTemplateFile">Importar .tex</v-btn>
          <v-spacer />
          <v-btn v-if="selectedTemplate" color="error" variant="text" prepend-icon="mdi-delete-outline" :loading="isSavingTemplate" @click="removeTemplate">Eliminar</v-btn>
          <v-btn v-if="isEditingTemplate" color="primary" variant="flat" prepend-icon="mdi-content-save-outline" class="app-toolbar-primary-action mr-3 ml-2" :disabled="!templateEditor.nombre.trim() || !templateEditor.codigo.trim()" :loading="isSavingTemplate" @click="saveTemplate">Guardar</v-btn>
        </template>
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
      </template>
      <template v-else-if="active === 'Grupo'">
        <template v-if="selectedStudentDetail">
          <v-btn variant="text" prepend-icon="mdi-arrow-left" class="ml-2" @click="closeStudentDetail">Volver</v-btn>
          <v-spacer />
          <v-tooltip :text="studentDetailConfigurationMode ? 'Finalizar edición' : 'Configurar datos del alumno'" location="bottom">
            <template #activator="{ props }">
              <v-btn v-bind="props" icon="mdi-cog-outline" rounded="circle" :color="studentDetailConfigurationMode ? 'primary' : undefined" :variant="studentDetailConfigurationMode ? 'tonal' : 'text'" class="mr-2" aria-label="Configurar datos del alumno" @click="toggleStudentDetailConfiguration" />
            </template>
          </v-tooltip>
        </template>
        <template v-else>
        <v-tooltip v-if="groupView !== 'programming'" :text="gradebookConfigurationMode ? 'Finalizar y guardar configuración' : 'Configurar cuaderno'" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-cog-outline"
              rounded="circle"
              :color="gradebookConfigurationMode ? 'primary' : undefined"
              :variant="gradebookConfigurationMode ? 'tonal' : 'text'"
              class="ml-2"
              aria-label="Configurar cuaderno"
              @click="toggleGradebookConfiguration"
            />
          </template>
        </v-tooltip>
        <v-tooltip v-if="groupView === 'classroom' && gradebookConfigurationMode" text="Configurar disposición" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-view-grid-plus-outline" rounded="circle" variant="text" class="ml-1" aria-label="Configurar disposición" @click="openClassroomLayoutDialog" />
          </template>
        </v-tooltip>
        <v-tooltip v-if="groupView === 'classroom'" text="Encajar aula" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-fit-to-screen-outline" rounded="circle" variant="text" class="ml-1" aria-label="Encajar aula" @click="fitClassroom" />
          </template>
        </v-tooltip>
        <div v-if="groupView === 'classroom'" class="classroom-date-navigator" aria-label="Fecha lectiva mostrada en el aula">
          <v-btn
            icon="mdi-chevron-left"
            rounded="circle"
            variant="text"
            size="small"
            :disabled="classroomDateIndex <= 0"
            aria-label="Día lectivo anterior"
            @click="moveClassroomDate(-1)"
          />
          <span>{{ classroomDateLabel }}</span>
          <v-btn
            icon="mdi-chevron-right"
            rounded="circle"
            variant="text"
            size="small"
            :disabled="classroomDateIndex < 0 || classroomDateIndex >= classroomTeachingDates.length - 1"
            aria-label="Día lectivo siguiente"
            @click="moveClassroomDate(1)"
          />
        </div>
        <v-spacer />
        <v-btn-toggle :model-value="groupView" mandatory density="compact" class="calendar-toolbar-modes" aria-label="Vista del grupo" @update:model-value="setGroupView">
          <v-btn value="evaluation">Evaluación</v-btn>
          <v-btn value="classroom">Aula</v-btn>
          <v-btn value="programming">Programación</v-btn>
        </v-btn-toggle>
        <v-spacer />
        <v-tooltip v-if="gradebookConfigurationMode && groupView === 'evaluation'" text="Añadir alumno" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" prepend-icon="mdi-account-plus-outline" :disabled="!selectedCareerGroup" @click="addGradebookStudent">Alumno</v-btn>
          </template>
        </v-tooltip>
        <v-tooltip v-if="gradebookConfigurationMode && groupView === 'evaluation'" text="Pegar varios alumnos desde una columna" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" prepend-icon="mdi-account-multiple-plus-outline" :disabled="!selectedCareerGroup" @click="addGradebookStudents">Alumnos</v-btn>
          </template>
        </v-tooltip>
        <v-tooltip v-if="gradebookConfigurationMode && groupView === 'evaluation'" text="Añadir un ítem de evaluación" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" prepend-icon="mdi-table-column-plus-after" @click="addGradebookColumn">Ítem</v-btn>
          </template>
        </v-tooltip>
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
        </template>
      </template>
      <template v-else-if="active === 'Calendario'">
        <v-tooltip :text="calendarMode === 'week' ? 'Configurar horario semanal' : calendarMode === 'year' ? 'Configurar calendario escolar' : 'Configuración disponible en la vista semanal y de curso'" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-cog-outline" rounded="circle" class="ml-2" :disabled="calendarMode === 'month'" :color="(scheduleConfigMode || courseCalendarConfigMode) ? 'primary' : undefined" :variant="(scheduleConfigMode || courseCalendarConfigMode) ? 'tonal' : 'text'" :aria-label="calendarMode === 'year' ? 'Configurar calendario escolar' : 'Configurar horario semanal'" @click="toggleCalendarConfiguration" />
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
      </template>
      <template v-else-if="active === 'Perfil'">
        <v-btn variant="text" prepend-icon="mdi-arrow-left" class="app-toolbar-back ml-1" @click="setActiveView('Ejercicios')">Volver</v-btn>
        <v-spacer />
        <v-btn color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action mr-3" @click="addTeacherCenter">Nuevo centro</v-btn>
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
      </template>
      <template v-else>
        <v-toolbar-title v-if="active !== 'Ejercicios' && active !== 'Matemáticas'" class="page-title">{{ active }}</v-toolbar-title>
        <v-text-field
          v-if="active === 'Ejercicios'"
          v-model="exerciseSearchQuery"
          aria-label="Buscar ejercicios por texto o contenidos"
          placeholder="Buscar por texto o contenidos"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          rounded="pill"
          clearable
          hide-details
          class="app-toolbar-search"
        />
        <v-tooltip v-if="active === 'Ejercicios'" text="Filtrar por curso, asignatura y contenidos" location="bottom">
          <template #activator="{ props }">
            <v-badge :content="exerciseSearchFilterCount" :model-value="exerciseSearchFilterCount > 0" color="secondary" offset-x="5" offset-y="5">
              <v-btn v-bind="props" icon="mdi-filter-variant" variant="text" aria-label="Filtrar ejercicios por contenidos" @click="exerciseSearchCurriculumDialog = true" />
            </v-badge>
          </template>
        </v-tooltip>
        <v-spacer v-if="active === 'Ejercicios'" />
        <v-btn v-if="active === 'Ejercicios'" color="primary" variant="flat" prepend-icon="mdi-plus" class="app-toolbar-primary-action app-toolbar-new-exercise mr-2" @click="openNewExercise">Nuevo ejercicio</v-btn>
        <v-spacer v-if="active === 'Ejercicios'" />
        <v-tooltip text="Calendario" location="bottom">
          <template #activator="{ props }"><v-badge :content="calendarNotifications" :model-value="calendarNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-calendar-month-outline" variant="text" aria-label="Calendario" @click="setActiveView('Calendario')" /></v-badge></template>
        </v-tooltip>
        <v-tooltip text="Chat" location="bottom">
          <template #activator="{ props }"><v-badge :content="chatNotifications" :model-value="chatNotifications > 0" color="primary" offset-x="7" offset-y="7"><v-btn v-bind="props" icon="mdi-message-text-outline" variant="text" aria-label="Chat" /></v-badge></template>
        </v-tooltip>
      </template>
      <v-tooltip text="Cerrar sesión" location="bottom">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-logout"
            variant="text"
            class="mr-2"
            aria-label="Cerrar sesión"
            @click="closeSession"
          />
        </template>
      </v-tooltip>
    </v-app-bar>

    <v-main>
      <div class="page-shell" :class="{ 'page-shell-mathematics': active === 'Matemáticas', 'page-shell-rubrics': active === 'Rúbricas', 'page-shell-exercise-search': active === 'Ejercicios' && exerciseView === 'search', 'page-shell-exercise-edit': active === 'Ejercicios' && exerciseView === 'edit', 'page-shell-documents': active === 'Documentos', 'page-shell-documents-templates': active === 'Documentos' && documentsTab === 'templates', 'page-shell-gradebook': active === 'Grupo', 'page-shell-calendar': active === 'Calendario', 'page-shell-profile': active === 'Perfil' }">
        <section v-if="active === 'Matemáticas'" class="mathematics-page">
          <div v-if="isLoadingMathConcepts" class="math-concepts-loading"><v-progress-circular indeterminate color="primary" /><span>Cargando mapa de conceptos…</span></div>
          <MathConceptMap
            v-else
            ref="mathConceptViewRef"
            :nodes="mathConceptNodes"
            :configuration-mode="mathConceptConfigurationMode"
            :active-subject-id="activeMathSubjectId"
            :subject-node-ids="activeMathSubjectNodeIds"
            :exercise-counts="activeMathExerciseCountByConcept"
            :center-title="activeMathSubjectTitle"
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
        <section v-else-if="active === 'Rúbricas'" class="rubrics-page">
          <RubricManager
            ref="rubricManagerRef"
            :teacher-id="currentTeacherId"
            :subjects="mathSubjects"
            :search-query="rubricSearchQuery"
            :subject-filter="rubricSubjectFilter || ''"
            :ai-model="selectedAiModel"
            @state-change="rubricWorkflow = $event"
          />
        </section>
        <section v-else-if="active === 'Invitaciones'" class="invitations-page">
          <InvitationManager />
        </section>
        <section v-else-if="active === 'Perfil'" class="teacher-profile-page">
          <input ref="profileImageInput" type="file" accept="image/*" multiple hidden @change="uploadProfileImages">
          <header class="teacher-profile-intro">
            <div>
              <span class="teacher-profile-eyebrow">Perfil profesional</span>
              <h1>Centros y cursos</h1>
              <p>Añade los centros donde trabajas o has trabajado. Sus logotipos podrán utilizarse más adelante en los documentos.</p>
            </div>
            <v-avatar size="64" class="teacher-profile-avatar" color="primary"><img v-if="isAdministrator" src="/brand/carlos-sanchez-catala.png" alt=""><span v-else>{{ currentUserInitials }}</span></v-avatar>
          </header>
          <div v-if="!teacherProfile.centros.length" class="teacher-profile-empty">
            <v-icon icon="mdi-school-outline" size="48" />
            <strong>Aún no hay centros registrados</strong>
            <span>Empieza añadiendo un centro y sus cursos.</span>
            <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addTeacherCenter">Añadir centro</v-btn>
          </div>
          <div v-else class="teacher-profile-grid">
            <v-card v-for="(center, index) in teacherProfile.centros" :key="center.id" class="teacher-center-card" variant="outlined">
              <header class="teacher-center-card-header">
                <div class="teacher-center-heading">
                  <div class="teacher-center-logo-mark"><img v-if="center.imagenes[0]?.url" :src="center.imagenes[0].url" :alt="`Logotipo de ${center.centro || 'centro'}`"><v-icon v-else icon="mdi-school-outline" size="19" /></div>
                  <strong>{{ center.centro || 'Nuevo centro' }}</strong>
                </div>
                <v-spacer />
                <span class="teacher-center-course">{{ center.curso || 'Sin curso' }}</span>
                <v-btn v-if="isTeacherCenterEditing(center)" icon="mdi-content-save-outline" size="small" variant="text" color="primary" aria-label="Guardar centro" :loading="isSavingTeacherProfile" @click="saveTeacherCenter(center)" />
                <v-btn v-if="isTeacherCenterEditing(center)" icon="mdi-delete-outline" size="small" variant="text" color="error" aria-label="Eliminar centro" @click="removeTeacherCenter(center)" />
              </header>
              <v-card-text class="teacher-center-card-body">
                <div v-if="isTeacherCenterEditing(center)" class="teacher-center-fields">
                  <v-text-field v-model="center.curso" label="Curso" placeholder="2025 / 2026" variant="outlined" density="comfortable" hide-details />
                  <v-text-field v-model="center.centro" label="Nombre del centro" placeholder="IES ..." variant="outlined" density="comfortable" hide-details />
                </div>
                <div v-else class="teacher-center-readonly">
                  <p>{{ center.descripcion || 'Sin descripción.' }}</p>
                  <div class="teacher-center-readonly-actions">
                    <v-btn class="teacher-center-edit-btn" icon="mdi-pencil-outline" size="small" variant="text" color="primary" aria-label="Editar centro" @click="editTeacherCenter(center)" />
                  </div>
                </div>
                <v-textarea v-if="isTeacherCenterEditing(center)" v-model="center.descripcion" label="Descripción" placeholder="Puesto, etapa o información relevante" variant="outlined" density="comfortable" rows="3" auto-grow hide-details />
                <div v-if="isTeacherCenterEditing(center)" class="teacher-center-logos">
                  <div class="teacher-center-logos-heading"><strong>Logotipos</strong><v-btn v-if="isTeacherCenterEditing(center)" size="small" variant="tonal" color="primary" prepend-icon="mdi-image-plus-outline" @click="openProfileImagePicker(center)">Añadir imágenes</v-btn></div>
                  <div v-if="center.imagenes.length" class="teacher-center-logo-grid">
                    <div v-for="image in center.imagenes" :key="image.id" class="teacher-center-logo">
                      <img :src="image.url" :alt="image.nombre">
                      <v-btn v-if="isTeacherCenterEditing(center)" icon="mdi-close" size="x-small" variant="flat" color="error" aria-label="Eliminar imagen" @click="removeProfileImage(center, image)" />
                    </div>
                  </div>
                  <span v-else class="teacher-center-no-logos">Todavía no hay imágenes.</span>
                </div>
              </v-card-text>
            </v-card>
          </div>
          <LocalStudentDataTransfer />
        </section>
        <section v-else-if="active === 'Ejercicios'" class="exercises-page">
          <template v-if="exerciseView === 'search'">
            <div v-if="isLoadingExercises" class="exercise-grid-empty"><v-progress-circular indeterminate color="primary" /><span>Cargando ejercicios…</span></div>
            <MasonryGrid v-else-if="filteredExercises.length" :items="filteredExercises" :item-key="(exercise) => exercise.id" class="exercise-results-grid">
              <template #default="{ item: exercise }">
                <v-card class="exercise-result-card" elevation="0">
                  <header class="exercise-result-header">
                    <div class="exercise-result-toolbar">
                      <span class="exercise-result-subject" :title="exerciseSubjectLabel(exercise)">{{ exerciseSubjectLabel(exercise) }}</span>
                    </div>
                    <ExerciseVariantSelector
                      :model-value="searchExerciseVersionIndex(exercise)"
                      :variations="exercise.variaciones || []"
                      compact
                      @update:model-value="setSearchExerciseVersion(exercise, $event)"
                    />
                  </header>
                  <div class="exercise-result-pdf">
                    <div
                      v-if="searchExerciseThumbnail(exercise)"
                      class="exercise-result-thumbnail-frame"
                      :style="searchExerciseThumbnailStyle(exercise)"
                    >
                      <img
                        :src="searchExerciseThumbnail(exercise)"
                        :alt="`Enunciado del ejercicio ${exercise.id}`"
                        :width="searchExerciseThumbnailMetadata(exercise)?.width || undefined"
                        :height="searchExerciseThumbnailMetadata(exercise)?.height || undefined"
                        class="exercise-result-thumbnail"
                        loading="lazy"
                        decoding="async"
                        @load="revealSearchExerciseThumbnail"
                      >
                    </div>
                    <ExercisePdfPreview
                      v-else-if="searchExercisePdf(exercise)"
                      :src="searchExercisePdf(exercise)"
                      :aspect-ratio="searchExercisePdfAspectRatio(exercise)"
                      :title="`Enunciado de la versión ${searchExerciseVersionIndex(exercise)} del ejercicio ${exercise.id}`"
                      thumbnail
                      :generate-thumbnail="searchExerciseVersionIndex(exercise) === 0"
                      @page-metrics="searchExerciseVersionIndex(exercise) === 0 && rememberExercisePdfMetrics(exercise, $event)"
                      @thumbnail-ready="persistExerciseThumbnail(exercise, $event)"
                    />
                    <div v-else class="exercise-result-no-pdf"><v-icon icon="mdi-file-pdf-box" size="38" /><span>PDF pendiente</span></div>
                    <v-tooltip text="Editar ejercicio" location="top">
                      <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-pencil-outline" size="x-small" color="primary" variant="flat" elevation="0" class="exercise-card-edit" aria-label="Editar ejercicio" @click="editExercise(exercise)" /></template>
                    </v-tooltip>
                  </div>
                  <footer class="exercise-result-concepts" :title="exerciseConceptLabel(exercise)">
                    <span v-html="exerciseConceptRichLabel(exercise)" />
                    <v-icon v-if="exercise.curriculum.competencial" icon="mdi-lightbulb-on-outline" size="14" class="exercise-result-competency" title="Ejercicio competencial" />
                  </footer>
                  <footer class="exercise-result-authors">
                    <span :title="`Autor del enunciado: ${searchExerciseAuthors(exercise).statement}`"><strong>Enunciado</strong> · {{ searchExerciseAuthors(exercise).statement }}</span>
                    <span class="exercise-result-toolbar-spacer" />
                    <span :title="`Autor de la solución: ${searchExerciseAuthors(exercise).solution}`"><strong>Solución</strong> · {{ searchExerciseAuthors(exercise).solution }}</span>
                  </footer>
                </v-card>
              </template>
            </MasonryGrid>
            <div v-else class="exercise-grid-empty">
              <v-progress-circular v-if="hasMoreExercises" indeterminate color="primary" size="30" width="3" />
              <v-icon v-else icon="mdi-file-search-outline" size="42" />
              <span>{{ hasMoreExercises ? 'Buscando ejercicios coincidentes…' : 'No hay ejercicios que coincidan con los filtros.' }}</span>
            </div>
            <div v-if="!isLoadingExercises && hasMoreExercises" class="exercise-load-sentinel" aria-live="polite">
              <template v-if="isLoadingMoreExercises">
                <v-progress-circular indeterminate color="primary" size="22" width="2" />
                <span>Cargando más ejercicios…</span>
              </template>
            </div>
          </template>

          <template v-else>
            <div class="exercise-edit-workspace">
              <section class="exercise-editor-pane" aria-label="Contenido del ejercicio">
                <div class="exercise-editor-toolbar">
                  <v-tabs :model-value="exerciseEditorTab" density="compact" @update:model-value="selectExerciseEditorTab">
                    <v-tab value="code">Código</v-tab>
                    <v-tab value="contents">Contenidos</v-tab>
                    <v-tab value="competencies">Competencias</v-tab>
                    <v-tab value="files">Archivos</v-tab>
                  </v-tabs>
                  <v-spacer />
                  <span v-if="exerciseEditorTab === 'contents'" class="exercise-content-toolbar-label">{{ selectedContentTargetLabel() }}</span>
                  <span v-if="exerciseEditorTab === 'competencies'" class="exercise-content-toolbar-label">{{ selectedCompetencyTargetLabel() }}</span>
                  <v-tooltip v-if="exerciseEditorTab === 'code'" text="Formatear código LaTeX" location="bottom">
                    <template #activator="{ props }">
                      <v-btn
                        v-bind="props"
                        icon="mdi-format-indent-increase"
                        size="x-small"
                        rounded="circle"
                        variant="text"
                        color="primary"
                        class="exercise-code-format exercise-segment-icon"
                        aria-label="Formatear código LaTeX"
                        @click="formatExerciseLatex"
                      />
                    </template>
                  </v-tooltip>
                </div>
                <div v-show="exerciseEditorTab === 'code'" ref="latexEditorHost" class="latex-editor-shell exercise-editor-shell" />
                <div v-show="exerciseEditorTab === 'contents'" class="exercise-editor-curriculum">
                  <ExerciseCurriculumPicker
                    v-model="exerciseContentModel"
                    :nodes="mathConceptNodes"
                    :subject-selections="mathConceptSubjectSelections"
                    :exercise-counts="editorExerciseCountByConcept"
                  />
                </div>
                <div v-show="exerciseEditorTab === 'competencies'" class="exercise-editor-competencies">
                  <ExerciseCompetencyEditor
                    :model-value="activeExerciseStructure"
                    :target="exerciseCompetencyTarget"
                    :curriculum="{ ...exerciseEditor.curriculum, ...(exerciseAiCurriculum() || {}) }"
                    :subjects="mathSubjects"
                    :ai-model="selectedAiModel"
                    :latex="activeExerciseCode"
                    @update:model-value="updateExerciseCompetencies"
                    @update:target="exerciseCompetencyTarget = $event"
                    @generated="exerciseEditor.curriculum.competencial = true"
                  />
                </div>
                <div v-show="exerciseEditorTab === 'files'" class="exercise-editor-files">
                  <input ref="exerciseAttachmentInput" type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" multiple hidden @change="uploadExerciseFiles" />
                  <div class="exercise-files-actions">
                    <div>
                      <strong>Archivos del ejercicio</strong>
                      <span>Imágenes y otros recursos que podrá utilizar el código LaTeX.</span>
                    </div>
                    <v-btn color="primary" variant="tonal" prepend-icon="mdi-paperclip-plus" :loading="isUploadingExerciseFiles" @click="openExerciseFilePicker">Añadir archivos</v-btn>
                  </div>
                  <div v-if="exerciseEditor.archivos.length" class="exercise-files-list">
                    <v-card v-for="file in exerciseEditor.archivos" :key="file.path" variant="outlined" class="exercise-file-card">
                      <v-icon :icon="file.type.startsWith('image/') ? 'mdi-file-image-outline' : 'mdi-file-outline'" color="primary" size="28" />
                      <div class="exercise-file-info">
                        <strong :title="file.originalName">{{ file.nombre }}</strong>
                        <span>{{ file.originalName }} · {{ formatFileSize(file.size) }}</span>
                        <code>\includegraphics&#123;{{ file.latexName }}&#125;</code>
                      </div>
                      <v-btn :href="file.url" target="_blank" icon="mdi-open-in-new" size="small" variant="text" aria-label="Abrir archivo" />
                      <v-btn icon="mdi-delete-outline" size="small" variant="text" color="error" aria-label="Eliminar archivo" @click="removeExerciseFile(file)" />
                    </v-card>
                  </div>
                  <div v-else class="exercise-files-empty">
                    <v-icon icon="mdi-image-multiple-outline" size="46" color="primary" />
                    <p>Este ejercicio todavía no tiene archivos asociados.</p>
                  </div>
                </div>
              </section>
              <section class="exercise-preview-pane" aria-label="PDF compilado del ejercicio">
                <div class="exercise-structured-preview">
                  <article class="exercise-preview-block exercise-preview-main-block">
                    <div class="exercise-segment-bars exercise-main-bars">
                      <div class="exercise-preview-toolbar exercise-segment-actions">
                        <v-tabs v-model="exercisePreviewTab" density="compact">
                          <v-tab value="statement">Enunciado</v-tab>
                          <v-tab value="solution" :disabled="!hasExerciseSolutions(activeExerciseCode)">Resuelto</v-tab>
                        </v-tabs>
                        <v-spacer />
                        <div class="exercise-preview-variation-actions">
                        <v-tooltip :text="activeExerciseHasSections ? 'Seleccionar contenidos del ejercicio completo' : 'Seleccionar contenidos'" location="bottom">
                          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-chart-donut-variant" size="x-small" variant="tonal" color="primary" rounded="circle" class="exercise-segment-icon" :aria-label="activeExerciseHasSections ? 'Seleccionar contenidos del ejercicio completo' : 'Seleccionar contenidos'" @click="selectExercisePartContents(activeExerciseHasSections ? 'global' : 'exercise')" /></template>
                        </v-tooltip>
                        <v-tooltip :text="activeExerciseHasSections ? 'Desglosar competencias por apartados' : 'Desglosar competencias del ejercicio'" location="bottom">
                          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-shield-star-outline" size="x-small" variant="tonal" color="primary" rounded="circle" class="exercise-segment-icon" :aria-label="activeExerciseHasSections ? 'Desglosar competencias por apartados' : 'Desglosar competencias del ejercicio'" @click="selectExercisePartCompetencies()" /></template>
                        </v-tooltip>
                        <v-tooltip v-if="selectedExerciseVersion === 0" text="Generar todas las soluciones" location="bottom">
                          <template #activator="{ props }">
                            <v-btn v-bind="props" icon="mdi-auto-fix" size="x-small" variant="tonal" color="primary" rounded="circle" class="exercise-segment-icon" aria-label="Generar todas las soluciones" :disabled="hasExerciseSolutions(activeExerciseCode)" :loading="isGeneratingSolution" @click="generateOriginalExerciseSolution" />
                          </template>
                        </v-tooltip>
                        <v-tooltip v-if="selectedExerciseVersion === 0 && hasExerciseSolutions(activeExerciseCode)" text="Eliminar todas las soluciones" location="bottom">
                          <template #activator="{ props }">
                            <v-btn v-bind="props" icon="mdi-eraser" size="x-small" variant="tonal" color="error" rounded="circle" class="exercise-segment-icon" aria-label="Eliminar todas las soluciones" :disabled="isGeneratingSolution" :loading="isDeletingSolution" @click="deleteOriginalExerciseSolution" />
                          </template>
                        </v-tooltip>
                        <v-tooltip v-if="selectedExerciseVersion > 0" text="Eliminar variante" location="bottom">
                          <template #activator="{ props }">
                            <v-btn v-bind="props" icon="mdi-delete-outline" size="x-small" variant="tonal" color="error" rounded="circle" class="exercise-segment-icon" aria-label="Eliminar variante" :disabled="isGeneratingSolution" @click="deleteSelectedVariation" />
                          </template>
                        </v-tooltip>
                        <v-tooltip text="Compilar todas las vistas previas" location="bottom">
                          <template #activator="{ props }">
                            <v-btn v-bind="props" icon="mdi-refresh" size="x-small" rounded="circle" variant="text" color="primary" class="exercise-preview-compile exercise-segment-icon" aria-label="Compilar todas las vistas previas" :disabled="!activeExerciseCode.trim()" :loading="isCompiling" @click="refreshLatexRender" />
                          </template>
                        </v-tooltip>
                        <span v-if="exerciseCompilationStatus !== 'ready'" class="exercise-compilation-status" role="status">{{ exerciseCompilationLabel }}</span>
                        </div>
                      </div>
                      <div class="exercise-segment-metrics">
                        <strong class="exercise-segment-metrics-title">{{ activeExerciseHasSections ? 'Total' : 'Ejercicio' }}</strong>
                        <div class="exercise-metrics" :class="{ 'exercise-metrics-readonly': activeExerciseHasSections }">
                          <template v-if="activeExerciseHasSections">
                            <span><strong>{{ activeExerciseStructure.puntuacion }}</strong> pt</span>
                            <span><strong>{{ activeExerciseStructure.tiempo }}</strong> min</span>
                          </template>
                          <template v-else>
                            <label>Puntos<input :value="activeExerciseStructure.puntuacion" type="number" min="0" step="0.25" @change="updateExerciseMetric('puntuacion', $event.target.value)" /></label>
                            <label>Minutos<input :value="activeExerciseStructure.tiempo" type="number" min="0" step="1" @change="updateExerciseMetric('tiempo', $event.target.value)" /></label>
                          </template>
                        </div>
                        <v-spacer />
                        <v-btn-toggle
                          v-if="activeExerciseHasSections"
                          :model-value="exercisePreviewMode"
                          mandatory
                          density="compact"
                          class="exercise-preview-mode-toggle"
                          aria-label="Modo de visualización del ejercicio"
                          @update:model-value="setExercisePreviewMode"
                        >
                          <v-btn value="complete">Completo</v-btn>
                          <v-btn value="segmented">Segmentado</v-btn>
                        </v-btn-toggle>
                      </div>
                    </div>
                    <div v-show="segmentedExercisePreview" class="exercise-preview-document exercise-preview-part-document">
                      <ExercisePdfPreview
                        v-if="mainPartPdfUrl(exercisePreviewTab === 'solution') || mainPartPdfUrl(false)"
                        :src="mainPartPdfUrl(exercisePreviewTab === 'solution') || mainPartPdfUrl(false)"
                        :title="exercisePreviewTab === 'statement' ? 'Enunciado común' : 'Enunciado común resuelto'"
                        crop-bottom
                      />
                      <div v-else class="exercise-preview-empty compact">
                        <v-icon icon="mdi-file-pdf-box" size="38" color="primary" />
                        <p>Todavía no se ha compilado esta parte.</p>
                      </div>
                    </div>
                    <div v-show="!segmentedExercisePreview" class="exercise-preview-document exercise-preview-complete-document">
                      <ExercisePdfPreview
                        v-if="activeCompletePdfUrl"
                        :src="activeCompletePdfUrl"
                        :title="exercisePreviewTab === 'statement' ? 'Ejercicio completo' : 'Ejercicio completo resuelto'"
                        crop-bottom
                      />
                      <div v-else class="exercise-preview-empty compact">
                        <v-icon icon="mdi-file-pdf-box" size="38" color="primary" />
                        <p>Todavía no se ha compilado el ejercicio completo.</p>
                      </div>
                    </div>
                  </article>

                  <article v-for="(apartado, apartadoIndex) in activeExerciseStructure.apartados" v-show="segmentedExercisePreview" :key="apartado.id || apartadoIndex" class="exercise-preview-block" :class="{ 'exercise-preview-block-content-active': (exerciseContentTarget === apartadoIndex && exerciseEditorTab === 'contents') || (exerciseCompetencyTarget === apartadoIndex && exerciseEditorTab === 'competencies') }">
                    <div class="exercise-part-toolbar exercise-segment-actions">
                      <strong class="exercise-part-label">{{ String.fromCharCode(97 + apartadoIndex) }}</strong>
                      <v-spacer />
                      <v-tooltip text="Seleccionar contenidos del apartado" location="bottom">
                        <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-chart-donut-variant" size="x-small" rounded="circle" class="exercise-segment-icon" :variant="exerciseContentTarget === apartadoIndex && exerciseEditorTab === 'contents' ? 'flat' : 'tonal'" color="primary" :aria-label="`Seleccionar contenidos del apartado ${String.fromCharCode(97 + apartadoIndex)}`" @click="selectExercisePartContents(apartadoIndex)" /></template>
                      </v-tooltip>
                      <v-tooltip text="Desglosar competencias del apartado" location="bottom">
                        <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-shield-star-outline" size="x-small" rounded="circle" class="exercise-segment-icon" :variant="exerciseCompetencyTarget === apartadoIndex && exerciseEditorTab === 'competencies' ? 'flat' : 'tonal'" color="primary" :aria-label="`Desglosar competencias del apartado ${String.fromCharCode(97 + apartadoIndex)}`" @click="selectExercisePartCompetencies(apartadoIndex)" /></template>
                      </v-tooltip>
                      <v-tooltip v-if="!apartado.solucion" text="Generar solución de este apartado" location="bottom">
                        <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-auto-fix" size="x-small" rounded="circle" class="exercise-segment-icon" variant="tonal" color="primary" :loading="isGeneratingPartSolution === apartadoIndex" :disabled="isGeneratingPartSolution !== null" :aria-label="`Generar solución del apartado ${String.fromCharCode(97 + apartadoIndex)}`" @click="generateExercisePartSolution(apartadoIndex)" /></template>
                      </v-tooltip>
                      <v-tooltip v-else text="Eliminar solución de este apartado" location="bottom">
                        <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-eraser" size="x-small" rounded="circle" class="exercise-segment-icon" variant="tonal" color="error" :aria-label="`Eliminar solución del apartado ${String.fromCharCode(97 + apartadoIndex)}`" @click="deleteExercisePartSolution(apartadoIndex)" /></template>
                      </v-tooltip>
                    </div>
                    <div class="exercise-part-metrics exercise-segment-metrics">
                      <label>Puntos<input :value="apartado.puntuacion" type="number" min="0" step="0.25" @change="updateExerciseMetric('puntuacion', $event.target.value, apartadoIndex)" /></label>
                      <label>Minutos<input :value="apartado.tiempo" type="number" min="0" step="1" @change="updateExerciseMetric('tiempo', $event.target.value, apartadoIndex)" /></label>
                    </div>
                    <div class="exercise-preview-document exercise-preview-part-document">
                      <ExercisePdfPreview
                        v-if="partPdfUrl(apartado, exercisePreviewTab === 'solution') || partPdfUrl(apartado, false)"
                        :src="partPdfUrl(apartado, exercisePreviewTab === 'solution') || partPdfUrl(apartado, false)"
                        :title="`Apartado ${String.fromCharCode(97 + apartadoIndex)}`"
                        crop-bottom
                      />
                      <div v-else class="exercise-preview-empty compact"><v-icon icon="mdi-file-pdf-box" size="34" color="primary" /><p>PDF pendiente</p></div>
                    </div>
                  </article>
                </div>
                <footer class="exercise-preview-footer" :title="exerciseEditorCurriculumLabel">
                  <v-icon icon="mdi-chart-donut-variant" size="15" />
                  <span>{{ exerciseEditorCurriculumLabel }}</span>
                  <v-icon v-if="exerciseEditor.curriculum.competencial" icon="mdi-lightbulb-on-outline" size="15" class="exercise-preview-competency" title="Ejercicio competencial" />
                </footer>
              </section>
            </div>
          </template>
        </section>

        <section v-else-if="active === 'Documentos' && documentsTab === 'documents'" class="documents-page">
          <DocumentCreator
            ref="documentCreatorRef"
            :templates="templates"
            :exercises="exercises"
            :concept-nodes="mathConceptNodes"
            :subject-selections="mathConceptSubjectSelections"
            :exercise-counts="activeMathExerciseCountByConcept"
            :teacher-profile="teacherProfile"
            :groups="groups"
            :compiler-base-url="compilerBaseUrl"
            :library-query="documentSearchQuery"
            @busy-change="isCompilingDocument = $event"
            @state-change="documentWorkflow = $event"
            @assessment-saved="applyDocumentAssessmentToLoadedGroups"
          />
        </section>

        <section v-else-if="active === 'Documentos' && documentsTab === 'templates'" class="templates-page">
          <input ref="templateFileInput" type="file" accept=".tex,text/x-tex,text/plain" hidden @change="importTemplateFile">
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
              <template v-if="isEditingTemplate">
                <div class="template-editor-fields">
                  <v-text-field v-model="templateEditor.nombre" label="Nombre" density="compact" variant="outlined" hide-details />
                  <v-textarea v-model="templateEditor.descripcion" label="Descripción" rows="2" max-rows="4" auto-grow density="compact" variant="outlined" hide-details />
                </div>
                <v-alert density="compact" variant="tonal" color="primary" icon="mdi-form-textbox" class="template-metadata-help">
                  Marca los argumentos del encabezado con comentarios como <code>%% grupo %%</code>, <code>%% asignatura %%</code>, <code>%% título %%</code> o <code>%% fecha %%</code>. Si una línea contiene varios argumentos, enuméralos en el mismo orden, por ejemplo <code>%% grupo, título, fecha %%</code>.
                  Los entornos y comandos opcionales del ejercicio solo se insertarán cuando estén definidos por la propia plantilla.
                </v-alert>
                <div ref="templateEditorHost" class="latex-editor-shell template-code-editor" />
              </template>
              <div v-else class="template-editor-empty"><v-icon icon="mdi-content-duplicate" size="42" color="primary" /><p>Selecciona una plantilla o crea una nueva desde la toolbar.</p></div>
            </section>
          </div>
        </section>

        <section v-else-if="active === 'Grupo'" class="gradebook-page">
          <StudentDetail
            v-if="selectedCareerGroup && selectedStudentDetail"
            :student="selectedStudentDetail"
            :group="selectedCareerGroup"
            :configuration-mode="studentDetailConfigurationMode"
          />
          <GroupProgramming
            v-else-if="selectedCareerGroup && groupView === 'programming'"
            ref="programmingRef"
            :key="selectedCareerGroup.id"
            :group="selectedCareerGroup"
            :calendar="schoolCalendar"
            :teacher-id="currentTeacherId || ''"
            :templates="preambleOptions"
            :compiler-base-url="compilerBaseUrl"
            @new-document="createProgrammingDocument"
            @assessment-removed="removeProgrammingAssessmentFromLoadedGroup"
          />
          <Gradebook
            v-else-if="selectedCareerGroup && groupView === 'evaluation'"
            ref="gradebookRef"
            :key="selectedCareerGroup.id"
            :group="selectedCareerGroup"
            :existing-student-ids="existingStudentIds"
            :teacher-id="currentTeacherId || ''"
            :configuration-mode="gradebookConfigurationMode"
            @dirty-change="gradebookDirty = $event"
            @validity-change="gradebookValid = $event"
            @autosave-request="autosaveGradebook"
            @student-selected="openStudentDetail"
          />
          <Classroom
            v-else-if="selectedCareerGroup"
            ref="gradebookRef"
            :key="selectedCareerGroup.id"
            :group="selectedCareerGroup"
            :date="classroomDate"
            :existing-student-ids="existingStudentIds"
            :teacher-id="currentTeacherId || ''"
            :configuration-mode="gradebookConfigurationMode"
            @dirty-change="gradebookDirty = $event"
            @validity-change="gradebookValid = $event"
            @autosave-request="autosaveGradebook"
            @student-selected="openStudentDetail"
          />
          <div v-else class="gradebook-empty">Selecciona un grupo en el panel izquierdo.</div>
        </section>

        <section v-else class="calendar-workspace">
          <div v-if="calendarMode === 'month'" class="calendar-grid" :style="{ '--calendar-weeks': calendarDays.length / 7 }">
            <div v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day" class="calendar-weekday">{{ day }}</div>
            <div v-for="(day, index) in calendarDays" :key="index" class="calendar-day" :class="{ 'calendar-day-empty': !day, 'calendar-day-today': isToday(day), 'calendar-weekend': index % 7 >= 5 }" :style="day ? { backgroundColor: displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))?.color } : undefined">
              <span class="calendar-day-number">{{ day }}</span>
              <span v-if="day && schoolCalendarEntryForDate(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))" class="calendar-day-event">{{ courseCalendarEntryTitle(schoolCalendarEntryForDate(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))) }}</span>
              <span v-if="day && displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))?.mensaje" class="calendar-day-message">{{ displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day)).mensaje }}</span>
              <span v-if="day && displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))?.lectivo === false" class="calendar-day-status">No lectivo</span>
              <span v-if="day && displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))?.cursos?.length" class="calendar-day-courses">{{ calendarTypeCourses(displayedSchoolCalendarEntry(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day))) }}</span>
            </div>
          </div>
          <div v-else-if="calendarMode === 'week'" class="week-calendar" :class="{ 'schedule-configuring': scheduleConfigMode }">
            <div class="week-header">
              <div />
              <div v-for="date in weekDays" :key="date.toISOString()" class="week-day" :class="{ 'week-day-today': isTodayDate(date) }">
                <span>{{ new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(date) }}</span>
                <strong v-if="!scheduleConfigMode" class="week-day-number">{{ date.getDate() }}</strong>
                <span v-if="displayedSchoolCalendarEntry(date)" class="week-day-calendar-note">
                  <small v-if="schoolCalendarEntryForDate(date)">{{ courseCalendarEntryTitle(schoolCalendarEntryForDate(date)) }}</small>
                  <small v-if="displayedSchoolCalendarEntry(date).mensaje">{{ displayedSchoolCalendarEntry(date).mensaje }}</small>
                  <small>{{ displayedSchoolCalendarEntry(date).lectivo === false ? 'No lectivo' : 'Lectivo' }}</small>
                  <small v-if="displayedSchoolCalendarEntry(date).cursos?.length">{{ calendarTypeCourses(displayedSchoolCalendarEntry(date)) }}</small>
                </span>
              </div>
            </div>
            <div v-for="(module, moduleIndex) in scheduleModules" :key="`${moduleIndex}-${module.start}-${module.end}`" class="schedule-row" :class="{ 'schedule-break': module.break }" :style="{ '--duration': module.minutes }">
              <div class="schedule-time">
                <template v-if="scheduleConfigMode">
                  <span class="schedule-time-editor schedule-start">
                    <button
                      v-if="moduleIndex > 0"
                      type="button"
                      class="schedule-time-remove"
                      title="Unir los tramos contiguos"
                      aria-label="Eliminar esta división horaria"
                      :disabled="isSavingSchedule"
                      @click.stop="removeScheduleTimePoint(moduleIndex)"
                    ><v-icon icon="mdi-minus" size="11" /></button>
                    <button
                      type="button"
                      class="schedule-time-insert"
                      title="Dividir este tramo"
                      aria-label="Añadir una división dentro de este tramo"
                      :disabled="isSavingSchedule"
                      @click.stop="insertScheduleTimePoint(moduleIndex)"
                    ><v-icon icon="mdi-plus" size="11" /></button>
                    <input
                      type="time"
                      step="300"
                      :value="module.start"
                      :disabled="isSavingSchedule"
                      :aria-label="`Hora ${moduleIndex + 1}: ${module.start}`"
                      @click.stop
                      @change="updateScheduleTimePoint(moduleIndex, $event.target.value, $event.target)"
                    >
                  </span>
                  <span v-if="moduleIndex === scheduleModules.length - 1" class="schedule-time-editor schedule-end">
                    <input
                      type="time"
                      step="300"
                      :value="module.end"
                      :disabled="isSavingSchedule"
                      :aria-label="`Hora final: ${module.end}`"
                      @click.stop
                      @change="updateScheduleTimePoint(moduleIndex + 1, $event.target.value, $event.target)"
                    >
                  </span>
                </template>
                <template v-else>
                  <span class="schedule-start">{{ module.start }}</span>
                  <span v-if="moduleIndex === scheduleModules.length - 1" class="schedule-end">{{ module.end }}</span>
                </template>
              </div>
              <div
                v-for="(date, dayIndex) in weekDays"
                :key="`${module.start}-${date.toISOString()}`"
                class="schedule-cell"
                :class="{
                  'schedule-cell-configurable': scheduleConfigMode,
                  'schedule-cell-filled': scheduleBlock(dayIndex, moduleIndex),
                  'schedule-cell-copy-source': isScheduleCopySource(dayIndex, moduleIndex),
                  'schedule-cell-copy-target': scheduleClipboard && !isScheduleCopySource(dayIndex, moduleIndex),
                }"
                :style="scheduleCellStyle(scheduleBlock(dayIndex, moduleIndex))"
                :aria-label="scheduleConfigMode ? `Configurar ${new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(date)}, ${module.start}` : undefined"
                :role="scheduleConfigMode ? 'button' : undefined"
                :tabindex="scheduleConfigMode ? 0 : -1"
                @click="handleScheduleCellClick(dayIndex, moduleIndex)"
                @keydown.enter.prevent="handleScheduleCellClick(dayIndex, moduleIndex)"
                @keydown.space.prevent="handleScheduleCellClick(dayIndex, moduleIndex)"
              >
                <span v-if="scheduleBlock(dayIndex, moduleIndex)" class="schedule-block">
                  <span class="schedule-block-top"><strong>{{ scheduleBlock(dayIndex, moduleIndex).course }}</strong><small>{{ scheduleBlock(dayIndex, moduleIndex).classroom }}</small></span>
                  <span
                    v-if="scheduleBlock(dayIndex, moduleIndex).type !== 'nonTeaching' && (scheduleBlock(dayIndex, moduleIndex).tutorType || (scheduleBlock(dayIndex, moduleIndex).subject && scheduleBlock(dayIndex, moduleIndex).subject !== scheduleBlock(dayIndex, moduleIndex).course))"
                    class="schedule-block-subject"
                  >{{ scheduleBlock(dayIndex, moduleIndex).tutorType ? scheduleTutorOptions.find((option) => option.value === scheduleBlock(dayIndex, moduleIndex).tutorType)?.title : scheduleBlock(dayIndex, moduleIndex).subject }}</span>
                </span>
                <span v-if="scheduleConfigMode" class="schedule-cell-actions">
                  <button
                    v-if="scheduleBlock(dayIndex, moduleIndex)"
                    type="button"
                    class="schedule-cell-action"
                    :class="{ 'schedule-cell-action-active': isScheduleCopySource(dayIndex, moduleIndex) }"
                    title="Copiar segmento"
                    aria-label="Copiar segmento"
                    @click.stop="copyScheduleBlock(dayIndex, moduleIndex)"
                  ><v-icon icon="mdi-content-copy" size="13" /></button>
                  <button
                    v-if="scheduleBlock(dayIndex, moduleIndex)"
                    type="button"
                    class="schedule-cell-action schedule-cell-action-clear"
                    title="Limpiar segmento"
                    aria-label="Limpiar segmento"
                    :disabled="isSavingSchedule"
                    @click.stop="clearScheduleCell(dayIndex, moduleIndex)"
                  ><v-icon icon="mdi-close" size="14" /></button>
                </span>
                <span v-if="currentTimePosition(date, module)" class="current-time-line" :style="{ top: currentTimePosition(date, module) }" aria-hidden="true" />
              </div>
            </div>
          </div>
          <div v-else class="academic-calendar">
            <section v-for="month in academicMonths" :key="month.toISOString()" class="academic-month">
              <h2>{{ new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(month) }}</h2>
              <div class="academic-weekdays"><span v-for="day in ['L', 'M', 'X', 'J', 'V', 'S', 'D']" :key="day">{{ day }}</span></div>
              <div class="academic-days">
                <v-tooltip
                  v-for="(day, index) in getMonthDays(month)"
                  :key="index"
                  location="top"
                  :disabled="!academicCalendarEntry(month, day)"
                  content-class="school-calendar-tooltip"
                  :content-props="{ style: courseCalendarTooltipStyle(academicCalendarEntry(month, day)) }"
                >
                  <template #activator="{ props }">
                    <button v-bind="props" type="button" class="academic-day" :class="{ 'academic-empty': !day, 'academic-weekend': index % 7 >= 5, 'academic-today': day && month.getMonth() === new Date().getMonth() && month.getFullYear() === new Date().getFullYear() && day === new Date().getDate(), 'academic-day-configurable': courseCalendarConfigMode }" :style="academicCalendarDayStyle(month, day)" :disabled="!day || new Date(month.getFullYear(), month.getMonth(), day).getDay() === 0 || new Date(month.getFullYear(), month.getMonth(), day).getDay() === 6" @click="openCourseCalendarDialog(month, day)">
                      <span>{{ day }}</span>
                    </button>
                  </template>
                  <div class="school-calendar-tooltip-content">
                    <span v-for="(line, lineIndex) in courseCalendarTooltipLines(academicCalendarEntry(month, day))" :key="lineIndex" class="school-calendar-tooltip-line">{{ line }}</span>
                  </div>
                </v-tooltip>
              </div>
            </section>
          </div>
        </section>
      </div>
    </v-main>

    <v-dialog v-model="exerciseSearchCurriculumDialog" max-width="1120" height="min(820px, 88vh)">
      <v-card class="exercise-filter-dialog">
        <v-card-title class="exercise-filter-dialog-title">
          <span>Filtrar por contenidos</span>
          <v-btn icon="mdi-close" variant="text" aria-label="Cerrar filtros" @click="exerciseSearchCurriculumDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text class="exercise-filter-dialog-content">
          <ExerciseCurriculumPicker
            v-model="exerciseSearchCurriculum"
            :nodes="mathConceptNodes"
            :subject-selections="mathConceptSubjectSelections"
            :exercise-counts="searchExerciseCountByConcept"
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-5 py-3">
          <v-btn variant="text" prepend-icon="mdi-filter-off-outline" :disabled="!exerciseSearchFilterCount" @click="clearExerciseCurriculumFilters">Limpiar</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="exerciseSearchCurriculumDialog = false">Aplicar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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

    <v-dialog v-model="exerciseDeleteDialog" max-width="520" :persistent="isDeletingExercise">
      <v-card>
        <v-card-title class="pt-5 px-6">Eliminar ejercicio</v-card-title>
        <v-card-text class="px-6 pb-2">
          <p>Se eliminarán el ejercicio, todas sus variantes, sus PDF, los archivos adjuntos y sus referencias en el mapa de conceptos.</p>
          <p class="text-body-2 text-medium-emphasis mt-3">Esta acción no se puede deshacer.</p>
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn variant="text" :disabled="isDeletingExercise" @click="exerciseDeleteDialog = false">Cancelar</v-btn>
          <v-btn color="error" variant="flat" prepend-icon="mdi-delete-outline" :loading="isDeletingExercise" @click="deleteExercise">Eliminar definitivamente</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="scheduleDialog" max-width="480">
      <v-card>
        <v-card-title class="pt-5 px-6">Configurar segmento horario</v-card-title>
        <v-card-text class="px-6 pb-2">
          <p class="text-body-2 text-medium-emphasis mb-5">Esta configuración se aplicará a este día y tramo horario en todas las semanas.</p>
          <v-text-field v-model="scheduleForm.course" label="Grupo" @update:model-value="updateScheduleCourse" />
          <v-select
            v-if="scheduleForm.course.trim()"
            v-model="scheduleAssignmentValue"
            :items="scheduleAssignmentOptions"
            item-title="title"
            item-value="value"
            label="Asignatura o tutoría"
            clearable
          />
          <v-select
            v-else
            v-model="scheduleForm.nonTeachingKind"
            :items="scheduleSegmentTypeOptions"
            item-title="title"
            item-value="value"
            label="Tipo de segmento"
            clearable
            @update:model-value="selectScheduleSegmentType"
          >
            <template #selection="{ item }"><span class="color-dot mr-3" :style="{ background: item.raw.color }" />{{ item.title }}</template>
            <template #item="{ props, item }"><v-list-item v-bind="props"><template #prepend><span class="color-dot mr-3" :style="{ background: item.raw.color }" /></template></v-list-item></template>
          </v-select>
          <v-text-field v-model="scheduleForm.classroom" label="Aula" />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-btn color="error" variant="text" :disabled="isSavingSchedule || !hasSelectedScheduleBlock" @click="clearScheduleBlock">Limpiar segmento</v-btn>
          <v-spacer />
          <v-btn variant="text" :disabled="isSavingSchedule" @click="scheduleDialog = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="isSavingSchedule" :disabled="!canSaveScheduleBlock" @click="saveScheduleBlock">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="scheduleDeleteDialog" max-width="680">
      <v-card>
        <v-card-title class="pt-5 px-6">Último segmento del grupo</v-card-title>
        <v-card-text class="px-6 pb-2">
          Al eliminar este segmento, el grupo se quedará sin horario. Puedes conservar sus alumnos y calificaciones o eliminar completamente el grupo y todos sus datos.
        </v-card-text>
        <v-card-actions class="schedule-delete-actions px-6 pb-5">
          <v-btn size="small" variant="text" @click="scheduleDeleteDialog = false">Cancelar</v-btn>
          <v-spacer />
          <v-btn size="small" color="primary" variant="text" :loading="isSavingSchedule" @click="scheduleDeleteDialog = false; performClearScheduleBlock()">Conservar grupo</v-btn>
          <v-btn size="small" color="error" variant="flat" :loading="isSavingSchedule" @click="scheduleDeleteDialog = false; performClearScheduleBlock({ deleteGroup: true })">Eliminar grupo y datos</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="courseCalendarDialog" max-width="520">
      <v-card>
        <v-card-title class="pt-5 px-6 course-calendar-dialog-title">{{ selectedCourseCalendarDateLabel }}</v-card-title>
        <v-card-text class="px-6 pb-2">
          <v-select v-model="courseCalendarForm.eventKey" :items="courseCalendarEventOptions" item-title="title" item-value="value" label="Tipo de evento" @update:model-value="selectCourseCalendarEvent">
            <template #selection="{ item }"><span class="color-dot mr-3" :style="{ background: item.raw.color }" />{{ item.title }}</template>
            <template #item="{ props, item }"><v-list-item v-bind="props"><template #prepend><span class="color-dot mr-3" :style="{ background: item.raw.color }" /></template></v-list-item></template>
          </v-select>
          <v-select v-if="selectedCourseCalendarEvent?.requiresCourses" v-model="courseCalendarForm.cursos" :items="academicCalendarCourseOptions" item-title="title" item-value="value" label="Cursos afectados" multiple chips closable-chips hint="Selecciona uno o varios cursos" persistent-hint />
          <v-textarea v-model="courseCalendarForm.mensaje" label="Comentario" rows="2" auto-grow clearable />
        </v-card-text>
        <v-card-actions class="px-6 pb-5">
          <v-btn color="error" variant="text" :disabled="!schoolCalendar.days?.[selectedCourseCalendarDate]" @click="clearCourseCalendarDay">Limpiar día</v-btn>
          <v-spacer />
          <v-btn variant="text" @click="courseCalendarDialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!canSaveCourseCalendarDay" @click="saveCourseCalendarDay">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="exerciseCompilerErrorSnackbar" location="bottom" color="error" timeout="-1" class="exercise-error-snackbar">
      <div class="exercise-error-snackbar-message">{{ compilerError }}</div>
      <template #actions>
        <v-btn variant="text" size="small" @click="copyCompilerError">Copiar</v-btn>
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Cerrar error de compilación" @click="exerciseCompilerErrorSnackbar = false" />
      </template>
    </v-snackbar>
    </template>
    <AppErrorToast />
  </v-app>
</template>
