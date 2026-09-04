<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '../services/firebase'
import { mathSubjects } from '../data/mathCurriculum'
import ExerciseCurriculumPicker from './ExerciseCurriculumPicker.vue'
import ExercisePdfPreview from './ExercisePdfPreview.vue'
import ExerciseVariantSelector from './ExerciseVariantSelector.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import DocumentCodeEditor from './DocumentCodeEditor.vue'
import DocumentAssessmentMatrix from './DocumentAssessmentMatrix.vue'
import MasonryGrid from './MasonryGrid.vue'
import { aggregateExerciseStructure, buildExerciseLatex, mergeExerciseStructure, parseExerciseLatex } from '../utils/exerciseStructure'
import { compactExerciseConceptLabel, exerciseStatementText, exerciseVersionAuthors } from '../utils/exerciseCardMetadata'
import { normalizeDisplayMathDelimiters } from '../utils/latexNormalization'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import { syncDocumentAssessment } from '../services/documentAssessmentRepository'
import { assessmentExerciseModel } from '../utils/documentAssessmentMatrix'

const props = defineProps({
  templates: { type: Array, default: () => [] },
  exercises: { type: Array, default: () => [] },
  conceptNodes: { type: Array, default: () => [] },
  subjectSelections: { type: Object, default: () => ({}) },
  exerciseCounts: { type: Object, default: () => ({}) },
  teacherProfile: { type: Object, default: () => ({ centros: [] }) },
  groups: { type: Array, default: () => [] },
  compilerBaseUrl: { type: String, default: '/compiler-api/v1' },
  libraryQuery: { type: String, default: '' },
})

const emit = defineEmits(['busy-change', 'state-change', 'assessment-saved'])

const baseSteps = Object.freeze([
  { number: 1, title: 'Plantilla', icon: 'mdi-file-document-outline' },
  { number: 2, title: 'Contenidos', icon: 'mdi-chart-donut-variant' },
  { number: 3, title: 'Ejercicios', icon: 'mdi-format-list-numbered' },
  { number: 4, title: 'Vista previa', icon: 'mdi-file-pdf-box' },
])
const steps = computed(() => baseSteps)
const lastStep = computed(() => steps.value.at(-1)?.number || 4)
const ASSESSMENT_PREVIEW_KEY = '__assessment_matrix__'

const defaultMetadata = Object.freeze({
  name: 'Examen',
  command: 'logo',
  fields: [
    { key: 'subject', label: 'Asignatura', argument: 1, type: 'subject', placeholder: 'Matemáticas II' },
    { key: 'title', label: 'Título', argument: 2, type: 'text', placeholder: 'Recuperación -- 2ª Evaluación' },
    { key: 'date', label: 'Fecha', argument: 3, type: 'text', placeholder: '09 / 03 / 26' },
    { key: 'course', label: 'Curso y grupo', argument: 4, type: 'course', placeholder: '2ºBTO VA' },
  ],
  tools: [],
})

const mode = ref('library')
const currentStep = ref(1)
const maxVisitedStep = ref(1)
const documents = ref([])
const isLoadingDocuments = ref(false)
const documentsError = ref('')
watch(documentsError, (message) => {
  if (message) showAppErrorToast(message)
})
const documentDeleteDialog = ref(false)
const documentDeleteTarget = ref(null)
const isDeletingDocument = ref(false)
const selectedDocumentId = ref(null)
const createdAt = ref(null)
const selectedTemplateKey = ref('')
const selectedTemplateKeys = ref([])
const selectedPreviewTemplateKey = ref('')
const lastDocumentPreviewKey = ref('')
const fieldValues = reactive({})
const documentAssessment = reactive({ evaluable: false, groupId: null, shortName: '', gradebookItemId: null })
const documentCurriculum = ref(emptyCurriculum())
const curriculumPickerKey = ref(0)
const exerciseQuery = ref('')
const selectedVersions = reactive({})
const exerciseQueue = ref([])
const optionalRequiredCount = ref(1)
const previewUrl = ref('')
const previewBlob = ref(null)
const previewCode = ref('')
const previewAssetSignature = ref('')
const previewDocuments = ref([])
const documentCode = ref('')
const documentCodeNeedsRegeneration = ref(true)
const showDocumentCode = ref(false)
const compileError = ref('')
const compileErrorVisible = ref(false)
const isCompiling = ref(false)
const isSaving = ref(false)
const dragPayload = ref(null)
const viewedDocument = ref(null)
const viewerAssessmentExercises = ref([])
const viewerAssessmentLoading = ref(false)
const queueStructureCache = new WeakMap()
const grayscaleLogoCache = new Map()

function emptyCurriculum() {
  return { course: null, subjectId: null, conceptIds: [], competencial: false }
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

const markerFieldDefinitions = Object.freeze({
  asignatura: { key: 'subject', label: 'Asignatura', type: 'subject', placeholder: 'Matemáticas II' },
  subject: { key: 'subject', label: 'Asignatura', type: 'subject', placeholder: 'Matemáticas II' },
  titulo: { key: 'title', label: 'Título', type: 'text', placeholder: 'Recuperación -- 2ª Evaluación' },
  title: { key: 'title', label: 'Título', type: 'text', placeholder: 'Recuperación -- 2ª Evaluación' },
  fecha: { key: 'date', label: 'Fecha', type: 'date', placeholder: '' },
  date: { key: 'date', label: 'Fecha', type: 'date', placeholder: '' },
  grupo: { key: 'course', label: 'Grupo', type: 'group', placeholder: '2ºBTO B' },
  curso: { key: 'course', label: 'Grupo', type: 'group', placeholder: '2ºBTO B' },
  course: { key: 'course', label: 'Grupo', type: 'group', placeholder: '2ºBTO B' },
})

function markerFieldDefinition(name, argument) {
  const normalized = normalizeName(name)
  const known = markerFieldDefinitions[normalized]
  if (known) return { ...known, argument }
  const key = normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${argument}`
  return { key, label: String(name || key).trim(), type: 'text', placeholder: '', argument }
}

function parseTemplateMarkers(code = '') {
  const markers = [...code.matchAll(/%%\s*([^%\r\n]+?)\s*%%/g)]
    .filter((marker) => code[marker.index - 1] !== '%' && code[marker.index + marker[0].length] !== '%')
  const fields = []
  let command = ''

  markers.forEach((marker) => {
    const beforeMarker = code.slice(0, marker.index)
    const commandMatches = [...beforeMarker.matchAll(/\\newcommand\s*\{\\([A-Za-z@]+)\}(?:\[(\d+)\])?/g)]
    const enclosingCommand = commandMatches[commandMatches.length - 1]?.[1] || ''
    if (!command && enclosingCommand) command = enclosingCommand

    const lineStart = beforeMarker.lastIndexOf('\n') + 1
    const linePrefix = code.slice(lineStart, marker.index)
    const argumentsOnLine = [...linePrefix.matchAll(/#(\d+)/g)].map((match) => Number(match[1]))
    const names = marker[1].split(',').map((name) => name.trim()).filter(Boolean)

    names.forEach((name, index) => {
      const argument = argumentsOnLine[index]
      if (!argument) return
      fields.push(markerFieldDefinition(name, argument))
    })
  })

  const uniqueFields = []
  const seen = new Set()
  fields.sort((left, right) => left.argument - right.argument).forEach((field) => {
    const identity = `${field.argument}:${field.key}`
    if (seen.has(identity)) return
    seen.add(identity)
    uniqueFields.push(field)
  })
  return { command, fields: uniqueFields }
}

function parseTemplateMetadata(code = '') {
  try {
    const markerMetadata = parseTemplateMarkers(code)
    const fields = markerMetadata.fields
    if (!fields.length) return null
    const declaredTools = [...code.matchAll(/^\s*%\s*neope:tool\s+(\{.*\})\s*$/gm)]
      .flatMap((match) => {
        try { return [JSON.parse(match[1])] } catch { return [] }
      })
    const tools = declaredTools
      .filter((tool) => tool?.id && (tool.code || tool.command))
      .map((tool) => ({
        id: String(tool.id),
        label: tool.label || tool.name || tool.id,
        description: tool.description || 'Inserta un bloque LaTeX en el documento.',
        icon: tool.icon || 'mdi-tools',
        code: tool.code || `\\${String(tool.command).replace(/^\\/, '')}`,
        arguments: Array.isArray(tool.arguments) ? tool.arguments.filter((argument) => argument?.key && argument?.label).map((argument) => ({
          key: String(argument.key),
          label: String(argument.label),
          type: argument.type || 'text',
          default: argument.default,
          min: argument.min,
          max: argument.max,
        })) : [],
      }))
    return {
      name: 'Documento',
      command: markerMetadata.command || 'logo',
      tools,
      fields,
    }
  } catch (error) {
    console.warn('Metadatos de plantilla no válidos:', error)
    return null
  }
}

const documentTemplates = computed(() => {
  return props.templates.flatMap((template) => {
    const metadata = parseTemplateMetadata(template.codigo)
    if (!metadata) return []
    return [{
      ...template,
      key: template.id || template.archivo,
      metadata: {
        ...metadata,
        name: template.nombre || 'Documento',
      },
    }]
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
})

const selectedTemplate = computed(() => documentTemplates.value.find((template) => template.key === selectedTemplateKey.value) || null)
const selectedMetadata = computed(() => selectedTemplate.value?.metadata || defaultMetadata)
const selectedTemplates = computed(() => selectedTemplateKeys.value
  .map((key) => documentTemplates.value.find((template) => template.key === key))
  .filter(Boolean))
const previewTemplate = computed(() => selectedTemplates.value.find((template) => template.key === selectedPreviewTemplateKey.value)
  || selectedTemplates.value.find((template) => template.key === lastDocumentPreviewKey.value)
  || selectedTemplates.value[0]
  || selectedTemplate.value)
const unifiedFields = computed(() => {
  const result = []
  const seen = new Set()
  selectedTemplates.value.forEach((template) => template.metadata.fields.forEach((field) => {
    const identity = normalizeName(field.label || field.key)
    if (seen.has(identity)) return
    seen.add(identity)
    result.push({ ...field, unifiedKey: field.key })
  }))
  return result.sort((a, b) => a.argument - b.argument)
})
const groupOptions = computed(() => {
  const seen = new Set()
  return props.groups.flatMap((group) => {
    const name = String(group?.nombre || group?.title || '').trim()
    if (!name || seen.has(name)) return []
    seen.add(name)
    return [{
      id: group.id || null,
      title: name,
      value: name,
      course: group.curso || matchCourse(name),
      subject: group.asignatura || group.subtitle || '',
      subjectId: group.subjectId || null,
      studentCount: group.studentsLoaded && Array.isArray(group.alumnos)
        ? group.alumnos.length
        : Number(group.studentCount) || 0,
    }]
  }).sort((left, right) => left.title.localeCompare(right.title, 'es', { numeric: true }))
})
const subjectOptions = computed(() => [...new Set(groupOptions.value.map((group) => group.subject).filter(Boolean))])
const selectedGroupOption = computed(() => {
  const groupField = unifiedFields.value.find((field) => field.type === 'group' || field.type === 'course' || field.key === 'course')
  return groupOptions.value.find((group) => group.value === fieldValues[groupField?.key]) || null
})
const assessmentGroupOption = computed(() => groupOptions.value.find((group) => group.id === documentAssessment.groupId) || null)

function summaryFieldValue(values, aliases) {
  const entries = Object.entries(values || {})
  for (const alias of aliases) {
    if (values?.[alias] !== undefined && String(values[alias]).trim()) return String(values[alias]).trim()
    const normalizedAlias = normalizeName(alias)
    const entry = entries.find(([key, value]) => normalizeName(key) === normalizedAlias && String(value || '').trim())
    if (entry) return String(entry[1]).trim()
  }
  return ''
}

function buildDocumentSummary(values = {}, curriculum = {}, storedGroup = null) {
  const groupName = summaryFieldValue(values, ['course', 'curso', 'group', 'grupo']) || storedGroup?.name || storedGroup?.title || ''
  const liveGroup = groupOptions.value.find((group) => group.value === groupName)
  const group = liveGroup || storedGroup
  const subject = summaryFieldValue(values, ['subject', 'asignatura'])
    || group?.subject
    || mathSubjects.find((item) => item.id === curriculum?.subjectId)?.title
    || ''
  const title = summaryFieldValue(values, ['title', 'titulo'])
  const rawDate = summaryFieldValue(values, ['date', 'fecha'])
  const count = Number(group?.studentCount)
  return {
    group: groupName,
    studentCount: Number.isFinite(count) ? count : null,
    items: [
      subject ? { key: 'subject', label: 'Asignatura', value: subject, icon: 'mdi-function-variant' } : null,
      title ? { key: 'title', label: 'Documento', value: title, icon: 'mdi-file-document-outline' } : null,
      rawDate ? { key: 'date', label: 'Fecha', value: formatDocumentDate(rawDate).replaceAll('/', ' / '), icon: 'mdi-calendar-blank-outline' } : null,
    ].filter(Boolean),
  }
}

const workflowDocumentSummary = computed(() => buildDocumentSummary(fieldValues, documentCurriculum.value, selectedGroupOption.value))
const viewerDocumentSummary = computed(() => buildDocumentSummary(
  viewedDocument.value?.campos || {},
  viewedDocument.value?.curriculum || {},
  viewedDocument.value?.groupContext || null,
))
const currentAcademicYear = computed(() => {
  const today = new Date()
  const startYear = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1
  return `${startYear}-${startYear + 1}`
})
const currentCenter = computed(() => {
  const centers = Array.isArray(props.teacherProfile?.centros) ? props.teacherProfile.centros : []
  if (!centers.length) return null
  const normalizedYear = currentAcademicYear.value.replace(/\D/g, '')
  return centers.find((center) => String(center.curso || '').replace(/\D/g, '') === normalizedYear) || centers[0]
})
const currentCenterLogo = computed(() => currentCenter.value?.imagenes?.find((image) => image?.url)?.url || '')
const filteredDocuments = computed(() => {
  const query = normalizeName(props.libraryQuery)
  if (!query) return documents.value
  return documents.value.filter((documentData) => normalizeName([
    documentData.plantilla?.nombre,
    documentCardTitle(documentData),
    ...Object.values(documentData.campos || {}),
  ].join(' ')).includes(query))
})
const selectedExercises = computed(() => exerciseQueue.value.filter((item) => item.type !== 'tool'))
const documentTools = computed(() => {
  const declared = selectedMetadata.value.tools || []
  const builtins = []
  builtins.push({
    id: 'obligatorios',
    label: 'Obligatorios',
    description: 'Inicia una sección de ejercicios obligatorios',
    icon: '',
    code: '\\item[] \\textsf{\\textbf{El alumno debe responder obligatoriamente los siguientes ejercicios}}',
    arguments: [],
  })
  builtins.push({
    id: 'optativos',
    label: 'Optatividad',
    description: 'Inicia una sección de ejercicios optativos',
    icon: '',
    code: null,
    arguments: [{ key: 'count', label: 'Ejercicios a elegir', type: 'number', default: 1, min: 1 }],
  })
  builtins.push({
    id: 'salto-pagina',
    label: 'Salto de página',
    description: 'Inserta un salto de página',
    icon: '',
    code: '\\newpage',
    arguments: [],
  })
  const tools = [...declared, ...builtins]
  return tools
    .filter((tool, index) => tools.findIndex((candidate) => candidate.id === tool.id) === index)
    .sort((left, right) => ({ obligatorios: 0, optativos: 1, 'salto-pagina': 2 }[left.id] ?? 3) - ({ obligatorios: 0, optativos: 1, 'salto-pagina': 2 }[right.id] ?? 3))
})
const assessmentFieldsComplete = computed(() => !documentAssessment.evaluable
  || Boolean(documentAssessment.groupId && documentAssessment.shortName.trim()))
const requiredFieldsComplete = computed(() => Boolean(selectedTemplate.value)
  && selectedTemplates.value.length > 0
  && unifiedFields.value.every((field) => String(fieldValues[field.key] || '').trim())
  && assessmentFieldsComplete.value)
const canContinue = computed(() => {
  if (currentStep.value === 1) return requiredFieldsComplete.value
  if (currentStep.value === 2) return Boolean(documentCurriculum.value.subjectId)
  if (currentStep.value === 3) return selectedExercises.value.length > 0
  if (currentStep.value === 4) return documentAssessment.evaluable && previewDocuments.value.length > 0
  return false
})
const workflowState = computed(() => ({
  mode: mode.value,
  step: currentStep.value,
  canContinue: canContinue.value,
  canGoBack: currentStep.value > 1,
  isCompiling: isCompiling.value,
  isSaving: isSaving.value,
  totalSteps: lastStep.value,
  canSave: currentStep.value === lastStep.value && Boolean(previewUrl.value) && !isCompiling.value,
}))

watch(workflowState, (state) => emit('state-change', state), { immediate: true })
watch(selectedPreviewTemplateKey, (key) => {
  if (key && key !== ASSESSMENT_PREVIEW_KEY) lastDocumentPreviewKey.value = key
})
function conceptAncestors(conceptId) {
  const byId = new Map(props.conceptNodes.map((node) => [node.id, node]))
  const ids = []
  let current = byId.get(conceptId)
  while (current) {
    ids.push(current.id)
    current = current.parentId ? byId.get(current.parentId) : null
  }
  return ids
}

function conceptClosure(conceptIds = []) {
  const closure = new Set()
  conceptIds.forEach((id) => conceptAncestors(id).forEach((ancestorId) => closure.add(ancestorId)))
  return closure
}

function terminalConceptIds(conceptIds = []) {
  const selected = [...new Set(conceptIds)]
  return selected.filter((id) => !selected.some((otherId) => otherId !== id && conceptAncestors(otherId).includes(id)))
}

function subjectLabel(exercise) {
  const subject = mathSubjects.find((item) => item.id === exercise?.curriculum?.subjectId)
  return subject ? `${subject.course} · ${subject.title}` : 'Sin asignatura'
}

function conceptLabel(exercise) {
  const byId = new Map(props.conceptNodes.map((node) => [node.id, node]))
  const selected = [...new Set(exercise?.curriculum?.conceptIds || [])].filter((id) => byId.has(id) && id !== 'matematicas')
  const terminal = selected.filter((id) => !selected.some((otherId) => otherId !== id && conceptAncestors(otherId).includes(id)))
  return terminal.map((id) => {
    const titles = []
    let current = byId.get(id)
    while (current && current.id !== 'matematicas') {
      titles.unshift(current.title)
      current = current.parentId ? byId.get(current.parentId) : null
    }
    return titles.join(' · ')
  }).filter(Boolean).join(' / ') || 'Sin conceptos'
}

function cardConceptLabel(exercise) {
  return compactExerciseConceptLabel(exercise?.curriculum?.conceptIds || [], props.conceptNodes)
}

const matchingExercises = computed(() => {
  const query = normalizeName(exerciseQuery.value)
  const filter = documentCurriculum.value
  const queuedIds = new Set(exerciseQueue.value.filter((item) => item.type !== 'tool').map((item) => item.exerciseId))
  return props.exercises.filter((exercise) => {
    if (queuedIds.has(exercise.id)) return false
    const searchText = normalizeName(exerciseStatementText(exercise))
    if (query && !searchText.includes(query)) return false
    if (filter.course && exercise.curriculum?.course !== filter.course) return false
    if (filter.subjectId && exercise.curriculum?.subjectId !== filter.subjectId) return false
    const filteredConceptIds = terminalConceptIds(filter.conceptIds || [])
    if (filteredConceptIds.length) {
      const closure = conceptClosure(exercise.curriculum?.conceptIds || [])
      if (!filteredConceptIds.some((id) => closure.has(id))) return false
    }
    return true
  })
})

function selectedVersionFor(exercise) {
  return exercise ? selectedVersions[exercise.id] || 0 : 0
}

function activeVersion(exercise, version = selectedVersionFor(exercise)) {
  if (!exercise) return null
  return version === 0 ? exercise : exercise.variaciones?.[version - 1] || exercise
}

function versionStructure(exercise, version = selectedVersionFor(exercise)) {
  const active = activeVersion(exercise, version)
  if (!active) return parseExerciseLatex('')
  return mergeExerciseStructure(parseExerciseLatex(active.enunciado || active.codigo || ''), active.structure || active)
}

function metricsForVersion(exercise, version = selectedVersionFor(exercise)) {
  const structure = versionStructure(exercise, version)
  return {
    puntuacion: Number(structure.puntuacion) || 0,
    tiempo: Number(structure.tiempo) || 0,
    apartados: structure.apartados.map((apartado) => ({
      puntuacion: Number(apartado.puntuacion) || 0,
      tiempo: Number(apartado.tiempo) || 0,
    })),
  }
}

function activePdf(exercise) {
  return activeVersion(exercise).pdf?.enunciado || ''
}

function activePdfAspectRatio(exercise) {
  return Number(activeVersion(exercise)?.pdfLayout?.enunciado) || 0
}

function activeThumbnail(exercise) {
  return activeThumbnailMetadata(exercise)?.url || ''
}

function activeThumbnailMetadata(exercise) {
  const version = activeVersion(exercise)
  const thumbnail = version?.preview?.enunciado
  if (!thumbnail?.url) return null
  return !thumbnail.sourceUrl || thumbnail.sourceUrl === version?.pdf?.enunciado
    ? thumbnail
    : null
}

function activeThumbnailAspectRatio(exercise) {
  const thumbnail = activeThumbnailMetadata(exercise)
  const storedRatio = Number(thumbnail?.aspectRatio) || 0
  if (storedRatio > 0) return storedRatio
  const width = Number(thumbnail?.width) || 0
  const height = Number(thumbnail?.height) || 0
  if (width > 0 && height > 0) return width / height
  return activePdfAspectRatio(exercise)
}

function activeThumbnailStyle(exercise) {
  const aspectRatio = activeThumbnailAspectRatio(exercise)
  return aspectRatio > 0 ? { aspectRatio: String(aspectRatio) } : undefined
}

function revealDocumentExerciseThumbnail(event) {
  event.currentTarget?.parentElement?.classList.add('is-loaded')
}

function activeVersionAuthors(exercise) {
  return exerciseVersionAuthors(exercise, selectedVersionFor(exercise))
}

function setSelectedVersion(exercise, version) {
  if (!exercise) return
  selectedVersions[exercise.id] = version
  const queued = exerciseQueue.value.find((item) => item.exerciseId === exercise.id)
  if (queued) {
    queued.version = version
    queued.metrics = metricsForVersion(exercise, version)
  }
  invalidatePreview()
}

function stripBalancedCommands(text, commandNames) {
  const commandPattern = new RegExp(`\\\\(?:${commandNames.join('|')})\\s*\\{`, 'g')
  let result = ''
  let cursor = 0
  for (const match of text.matchAll(commandPattern)) {
    const openingBrace = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let end = openingBrace + 1
    for (; end < text.length && depth > 0; end += 1) {
      if (text[end] === '{' && text[end - 1] !== '\\') depth += 1
      if (text[end] === '}' && text[end - 1] !== '\\') depth -= 1
    }
    if (depth !== 0) break
    result += text.slice(cursor, match.index)
    cursor = end
  }
  return `${result}${text.slice(cursor)}`
}

function statementCode(code = '') {
  let result = code
    .replace(/\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/g, '\n')
    .replace(/\\begin\s*\{ejercicios\}/g, '')
    .replace(/\\end\s*\{ejercicios\}/g, '')
  result = stripBalancedCommands(result, ['sol', 'lsol', 'esol'])
  result = result.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim()
  return /\\ej\b/.test(result) ? result : `\\ej ${result}`
}

function exerciseForQueue(item) {
  return props.exercises.find((exercise) => exercise.id === item.exerciseId) || null
}

function exerciseImageFiles(exercise) {
  return (Array.isArray(exercise?.archivos) ? exercise.archivos : []).filter((file) => file?.url && file?.latexName)
}

function documentExerciseAssetName(exercise, file, index) {
  const exerciseId = String(exercise?.id || 'ejercicio').replace(/[^a-zA-Z0-9_-]/g, '') || 'ejercicio'
  const extension = String(file.compilerName || file.nombre || '').match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'png'
  return `ej_${exerciseId}_${file.latexName || `imagen${index + 1}`}.${extension === 'jpeg' ? 'jpg' : extension}`
}

function rewriteExerciseImageReferences(code, exercise) {
  const files = exerciseImageFiles(exercise)
  if (!files.length || !code.includes('\\includegraphics')) return code
  return code.replace(/\\includegraphics(\*)?\s*(\[[^\]]*\]\s*)?\{([^{}]+)\}/g, (match, star = '', options = '', rawReference) => {
    const reference = String(rawReference).trim().split('/').at(-1).replace(/\.(?:png|jpe?g|pdf)$/i, '')
    const index = files.findIndex((file) => file.latexName === reference)
    if (index === -1) return match
    return `\\includegraphics${star}${options || ''}{${documentExerciseAssetName(exercise, files[index], index)}}`
  })
}

function adaptExerciseEnvironmentsToTemplate(code, template) {
  const templateCode = String(template?.codigo || '')
  const apartadoscNeedsArgument = /\\newenvironment\s*\{apartadosc\}\s*\[1\]/.test(templateCode)
  if (!apartadoscNeedsArgument) return code
  return code.replace(/\\begin\s*\{apartadosc\}(?!\s*\{)/g, '\\begin{apartadosc}{}')
}

function templateDefinesEnvironment(template, environmentName) {
  const code = String(template?.codigo || '')
  const escapedName = String(environmentName).replace(/[^A-Za-z@*]/g, '')
  return new RegExp(`\\\\(?:newenvironment|renewenvironment)\\*?\\s*\\{${escapedName}\\}`, 'i').test(code)
    || new RegExp(`\\\\(?:New|Renew|Provide)DocumentEnvironment\\s*\\{${escapedName}\\}`, 'i').test(code)
    || new RegExp(`\\\\(?:includecomment|excludecomment|NewEnviron|RenewEnviron)\\s*\\{${escapedName}\\}`, 'i').test(code)
    || (templateDefinesCommand(template, escapedName) && templateDefinesCommand(template, `end${escapedName}`))
}

function templateDefinesCommand(template, commandName) {
  const code = String(template?.codigo || '')
  const escapedName = String(commandName).replace(/[^A-Za-z@]/g, '')
  return new RegExp(`\\\\(?:newcommand|renewcommand|providecommand)\\*?\\s*\\{?\\\\${escapedName}\\}?`, 'i').test(code)
    || new RegExp(`\\\\(?:def|gdef|edef|xdef)\\s*\\\\${escapedName}\\b`, 'i').test(code)
}

function queueExerciseCode(item, template = selectedTemplate.value) {
  const exercise = exerciseForQueue(item)
  if (!exercise) return ''
  const sourceVersion = activeVersion(exercise, item.version)
  const structure = versionStructure(exercise, item.version)
  const metrics = item.metrics || metricsForVersion(exercise, item.version)
  if (structure.apartados.length) {
    structure.apartados.forEach((apartado, index) => {
      apartado.puntuacion = Number(metrics.apartados?.[index]?.puntuacion) || 0
      apartado.tiempo = Number(metrics.apartados?.[index]?.tiempo) || 0
    })
  } else {
    structure.puntuacion = Number(metrics.puntuacion) || 0
    structure.tiempo = Number(metrics.tiempo) || 0
  }
  const includeSolutions = templateDefinesEnvironment(template, 'solucion')
  const includeAnswers = templateDefinesCommand(template, 'lsol')
    && (!structure.apartados.length || structure.apartados.length === 1 || templateDefinesCommand(template, 'sol'))
  const code = buildExerciseLatex(aggregateExerciseStructure(structure), {
    includeSolutions,
    includeAnswers,
    // Los tiempos son metadatos de planificación de Neope. Las plantillas de
    // documentos no necesitan definir \T ni \t para poder usar ejercicios.
    includeDurationMetadata: false,
  }) || statementCode(sourceVersion?.enunciado || '')
  return rewriteExerciseImageReferences(adaptExerciseEnvironmentsToTemplate(code, template), exercise)
}

function queueExercisePdf(item) {
  const exercise = exerciseForQueue(item)
  return activeVersion(exercise, item.version)?.pdf?.enunciado || ''
}

const assessmentPreviewExercises = computed(() => exerciseQueue.value
  .filter((item) => item.type !== 'tool')
  .map((item, index) => {
    const exercise = exerciseForQueue(item)
    const active = activeVersion(exercise, item.version)
    const structure = versionStructure(exercise, item.version)
    return assessmentExerciseModel({
      exerciseId: item.exerciseId,
      version: Number(item.version) || 0,
      structure: {
        ...structure,
        pdfenunciadocompleto: structure.pdfenunciadocompleto || active?.pdf?.enunciado || '',
        pdfsolucioncompleto: structure.pdfsolucioncompleto || active?.pdf?.resuelto || '',
      },
      order: index,
    })
  }))

const isAssessmentPreviewSelected = computed(() => selectedPreviewTemplateKey.value === ASSESSMENT_PREVIEW_KEY)

function normalizeQueueSections() {
  exerciseQueue.value = exerciseQueue.value.map((item) => ({ ...item, section: 'required' }))
}

function addExercise(exercise, section = 'required') {
  const existingIndex = exerciseQueue.value.findIndex((item) => item.exerciseId === exercise.id)
  let item
  if (existingIndex !== -1) {
    ;[item] = exerciseQueue.value.splice(existingIndex, 1)
  } else {
    const version = selectedVersionFor(exercise)
    item = { type: 'exercise', exerciseId: exercise.id, version, metrics: metricsForVersion(exercise, version) }
  }
  item.section = 'required'
  exerciseQueue.value.push(item)
  normalizeQueueSections()
  invalidatePreview()
}

function updateQueueMetric(item, field, value, apartadoIndex = null) {
  if (!item.metrics) item.metrics = metricsForVersion(exerciseForQueue(item), item.version)
  const number = Math.max(0, Number(value) || 0)
  const normalized = field === 'puntuacion' ? Math.round(number * 4) / 4 : Math.round(number)
  if (typeof apartadoIndex === 'number' && item.metrics.apartados?.[apartadoIndex]) {
    item.metrics.apartados[apartadoIndex][field] = normalized
    item.metrics[field] = item.metrics.apartados.reduce((sum, apartado) => sum + (Number(apartado[field]) || 0), 0)
  } else {
    item.metrics[field] = normalized
  }
  invalidatePreview()
}

function queueMetrics(item) {
  return item.metrics || metricsForVersion(exerciseForQueue(item), item.version)
}

function queueStructure(item) {
  const exercise = exerciseForQueue(item)
  const active = activeVersion(exercise, item.version)
  const source = active?.codigo || active?.enunciado || ''
  const cached = queueStructureCache.get(item)
  if (cached?.version === item.version && cached.source === source) return cached.structure
  const structure = versionStructure(exercise, item.version)
  queueStructureCache.set(item, { version: item.version, source, structure })
  return structure
}

function queueApartados(item) {
  return queueStructure(item).apartados
}

function queueMainPdf(item) {
  const structure = queueStructure(item)
  if (structure.pdfenunciado) return structure.pdfenunciado
  return structure.apartados.length ? '' : queueExercisePdf(item)
}

function queueApartadoPdf(item, apartadoIndex) {
  return queueApartados(item)[apartadoIndex]?.pdfenunciado || ''
}

function removeQueuedExercise(exerciseId) {
  if (String(exerciseId).startsWith('tool:')) {
    const toolId = String(exerciseId).slice(5)
    exerciseQueue.value = exerciseQueue.value.filter((item) => !(item.type === 'tool' && item.toolId === toolId))
  } else {
    exerciseQueue.value = exerciseQueue.value.filter((item) => item.exerciseId !== exerciseId)
  }
  invalidatePreview()
}

function moveQueuedExercise(item, section) {
  return item
}

function startExerciseDrag(event, exercise) {
  dragPayload.value = { type: 'exercise', exerciseId: exercise.id }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', exercise.id)
}

function startQueueDrag(event, item) {
  dragPayload.value = { type: 'queue', itemId: item.type === 'tool' ? item.toolId : item.exerciseId, itemType: item.type || 'exercise' }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', dragPayload.value.itemId)
}

function startToolDrag(event, tool) {
  dragPayload.value = { type: 'tool', toolId: tool.id }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', tool.id)
}

function isTool(item) {
  return item?.type === 'tool'
}

function exerciseOrder(index) {
  return exerciseQueue.value.slice(0, index + 1).filter((item) => !isTool(item)).length
}

function isSectionBoundaryTool(item) {
  return isTool(item) && ['obligatorios', 'optativos'].includes(item.toolId)
}

function exercisesAfterTool(index, toolId) {
  let count = 0
  for (let cursor = index + 1; cursor < exerciseQueue.value.length; cursor += 1) {
    const item = exerciseQueue.value[cursor]
    // La sección termina al encontrar cualquier otro separador de sección;
    // los saltos de página no son separadores y se ignoran aquí.
    if (isSectionBoundaryTool(item)) break
    if (!isTool(item)) count += 1
  }
  return count
}

function exercisesBeforeTool(index) {
  let count = 0
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const item = exerciseQueue.value[cursor]
    if (isSectionBoundaryTool(item)) break
    count += 1
  }
  return count
}

function exercisesAfterAnyBoundary(index) {
  let count = 0
  for (let cursor = index + 1; cursor < exerciseQueue.value.length; cursor += 1) {
    if (!isTool(exerciseQueue.value[cursor])) count += 1
  }
  return count
}

function exercisesAfterAnyTool(index) {
  let count = 0
  for (let cursor = index + 1; cursor < exerciseQueue.value.length; cursor += 1) {
    const item = exerciseQueue.value[cursor]
    if (isSectionBoundaryTool(item)) break
    count += 1
  }
  return count
}

function optionalToolChoiceOptions(index) {
  const count = exercisesAfterTool(index, 'optativos')
  return Array.from({ length: Math.max(0, count - 1) }, (_, option) => option + 1)
}

function toolForQueue(item) {
  return documentTools.value.find((tool) => tool.id === item?.toolId) || null
}

function toolArguments(item, tool) {
  const args = { ...(item?.args || {}) }
  ;(tool?.arguments || []).forEach((argument) => {
    if (args[argument.key] === undefined && argument.default !== undefined) args[argument.key] = argument.default
  })
  return args
}

function setToolArgument(item, key, value) {
  if (!item.args) item.args = {}
  item.args[key] = value
  invalidatePreview()
}

function addTool(tool) {
  exerciseQueue.value.push({ type: 'tool', toolId: tool.id, args: tool.arguments?.reduce((values, argument) => ({ ...values, [argument.key]: argument.default ?? '' }), {}), section: 'required' })
  invalidatePreview()
}

function toolCode(item, index = -1) {
  const tool = toolForQueue(item)
  if (!tool) return ''
  const args = toolArguments(item, tool)
  if (tool.id === 'obligatorios') {
    if (index >= 0 && !exercisesAfterAnyTool(index)) return ''
    return '\\obligatorios'
  }
  if (tool.id === 'salto-pagina') {
    if (index >= 0 && (!exercisesBeforeTool(index) || !exercisesAfterAnyBoundary(index))) return ''
    return '\\salto'
  }
  if (index >= 0 && (!exercisesBeforeTool(index) || !exercisesAfterAnyTool(index))) return ''
  if (tool.id === 'optativos') {
    const available = index >= 0 ? exercisesAfterTool(index, tool.id) : Number(args.count || 0) + 1
    if (available <= 1) return ''
    const count = Math.min(Math.max(1, Number(args.count) || 1), available - 1)
    return `\\optativos{${numberToSpanish(count)}}{${numberToSpanish(available)}}`
  }
  return String(tool.code || '').replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (_, key) => String(args[key] ?? ''))
}

function numberToSpanish(value) {
  const words = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte']
  return words[Number(value)] || String(value)
}

function dropOnQueueSection(event, section, targetExerciseId = null) {
  event.preventDefault()
  const payload = dragPayload.value
  dragPayload.value = null
  if (!payload) return
  if (payload.type === 'exercise') {
    const exercise = props.exercises.find((item) => item.id === payload.exerciseId)
    if (exercise) addExercise(exercise, section)
    return
  }
  if (payload.type === 'tool') {
    const targetIndex = targetExerciseId?.startsWith('tool:')
      ? exerciseQueue.value.findIndex((candidate) => candidate.type === 'tool' && candidate.toolId === targetExerciseId.slice(5))
      : (targetExerciseId ? exerciseQueue.value.findIndex((candidate) => candidate.type !== 'tool' && candidate.exerciseId === targetExerciseId) : -1)
    const tool = documentTools.value.find((candidate) => candidate.id === payload.toolId)
    const args = tool?.arguments?.reduce((values, argument) => ({ ...values, [argument.key]: argument.default ?? '' }), {}) || {}
    exerciseQueue.value.splice(targetIndex === -1 ? exerciseQueue.value.length : targetIndex, 0, { type: 'tool', toolId: payload.toolId, args, section: 'required' })
    normalizeQueueSections()
    invalidatePreview()
    return
  }
  if (payload.type === 'queue') {
    const sourceIndex = exerciseQueue.value.findIndex((item) => payload.itemType === 'tool' ? item.type === 'tool' && item.toolId === payload.itemId : item.type !== 'tool' && item.exerciseId === payload.itemId)
    if (sourceIndex === -1) return
    const [item] = exerciseQueue.value.splice(sourceIndex, 1)
    item.section = 'required'
    if (targetExerciseId) {
      const targetIndex = targetExerciseId.startsWith('tool:')
        ? exerciseQueue.value.findIndex((candidate) => candidate.type === 'tool' && candidate.toolId === targetExerciseId.slice(5))
        : exerciseQueue.value.findIndex((candidate) => candidate.type !== 'tool' && candidate.exerciseId === targetExerciseId)
      exerciseQueue.value.splice(targetIndex === -1 ? exerciseQueue.value.length : targetIndex, 0, item)
    } else {
      exerciseQueue.value.push(item)
    }
    normalizeQueueSections()
    invalidatePreview()
  }
}

function headerCode(template = selectedTemplate.value) {
  const metadata = template?.metadata || defaultMetadata
  const fields = [...metadata.fields].sort((a, b) => a.argument - b.argument)
  return `\\${metadata.command}\n${fields.map((field) => `    {${documentFieldValue(field, template)}}`).join('\n')}`
}

function templateInputName(template) {
  return (template.archivo || template.nombre || 'plantilla').replace(/\.tex$/i, '')
}

function exercisePreambleRequirements(exercisesCode = '') {
  const requirements = []
  if (/canvas\s+is\s+(?:xy|xz|yz)\s+plane\s+at\s+[xyz]\s*=/.test(exercisesCode)) {
    requirements.push('\\usetikzlibrary{3d}')
  }
  return requirements.join('\n')
}

function generatedCodeForTemplate(template) {
  if (!template) return ''
  const exercises = exerciseQueue.value.map((item, index) => isTool(item) ? toolCode(item, index) : queueExerciseCode(item, template)).filter(Boolean).join('\n\n')
  const preambleRequirements = exercisePreambleRequirements(exercises)
  return `\\input{../${templateInputName(template)}}

${preambleRequirements}

\\begin{document}

${headerCode(template)}

${exercises ? `\\begin{ejercicios}\n${exercises}\n\\end{ejercicios}` : ''}

\\end{document}`
}

function generatedCode() {
  return generatedCodeForTemplate(previewTemplate.value || selectedTemplate.value)
}

function hasLegacyOptionalCommand(code = '') {
  return /\\optativos\s*\{[^{}]*\}(?!\s*\{)/.test(code)
}

function binaryBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function browserAssetUrl(url) {
  if (!import.meta.env.DEV) return url
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return url
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'firebasestorage.googleapis.com') return url
    return `/firebase-storage${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

async function grayscaleLogoAsset(url) {
  if (grayscaleLogoCache.has(url)) return grayscaleLogoCache.get(url)
  const pending = (async () => {
    const response = await fetch(browserAssetUrl(url))
    if (!response.ok) throw new Error(`No se ha podido descargar el logotipo del centro (HTTP ${response.status}).`)
    const sourceBlob = await response.blob()
    let source
    let releaseSource = () => {}
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(sourceBlob)
      releaseSource = () => source.close?.()
    } else {
      const objectUrl = URL.createObjectURL(sourceBlob)
      source = await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('El navegador no ha podido interpretar el logotipo del centro.'))
        image.src = objectUrl
      })
      releaseSource = () => URL.revokeObjectURL(objectUrl)
    }
    try {
      const sourceWidth = source.width || source.naturalWidth
      const sourceHeight = source.height || source.naturalHeight
      const scale = Math.min(1, 2400 / Math.max(sourceWidth, sourceHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sourceWidth * scale))
      canvas.height = Math.max(1, Math.round(sourceHeight * scale))
      const context = canvas.getContext('2d')
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const gray = Math.round(
          imageData.data[offset] * 0.2126
          + imageData.data[offset + 1] * 0.7152
          + imageData.data[offset + 2] * 0.0722,
        )
        imageData.data[offset] = gray
        imageData.data[offset + 1] = gray
        imageData.data[offset + 2] = gray
      }
      context.putImageData(imageData, 0, 0)
      const grayscaleBlob = await new Promise((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('No se ha podido convertir el logotipo a escala de grises.')),
        'image/png',
      ))
      return { data: binaryBase64(await grayscaleBlob.arrayBuffer()) }
    } finally {
      releaseSource()
    }
  })()
  grayscaleLogoCache.set(url, pending)
  try {
    return await pending
  } catch (error) {
    grayscaleLogoCache.delete(url)
    throw error
  }
}

function documentAssetSignature() {
  const exerciseFiles = exerciseQueue.value
    .filter((item) => item.type !== 'tool')
    .flatMap((item) => exerciseImageFiles(exerciseForQueue(item)).map((file) => `${item.exerciseId}:${file.path}:${file.url}`))
  return [currentCenterLogo.value, ...exerciseFiles].join('|')
}

async function documentAssets() {
  const assets = {}
  if (currentCenterLogo.value) {
    try {
      assets['logo.png'] = await grayscaleLogoAsset(currentCenterLogo.value)
    } catch (error) {
      throw new Error(`No se ha podido preparar el logotipo del centro: ${error?.message || 'error desconocido'}`)
    }
  }
  exerciseQueue.value.filter((item) => item.type !== 'tool').forEach((item) => {
    const exercise = exerciseForQueue(item)
    exerciseImageFiles(exercise).forEach((file, index) => {
      assets[documentExerciseAssetName(exercise, file, index)] = { url: file.url }
    })
  })
  return assets
}

function bodyForCompiler(source) {
  const match = source.match(/\\begin\s*\{document\}([\s\S]*?)\\end\s*\{document\}/)
  return normalizeDisplayMathDelimiters(
    (match?.[1] || source).replace(/^\s*\\input\s*\{[^}]+\}\s*/m, '').trim(),
  )
}

function invalidatePreview() {
  previewBlob.value = null
  previewCode.value = ''
  previewAssetSignature.value = ''
  compileError.value = ''
  compileErrorVisible.value = false
  if (currentStep.value < 4) documentCodeNeedsRegeneration.value = true
}

function updateDocumentCode(value) {
  documentCode.value = value
  documentCodeNeedsRegeneration.value = false
  previewBlob.value = null
  previewCode.value = ''
  compileError.value = ''
  compileErrorVisible.value = false
}

async function copyCompileError() {
  if (!compileError.value) return
  try {
    await navigator.clipboard.writeText(compileError.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = compileError.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

function activeDocumentCode(template = previewTemplate.value || selectedTemplate.value) {
  const generated = generatedCodeForTemplate(template)
  if (currentStep.value !== 4 || !documentCode.value.trim() || template?.key !== selectedPreviewTemplateKey.value) return generated
  return hasLegacyOptionalCommand(documentCode.value) ? generated : documentCode.value
}

function revokePreview() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewDocuments.value.forEach((entry) => {
    if (entry.url?.startsWith('blob:')) URL.revokeObjectURL(entry.url)
  })
  previewDocuments.value = []
  previewUrl.value = ''
  previewBlob.value = null
  previewCode.value = ''
  previewAssetSignature.value = ''
}

function resetFields() {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key])
  unifiedFields.value.forEach((field) => { fieldValues[field.key] = '' })
}

function ensureFields() {
  unifiedFields.value.forEach((field) => {
    if (fieldValues[field.key] === undefined) fieldValues[field.key] = ''
  })
}

function selectTemplate(template) {
  const hadTemplates = selectedTemplateKeys.value.length > 0
  if (selectedTemplateKeys.value.includes(template.key)) {
    selectedTemplateKeys.value = selectedTemplateKeys.value.filter((key) => key !== template.key)
  } else {
    selectedTemplateKeys.value = [...selectedTemplateKeys.value, template.key]
  }
  if (!selectedTemplateKeys.value.length) selectedTemplateKeys.value = [template.key]
  selectedTemplateKey.value = selectedTemplateKeys.value[0]
  selectedPreviewTemplateKey.value = selectedTemplateKeys.value[0]
  if (hadTemplates) ensureFields()
  else resetFields()
  documentCurriculum.value = emptyCurriculum()
  exerciseQueue.value = []
  optionalRequiredCount.value = 1
  Object.keys(selectedVersions).forEach((key) => delete selectedVersions[key])
  invalidatePreview()
}

function startTemplateDrag(event, template) {
  dragPayload.value = { type: 'template', templateKey: template.key }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', template.key)
}

function addTemplateToQueue(template) {
  if (!template || selectedTemplateKeys.value.includes(template.key)) return
  selectedTemplateKeys.value = [...selectedTemplateKeys.value, template.key]
  selectedTemplateKey.value = selectedTemplateKeys.value[0]
  selectedPreviewTemplateKey.value = selectedPreviewTemplateKey.value || template.key
  ensureFields()
  invalidatePreview()
}

function removeTemplateFromQueue(templateKey) {
  if (selectedTemplateKeys.value.length <= 1) return
  selectedTemplateKeys.value = selectedTemplateKeys.value.filter((key) => key !== templateKey)
  selectedTemplateKey.value = selectedTemplateKeys.value[0]
  if (!selectedTemplateKeys.value.includes(selectedPreviewTemplateKey.value)) selectedPreviewTemplateKey.value = selectedTemplateKeys.value[0]
  resetFields()
  invalidatePreview()
}

function dropTemplateQueue(event) {
  event.preventDefault()
  const payload = dragPayload.value
  dragPayload.value = null
  if (payload?.type !== 'template') return
  const template = documentTemplates.value.find((candidate) => candidate.key === payload.templateKey)
  addTemplateToQueue(template)
}

function fieldValueFor(field, template = null) {
  if (fieldValues[field.key] !== undefined) return fieldValues[field.key]
  if (template) {
    const sameLabel = template.metadata.fields.find((candidate) => normalizeName(candidate.label) === normalizeName(field.label))
    if (sameLabel && fieldValues[sameLabel.key] !== undefined) return fieldValues[sameLabel.key]
  }
  return ''
}

function formatDocumentDate(value) {
  const isoMatch = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!isoMatch) return String(value || '').trim()
  return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1].slice(-2)}`
}

function documentFieldValue(field, template = null) {
  const value = fieldValueFor(field, template)
  return field.type === 'date' || field.key === 'date' ? formatDocumentDate(value) : String(value || '').trim()
}

function dateInputValue(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/)
  if (!match) return text
  const year = match[3].length === 2 ? `20${match[3]}` : match[3]
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

function matchCourse(value) {
  const normalized = normalizeName(value).replaceAll(' ', '')
  return [...new Set(mathSubjects.map((subject) => subject.course))]
    .find((course) => normalized.startsWith(normalizeName(course).replaceAll(' ', ''))) || null
}

function matchSubject(value, course) {
  const normalized = normalizeName(value)
  return mathSubjects.find((subject) => subject.course === course
    && (normalizeName(subject.title) === normalized || normalized.includes(normalizeName(subject.title)))) || null
}

function syncCurriculumFromFields() {
  const courseField = unifiedFields.value.find((field) => field.type === 'group' || field.type === 'course' || field.key === 'course')
  const subjectField = unifiedFields.value.find((field) => field.type === 'subject' || field.key === 'subject')
  const selectedGroup = groupOptions.value.find((group) => group.value === fieldValues[courseField?.key])
  const course = selectedGroup?.course || matchCourse(courseField ? fieldValues[courseField.key] : '')
  const subject = mathSubjects.find((item) => item.id === selectedGroup?.subjectId)
    || matchSubject(selectedGroup?.subject || (subjectField ? fieldValues[subjectField.key] : ''), course)
  const currentSubject = mathSubjects.find((item) => item.id === documentCurriculum.value.subjectId)
  documentCurriculum.value = {
    ...documentCurriculum.value,
    course,
    subjectId: subject?.id || (currentSubject?.course === course ? currentSubject.id : null),
    conceptIds: subject?.id === documentCurriculum.value.subjectId ? documentCurriculum.value.conceptIds : [],
  }
  invalidatePreview()
}

function onFieldInput(field = null) {
  if (field && (field.type === 'group' || field.type === 'course' || field.key === 'course')) {
    const group = groupOptions.value.find((option) => option.value === fieldValues[field.key])
    if (group) {
      unifiedFields.value
        .filter((candidate) => candidate.type === 'subject' || candidate.key === 'subject')
        .forEach((subjectField) => { fieldValues[subjectField.key] = group.subject })
    }
  }
  syncCurriculumFromFields()
  invalidatePreview()
}

function toggleEvaluable() {
  documentAssessment.evaluable = !documentAssessment.evaluable
  if (documentAssessment.evaluable) {
    documentAssessment.groupId ||= selectedGroupOption.value?.id || null
    documentAssessment.shortName ||= summaryFieldValue(fieldValues, ['title', 'titulo'])
  }
}

function resetDocumentAssessment() {
  documentAssessment.evaluable = false
  documentAssessment.groupId = null
  documentAssessment.shortName = ''
  documentAssessment.gradebookItemId = null
}

function resetWorkflow() {
  selectedDocumentId.value = null
  createdAt.value = null
  selectedTemplateKey.value = ''
  selectedTemplateKeys.value = []
  selectedPreviewTemplateKey.value = ''
  lastDocumentPreviewKey.value = ''
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key])
  resetDocumentAssessment()
  documentCurriculum.value = emptyCurriculum()
  exerciseQuery.value = ''
  exerciseQueue.value = []
  optionalRequiredCount.value = 1
  Object.keys(selectedVersions).forEach((key) => delete selectedVersions[key])
  currentStep.value = 1
  maxVisitedStep.value = 1
  compileError.value = ''
  compileErrorVisible.value = false
  documentCode.value = ''
  documentCodeNeedsRegeneration.value = true
  showDocumentCode.value = false
  viewedDocument.value = null
  viewerAssessmentExercises.value = []
  viewerAssessmentLoading.value = false
  revokePreview()
}

function newDocument() {
  resetWorkflow()
  mode.value = 'editor'
}

function backToLibrary() {
  resetWorkflow()
  mode.value = 'library'
}

async function assessmentModelsForDocument(documentData) {
  const references = (Array.isArray(documentData?.ejercicios) ? documentData.ejercicios : [])
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  return Promise.all(references.map(async (reference, order) => {
    let exercise = props.exercises.find((candidate) => candidate.id === reference.exerciseId)
    if (!exercise) {
      const snapshot = await getDoc(doc(db, 'ejercicios', reference.exerciseId))
      if (!snapshot.exists()) return null
      exercise = { id: snapshot.id, ...snapshot.data() }
    }
    const version = Number(reference.version) || 0
    const active = activeVersion(exercise, version)
    const structure = versionStructure(exercise, version)
    return assessmentExerciseModel({
      exerciseId: reference.exerciseId,
      version,
      structure: {
        ...structure,
        pdfenunciadocompleto: structure.pdfenunciadocompleto || active?.pdf?.enunciado || '',
        pdfsolucioncompleto: structure.pdfsolucioncompleto || active?.pdf?.resuelto || '',
      },
      order,
    })
  })).then((models) => models.filter(Boolean))
}

async function viewDocument(documentData) {
  if (!documentData?.pdf?.url) return
  resetWorkflow()
  viewedDocument.value = documentData
  const storedTemplates = Array.isArray(documentData.plantillas) && documentData.plantillas.length
    ? documentData.plantillas
    : (documentData.plantilla ? [documentData.plantilla] : [])
  const storedPdfs = Array.isArray(documentData.pdfs) && documentData.pdfs.length
    ? documentData.pdfs
    : [documentData.pdf]
  previewDocuments.value = storedPdfs.map((pdf, index) => ({
    templateKey: pdf.templateKey || storedTemplates[index]?.archivo || `pdf-${index}`,
    name: storedTemplates[index]?.nombre || storedTemplates[index]?.archivo || `Documento ${index + 1}`,
    url: pdf.url,
    path: pdf.path || '',
    blob: null,
    code: '',
    assetSignature: '',
  })).filter((entry) => entry.url)
  selectedPreviewTemplateKey.value = previewDocuments.value[0]?.templateKey || ''
  previewUrl.value = previewDocuments.value[0]?.url || documentData.pdf.url
  mode.value = 'viewer'
  if (documentData.assessment?.evaluable) {
    viewerAssessmentLoading.value = true
    try {
      viewerAssessmentExercises.value = await assessmentModelsForDocument(documentData)
    } catch (error) {
      documentsError.value = error.message || 'No se ha podido cargar la matriz de evaluación.'
    } finally {
      viewerAssessmentLoading.value = false
    }
  }
}

function requestDeleteDocument(documentData) {
  documentDeleteTarget.value = documentData
  documentDeleteDialog.value = true
}

function storagePathFromUrl(url = '') {
  try {
    const pathname = new URL(url).pathname
    const marker = '/o/'
    const markerIndex = pathname.indexOf(marker)
    if (markerIndex === -1) return ''
    return decodeURIComponent(pathname.slice(markerIndex + marker.length))
  } catch {
    return ''
  }
}

async function deleteDocument() {
  const documentData = documentDeleteTarget.value
  if (!documentData?.id || isDeletingDocument.value) return
  isDeletingDocument.value = true
  documentsError.value = ''
  try {
    const paths = new Set()
    if (documentData.pdf?.path) paths.add(documentData.pdf.path)
    if (documentData.pdf?.url) {
      const path = storagePathFromUrl(documentData.pdf.url)
      if (path) paths.add(path)
    }
    ;(Array.isArray(documentData.pdfs) ? documentData.pdfs : []).forEach((pdf) => {
      if (pdf?.path) paths.add(pdf.path)
      if (pdf?.url) {
        const path = storagePathFromUrl(pdf.url)
        if (path) paths.add(path)
      }
    })
    await Promise.all([...paths].map(async (path) => {
      try {
        await deleteObject(storageRef(storage, path))
      } catch (error) {
        if (error?.code !== 'storage/object-not-found') throw error
      }
    }))
    await syncDocumentAssessment({
      documentId: documentData.id,
      previousGroupId: documentData.assessment?.groupId || null,
    })
    await deleteDoc(doc(db, 'documentos', documentData.id))
    emit('assessment-saved', {
      documentId: documentData.id,
      previousGroupId: documentData.assessment?.groupId || null,
      groupId: null,
      item: null,
    })
    documents.value = documents.value.filter((item) => item.id !== documentData.id)
    documentDeleteDialog.value = false
    documentDeleteTarget.value = null
  } catch (error) {
    documentsError.value = error.message || 'No se ha podido eliminar el documento.'
    console.error('Error al eliminar documento:', error)
  } finally {
    isDeletingDocument.value = false
  }
}

function selectViewerDocument(entry) {
  if (!entry) return
  selectedPreviewTemplateKey.value = entry.templateKey
  previewUrl.value = entry.url
}

function selectAssessmentPreview() {
  selectedPreviewTemplateKey.value = ASSESSMENT_PREVIEW_KEY
  showDocumentCode.value = false
}

function previewEntryForTemplate(templateKey) {
  return previewDocuments.value.find((entry) => entry.templateKey === templateKey) || null
}

function documentFileName(entry) {
  const base = String(entry?.name || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'documento'
  return `${base}.pdf`
}

async function documentBlob(entry) {
  if (entry?.blob instanceof Blob) return entry.blob
  if (!entry?.url) throw new Error('El PDF todavía no está disponible.')
  const response = await fetch(browserAssetUrl(entry.url))
  if (!response.ok) throw new Error(`No se ha podido descargar el PDF (HTTP ${response.status}).`)
  return response.blob()
}

async function downloadGeneratedDocument(entry) {
  try {
    const blob = await documentBlob(entry)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = documentFileName(entry)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    compileError.value = error.message || 'No se ha podido descargar el documento.'
    compileErrorVisible.value = true
  }
}

async function printGeneratedDocument(entry) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    compileError.value = 'El navegador ha bloqueado la ventana de impresión.'
    compileErrorVisible.value = true
    return
  }
  try {
    printWindow.document.write('<p style="font-family:sans-serif">Preparando documento…</p>')
    const blob = await documentBlob(entry)
    const url = URL.createObjectURL(blob)
    let printRequested = false
    const requestPrint = () => {
      if (printRequested || printWindow.closed) return
      printRequested = true
      printWindow.focus()
      printWindow.print()
    }
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        requestPrint()
      }, 350)
    }, { once: true })
    printWindow.location.replace(url)
    setTimeout(requestPrint, 1500)
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (error) {
    printWindow.close()
    compileError.value = error.message || 'No se ha podido imprimir el documento.'
    compileErrorVisible.value = true
  }
}

function setOptionalRequiredCount(value) {
  optionalRequiredCount.value = value
  invalidatePreview()
}

function previousStep() {
  if (currentStep.value > 1) currentStep.value -= 1
}

async function nextStep() {
  if (!canContinue.value || currentStep.value >= lastStep.value) return
  currentStep.value += 1
  maxVisitedStep.value = Math.max(maxVisitedStep.value, currentStep.value)
  if (currentStep.value === 4) {
    if (documentCodeNeedsRegeneration.value || !documentCode.value.trim()) documentCode.value = generatedCode()
    documentCodeNeedsRegeneration.value = false
    await compileDocument()
  }
}

async function goToVisitedStep(step) {
  if (step > maxVisitedStep.value || step === currentStep.value) return
  currentStep.value = step
  if (step === 4) {
    if (documentCodeNeedsRegeneration.value || !documentCode.value.trim()) documentCode.value = generatedCode()
    documentCodeNeedsRegeneration.value = false
    await compileDocument()
  }
}

async function compilerRequest(path, options = {}) {
  let response
  try {
    const token = await auth.currentUser?.getIdToken()
    response = await fetch(`${props.compilerBaseUrl}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch (error) {
    throw new Error(`No se ha podido conectar con el compilador LaTeX (${path}): ${error?.message || 'error de red'}`)
  }
  if (response.ok) return response
  let details = {}
  try { details = await response.json() } catch { /* La API puede devolver texto. */ }
  throw new Error(details.log || details.message || `Error del compilador (${response.status})`)
}

async function compileDocument(force = false) {
  if (!selectedTemplates.value.length || isCompiling.value) return
  const templatesToCompile = selectedTemplates.value
  const assetSignature = documentAssetSignature()
  if (!force && previewDocuments.value.length === templatesToCompile.length && previewDocuments.value.every((entry) => entry.assetSignature === assetSignature && entry.code === activeDocumentCode(templatesToCompile.find((template) => template.key === entry.templateKey)))) return
  isCompiling.value = true
  emit('busy-change', true)
  compileError.value = ''
  compileErrorVisible.value = false
  try {
    const entries = []
    const compilationErrors = []
    const assets = await documentAssets()
    for (const template of templatesToCompile) {
      try {
        const code = activeDocumentCode(template)
        const preambleRequirements = exercisePreambleRequirements(code)
        const compilerPreamble = [template.codigo, preambleRequirements].filter(Boolean).join('\n\n')
        if (template.key === selectedPreviewTemplateKey.value && hasLegacyOptionalCommand(documentCode.value)) documentCode.value = code
        await compilerRequest('/preambles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: template.archivo, content: compilerPreamble }),
        })
        const response = await compilerRequest('/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: bodyForCompiler(code), preamble_name: template.archivo, assets }),
        })
        const blob = await response.blob()
        entries.push({ templateKey: template.key, name: template.nombre || template.metadata.name, code, blob, url: URL.createObjectURL(blob), assetSignature })
      } catch (error) {
        compilationErrors.push(`${template.nombre || template.metadata.name}: ${error.message || 'error de compilación'}`)
      }
    }
    if (!entries.length) throw new Error(compilationErrors.join('\n\n') || 'No se ha podido compilar ningún documento.')
    revokePreview()
    previewDocuments.value = entries
    const active = entries.find((entry) => entry.templateKey === selectedPreviewTemplateKey.value) || entries[0]
    if (active) {
      selectedPreviewTemplateKey.value = active.templateKey
      previewBlob.value = active.blob
      previewCode.value = active.code
      previewAssetSignature.value = active.assetSignature
      previewUrl.value = active.url
    }
    if (compilationErrors.length) {
      compileError.value = compilationErrors.join('\n\n')
      compileErrorVisible.value = true
    }
  } catch (error) {
    compileError.value = error.message || 'No se ha podido compilar el documento.'
    compileErrorVisible.value = true
  } finally {
    isCompiling.value = false
    emit('busy-change', false)
  }
}

function selectPreviewTemplate(templateKey) {
  const entry = previewDocuments.value.find((candidate) => candidate.templateKey === templateKey)
  if (!entry) return
  selectedPreviewTemplateKey.value = templateKey
  documentCode.value = entry.code
  previewBlob.value = entry.blob
  previewCode.value = entry.code
  previewAssetSignature.value = entry.assetSignature
  previewUrl.value = entry.url
}

function documentCardTitle(documentData) {
  const values = documentData.campos || {}
  return values.title || values.subject || documentData.plantilla?.nombre || 'Documento sin título'
}

function documentFieldEntries(documentData) {
  const metadata = documentTemplates.value.find((template) => template.archivo === documentData.plantilla?.archivo)?.metadata || defaultMetadata
  return metadata.fields.map((field) => ({
    label: field.label,
    value: documentData.campos?.[field.key]
      ? (field.type === 'date' || field.key === 'date' ? formatDocumentDate(documentData.campos[field.key]) : documentData.campos[field.key])
      : '—',
  }))
}

async function loadDocuments() {
  isLoadingDocuments.value = true
  documentsError.value = ''
  try {
    const snapshot = await getDocs(collection(db, 'documentos'))
    documents.value = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  } catch (error) {
    documentsError.value = 'No se han podido cargar los documentos de Firestore.'
    console.error('Error al cargar documentos:', error)
  } finally {
    isLoadingDocuments.value = false
  }
}

function editDocument(documentData) {
  resetWorkflow()
  const storedTemplates = Array.isArray(documentData.plantillas) && documentData.plantillas.length
    ? documentData.plantillas
    : (documentData.plantilla ? [documentData.plantilla] : [])
  const templates = storedTemplates.map((stored) => documentTemplates.value.find((item) => item.archivo === stored.archivo || item.nombre === stored.nombre)).filter(Boolean)
  const template = templates[0]
  if (!template) {
    documentsError.value = 'La plantilla utilizada por este documento ya no está disponible.'
    return
  }
  selectedDocumentId.value = documentData.id
  createdAt.value = documentData.createdAt || null
  selectedTemplateKeys.value = templates.map((item) => item.key)
  selectedTemplateKey.value = template.key
  selectedPreviewTemplateKey.value = template.key
  resetFields()
  Object.assign(fieldValues, documentData.campos || {})
  const storedAssessment = documentData.assessment || documentData.evaluacion || {}
  documentAssessment.evaluable = Boolean(storedAssessment.evaluable)
  documentAssessment.groupId = storedAssessment.groupId || null
  documentAssessment.shortName = String(storedAssessment.shortName || '').trim()
  documentAssessment.gradebookItemId = storedAssessment.gradebookItemId || null
  unifiedFields.value.filter((field) => field.type === 'date' || field.key === 'date').forEach((field) => {
    fieldValues[field.key] = dateInputValue(fieldValues[field.key])
  })
  const savedCurriculum = documentData.curriculum || {}
  const savedCourse = savedCurriculum.course
    || documentData.course
    || documentData.campos?.course
    || documentData.campos?.curso
  const savedSubjectId = savedCurriculum.subjectId || documentData.subjectId || documentData.asignaturaId
  const savedSubject = mathSubjects.find((subject) => subject.id === savedSubjectId)
    || matchSubject(savedCurriculum.subject || documentData.subject || documentData.campos?.subject, matchCourse(savedCourse))
    || matchSubject(documentData.campos?.subject, matchCourse(savedCourse))
  const legacyConceptIds = documentData.conceptIds || documentData.conceptos || documentData.curriculum?.concepts
  documentCurriculum.value = {
    ...emptyCurriculum(),
    ...savedCurriculum,
    course: savedCourse || savedSubject?.course || null,
    subjectId: savedSubject?.id || savedSubjectId || null,
    conceptIds: Array.isArray(savedCurriculum.conceptIds)
      ? [...savedCurriculum.conceptIds]
      : (Array.isArray(legacyConceptIds) ? [...legacyConceptIds] : []),
    competencial: Boolean(savedCurriculum.competencial),
  }
  curriculumPickerKey.value += 1
  const storedQueue = Array.isArray(documentData.bloques) ? documentData.bloques : documentData.ejercicios
  exerciseQueue.value = Array.isArray(storedQueue)
    ? storedQueue.filter((item) => item?.exerciseId || item?.toolId).map((item) => item.toolId
      ? { type: 'tool', toolId: item.toolId, args: { ...(item.args || {}) }, section: 'required' }
      : {
          type: 'exercise',
          exerciseId: item.exerciseId,
          version: Number(item.version) || 0,
          metrics: item.metrics ? {
            puntuacion: Number(item.metrics.puntuacion) || 0,
            tiempo: Number(item.metrics.tiempo) || 0,
            apartados: Array.isArray(item.metrics.apartados) ? item.metrics.apartados.map((apartado) => ({
              puntuacion: Number(apartado.puntuacion) || 0,
              tiempo: Number(apartado.tiempo) || 0,
            })) : [],
          } : undefined,
          section: item.section === 'optional' ? 'optional' : 'required',
        })
    : []
  optionalRequiredCount.value = Number(documentData.optativos?.elegir) || 1
  normalizeQueueSections()
  exerciseQueue.value.forEach((item) => { selectedVersions[item.exerciseId] = item.version })
  previewUrl.value = documentData.pdf?.url || ''
  previewCode.value = documentData.codigo || ''
  documentCode.value = documentData.codigo || generatedCode()
  documentCodeNeedsRegeneration.value = false
  previewDocuments.value = []
  if (Array.isArray(documentData.pdfs)) {
    previewDocuments.value = documentData.pdfs.map((pdf, index) => ({
      templateKey: templates[index]?.key,
      name: templates[index]?.nombre || templates[index]?.metadata.name,
      url: pdf.url,
      blob: null,
      code: documentData.codigos?.[templates[index]?.key] || documentData.codigo || '',
      assetSignature: documentAssetSignature(),
    })).filter((entry) => entry.templateKey && entry.url)
  }
  showDocumentCode.value = false
  currentStep.value = 1
  maxVisitedStep.value = lastStep.value
  mode.value = 'editor'
}

function documentAssessmentPoints() {
  return exerciseQueue.value
    .filter((item) => item.type !== 'tool')
    .reduce((total, item) => total + (Number(queueMetrics(item).puntuacion) || 0), 0)
}

function documentAssessmentItem(documentId) {
  if (!documentAssessment.evaluable) return null
  const shortName = documentAssessment.shortName.trim()
  const fullName = summaryFieldValue(fieldValues, ['title', 'titulo']) || shortName
  return {
    type: 'item',
    id: documentAssessment.gradebookItemId
      || globalThis.crypto?.randomUUID?.()
      || `documento-${documentId}-${Date.now()}`,
    nombre: fullName,
    nombreCorto: shortName,
    documentAssessment: {
      documentId,
      maxPoints: documentAssessmentPoints(),
      exercises: exerciseQueue.value
        .filter((item) => item.type !== 'tool')
        .map((item, order) => ({ exerciseId: item.exerciseId, version: Number(item.version) || 0, order })),
    },
  }
}

async function saveDocument() {
  if (currentStep.value !== lastStep.value || isSaving.value) return
  if (!previewBlob.value || previewCode.value !== activeDocumentCode()) await compileDocument()
  if (!previewDocuments.value.length) return
  isSaving.value = true
  emit('busy-change', true)
  documentsError.value = ''
  try {
    const reference = selectedDocumentId.value
      ? doc(db, 'documentos', selectedDocumentId.value)
      : doc(collection(db, 'documentos'))
    const uploadedPdfs = []
    for (const [index, entry] of previewDocuments.value.entries()) {
      if (!entry.blob) {
        if (entry.url) uploadedPdfs.push({ templateKey: entry.templateKey, url: entry.url, path: entry.path || '' })
        continue
      }
      const path = `documentos/${reference.id}/documento_${reference.id}_${index + 1}.pdf`
      await uploadBytes(storageRef(storage, path), entry.blob, { contentType: 'application/pdf', customMetadata: { documentId: reference.id } })
      uploadedPdfs.push({ templateKey: entry.templateKey, url: await getDownloadURL(storageRef(storage, path)), path })
    }
    const primaryPdf = uploadedPdfs[0]
    if (!primaryPdf) return
    const now = new Date().toISOString()
    const previousDocument = documents.value.find((item) => item.id === reference.id) || null
    const assessmentItem = documentAssessmentItem(reference.id)
    const data = {
      plantilla: {
        archivo: selectedTemplate.value.archivo,
        nombre: selectedTemplate.value.metadata.name || selectedTemplate.value.nombre,
      },
      plantillas: selectedTemplates.value.map((template) => ({ archivo: template.archivo, nombre: template.nombre || template.metadata.name })),
      campos: Object.fromEntries(unifiedFields.value.map((field) => [field.key, String(fieldValues[field.key] || '').trim()])),
      groupContext: selectedGroupOption.value ? {
        id: selectedGroupOption.value.id,
        name: selectedGroupOption.value.title,
        studentCount: selectedGroupOption.value.studentCount,
      } : null,
      curriculum: {
        course: documentCurriculum.value.course || null,
        subjectId: documentCurriculum.value.subjectId || null,
        conceptIds: [...new Set(documentCurriculum.value.conceptIds || [])],
        competencial: Boolean(documentCurriculum.value.competencial),
      },
      assessment: {
        evaluable: Boolean(documentAssessment.evaluable),
        groupId: documentAssessment.evaluable ? documentAssessment.groupId : null,
        groupName: documentAssessment.evaluable ? assessmentGroupOption.value?.title || '' : '',
        shortName: documentAssessment.evaluable ? documentAssessment.shortName.trim() : '',
        gradebookItemId: assessmentItem?.id || null,
        maxPoints: assessmentItem?.documentAssessment?.maxPoints || 0,
      },
      bloques: exerciseQueue.value.map((item, order) => ({ ...item, order })),
      ejercicios: exerciseQueue.value.filter((item) => item.type !== 'tool').map((item, order) => ({ ...item, order })),
      optativos: {
        disponibles: selectedExercises.value.length,
        elegir: exerciseQueue.value.find((item) => isTool(item) && item.toolId === 'optativos')?.args?.count || 0,
      },
      codigo: activeDocumentCode(selectedTemplate.value),
      codigos: Object.fromEntries(previewDocuments.value.map((entry) => [entry.templateKey, entry.code])),
      pdfs: uploadedPdfs,
      pdf: { url: primaryPdf.url, path: primaryPdf.path },
      createdAt: createdAt.value || now,
      updatedAt: now,
    }
    await setDoc(reference, data)
    const syncedItem = await syncDocumentAssessment({
      documentId: reference.id,
      previousGroupId: previousDocument?.assessment?.groupId || null,
      groupId: data.assessment.groupId,
      item: assessmentItem,
    })
    if (syncedItem && syncedItem.id !== data.assessment.gradebookItemId) {
      data.assessment.gradebookItemId = syncedItem.id
      await setDoc(reference, { assessment: data.assessment }, { merge: true })
    }
    emit('assessment-saved', {
      documentId: reference.id,
      previousGroupId: previousDocument?.assessment?.groupId || null,
      groupId: data.assessment.groupId,
      item: syncedItem,
    })
    const saved = { id: reference.id, ...data }
    const existingIndex = documents.value.findIndex((item) => item.id === reference.id)
    if (existingIndex === -1) documents.value.unshift(saved)
    else documents.value.splice(existingIndex, 1, saved)
    documents.value.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    backToLibrary()
  } catch (error) {
    documentsError.value = error.message || 'No se ha podido guardar el documento.'
    console.error('Error al guardar documento:', error)
  } finally {
    isSaving.value = false
    emit('busy-change', false)
  }
}

onMounted(loadDocuments)
onBeforeUnmount(revokePreview)

defineExpose({
  newDocument,
  backToLibrary,
  previous: previousStep,
  next: nextStep,
  compile: () => compileDocument(true),
  save: saveDocument,
})
</script>

<template>
  <div class="document-creator">
    <section v-if="mode === 'library'" class="document-library">
      <div v-if="isLoadingDocuments" class="document-library-empty">
        <v-progress-circular indeterminate color="primary" />
        <span>Cargando documentos…</span>
      </div>
      <div v-else-if="filteredDocuments.length" class="document-library-grid">
        <v-card
          v-for="documentData in filteredDocuments"
          :key="documentData.id"
          class="document-library-card"
          elevation="1"
        >
          <header>
            <div>
              <span>{{ documentData.plantilla?.nombre || 'Documento' }}</span>
              <strong>{{ documentCardTitle(documentData) }}</strong>
            </div>
            <v-chip size="x-small" color="primary" variant="tonal">{{ documentData.ejercicios?.length || 0 }} ejercicios</v-chip>
          </header>
          <dl>
            <template v-for="field in documentFieldEntries(documentData)" :key="field.label">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </template>
          </dl>
          <footer>
            <span>{{ documentData.updatedAt ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(documentData.updatedAt)) : '' }}</span>
            <div class="document-library-actions">
              <v-tooltip text="Visualizar PDF" location="top">
                <template #activator="{ props: tooltipProps }">
                  <v-btn v-bind="tooltipProps" icon="mdi-eye-outline" size="small" variant="tonal" color="primary" aria-label="Visualizar PDF" :disabled="!documentData.pdf?.url" @click="viewDocument(documentData)" />
                </template>
              </v-tooltip>
              <v-tooltip text="Editar documento" location="top">
                <template #activator="{ props: tooltipProps }">
                  <v-btn v-bind="tooltipProps" icon="mdi-pencil-outline" size="small" variant="tonal" color="primary" aria-label="Editar documento" @click="editDocument(documentData)" />
                </template>
              </v-tooltip>
              <v-tooltip text="Eliminar documento" location="top">
                <template #activator="{ props: tooltipProps }">
                  <v-btn v-bind="tooltipProps" icon="mdi-delete-outline" size="small" variant="tonal" color="error" aria-label="Eliminar documento" @click="requestDeleteDocument(documentData)" />
                </template>
              </v-tooltip>
            </div>
          </footer>
        </v-card>
      </div>
      <div v-else-if="documents.length" class="document-library-empty">
        <v-icon icon="mdi-file-search-outline" size="52" color="primary" />
        <strong>No hay documentos que coincidan con la búsqueda.</strong>
        <span>Prueba con el título, la asignatura, la fecha o el curso.</span>
      </div>
      <div v-else class="document-library-empty">
        <v-icon icon="mdi-file-document-multiple-outline" size="52" color="primary" />
        <strong>Todavía no hay documentos guardados.</strong>
        <span>Crea el primero desde el botón «Nuevo documento».</span>
      </div>
    </section>

    <section v-else-if="mode === 'viewer'" class="document-viewer">
      <div v-if="previewDocuments.length" class="document-viewer-layout">
        <aside class="document-preview-selector" aria-label="Documentos generados">
          <article v-if="viewerDocumentSummary.group || viewerDocumentSummary.items.length" class="document-preview-summary">
            <header>
              <div>
                <span>Grupo</span>
                <strong>{{ viewerDocumentSummary.group || 'Sin grupo' }}</strong>
              </div>
              <small v-if="viewerDocumentSummary.studentCount !== null">
                <v-icon icon="mdi-account-multiple-outline" size="14" />
                {{ viewerDocumentSummary.studentCount }} {{ viewerDocumentSummary.studentCount === 1 ? 'alumno' : 'alumnos' }}
              </small>
            </header>
            <dl v-if="viewerDocumentSummary.items.length">
              <div v-for="item in viewerDocumentSummary.items" :key="item.key">
                <dt><v-icon :icon="item.icon" size="14" />{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </article>
          <strong>Documentos generados</strong>
          <div
            v-for="entry in previewDocuments"
            :key="entry.templateKey"
            class="document-preview-selector-item"
            :class="{ active: selectedPreviewTemplateKey === entry.templateKey }"
          >
            <button type="button" class="document-preview-select" @click="selectViewerDocument(entry)">
              <v-icon icon="mdi-file-pdf-box" size="18" />
              <span>{{ entry.name }}</span>
            </button>
            <span class="document-preview-actions">
              <v-btn icon="mdi-download" size="x-small" density="comfortable" variant="text" rounded="circle" aria-label="Descargar documento" @click.stop="downloadGeneratedDocument(entry)" />
              <v-btn icon="mdi-printer-outline" size="x-small" density="comfortable" variant="text" rounded="circle" aria-label="Imprimir documento" @click.stop="printGeneratedDocument(entry)" />
            </span>
          </div>
          <div
            v-if="viewedDocument?.assessment?.evaluable"
            class="document-preview-selector-item"
            :class="{ active: isAssessmentPreviewSelected }"
          >
            <button type="button" class="document-preview-select" @click="selectAssessmentPreview">
              <v-icon icon="mdi-table-check" size="18" />
              <span>Matriz de evaluación</span>
            </button>
          </div>
        </aside>
        <div class="document-preview-render">
          <div v-if="isAssessmentPreviewSelected && viewerAssessmentLoading" class="document-assessment-loading">
            <v-progress-circular indeterminate color="primary" size="34" />
            <span>Cargando matriz de evaluación…</span>
          </div>
          <DocumentAssessmentMatrix
            v-else-if="isAssessmentPreviewSelected"
            :exercises="viewerAssessmentExercises"
            subtitle="Resoluciones segmentadas y logros del documento"
          />
          <DocumentPdfPreview v-else :src="previewUrl" :title="documentCardTitle(viewedDocument || {})" />
        </div>
      </div>
      <DocumentPdfPreview v-else :src="previewUrl" :title="documentCardTitle(viewedDocument || {})" />
    </section>

    <section v-else class="document-workflow">
      <ol class="document-stepper" :style="{ '--document-step-count': steps.length }" aria-label="Proceso de creación del documento">
          <li v-for="step in steps" :key="step.number" :class="{ active: currentStep === step.number, complete: currentStep > step.number }">
          <button type="button" :disabled="step.number > maxVisitedStep" @click="goToVisitedStep(step.number)">
            <span class="document-step-number"><v-icon v-if="currentStep > step.number" icon="mdi-check" size="16" /><span v-else>{{ step.number }}</span></span>
            <span class="document-step-title">{{ step.title }}</span>
          </button>
        </li>
      </ol>

      <div class="document-step-content">
        <div v-if="currentStep === 1" class="document-template-step">
          <div class="document-template-cards">
            <div v-if="!documentTemplates.length" class="document-template-empty">
              <v-icon icon="mdi-file-document-plus-outline" size="46" color="primary" />
              <strong>No hay plantillas de documentos disponibles.</strong>
              <span>Crea o edita una desde «Plantillas» y marca sus argumentos con comentarios como <code>%% grupo %%</code> o <code>%% fecha %%</code>.</span>
            </div>
            <button
              v-for="template in documentTemplates"
              :key="template.key"
              type="button"
              class="document-template-card"
              :class="{ selected: selectedTemplateKeys.includes(template.key) }"
              draggable="true"
              @dragstart="startTemplateDrag($event, template)"
              @click="selectTemplate(template)"
            >
              <v-icon icon="mdi-file-document-outline" size="30" />
              <strong>{{ template.nombre || template.metadata.name }}</strong>
              <span>{{ template.descripcion || 'Sin descripción' }}</span>
              <v-icon v-if="selectedTemplateKeys.includes(template.key)" class="document-template-selected" icon="mdi-check-circle" size="22" />
            </button>
          </div>
          <aside class="document-template-queue" @dragover.prevent @drop="dropTemplateQueue">
            <header><v-icon icon="mdi-playlist-plus" size="21" /><strong>Plantillas que se generarán</strong></header>
            <div v-if="selectedTemplates.length" class="document-template-queue-list">
              <article v-for="template in selectedTemplates" :key="template.key" class="document-template-queue-card">
                <div><strong>{{ template.nombre || template.metadata.name }}</strong><span>{{ template.descripcion || 'Sin descripción' }}</span></div>
                <v-btn v-if="selectedTemplates.length > 1" icon="mdi-close" size="x-small" variant="text" aria-label="Quitar plantilla" @click="removeTemplateFromQueue(template.key)" />
              </article>
            </div>
            <div v-else class="document-template-queue-empty"><v-icon icon="mdi-tray-arrow-down" size="28" /><span>Arrastra aquí las plantillas que quieras generar.</span></div>
          </aside>
          <aside class="document-fields-pane" :class="{ empty: !selectedTemplates.length }">
            <template v-if="selectedTemplates.length">
              <div class="document-fields-heading">
                <v-icon icon="mdi-form-textbox" size="22" />
                <div><strong>Datos de los documentos</strong><span>Los campos comunes aparecen una sola vez.</span></div>
              </div>
              <v-select
                v-for="field in unifiedFields.filter((item) => item.type === 'group' || item.type === 'course')"
                :key="field.key"
                v-model="fieldValues[field.key]"
                :items="groupOptions"
                item-title="title"
                item-value="value"
                :label="field.label"
                :placeholder="field.placeholder"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFieldInput(field)"
              />
              <v-select
                v-for="field in unifiedFields.filter((item) => item.type === 'subject')"
                :key="field.key"
                v-model="fieldValues[field.key]"
                :items="subjectOptions"
                :label="field.label"
                :placeholder="field.placeholder"
                :readonly="Boolean(selectedGroupOption?.subject)"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFieldInput(field)"
              />
              <v-text-field
                v-for="field in unifiedFields.filter((item) => item.type === 'date')"
                :key="field.key"
                v-model="fieldValues[field.key]"
                type="date"
                :label="field.label"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFieldInput(field)"
              />
              <v-text-field
                v-for="field in unifiedFields.filter((item) => !['group', 'course', 'subject', 'date'].includes(item.type))"
                :key="field.key"
                v-model="fieldValues[field.key]"
                :label="field.label"
                :placeholder="field.placeholder"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFieldInput(field)"
              />
              <section class="document-assessment-fields">
                <button
                  type="button"
                  class="document-evaluable-toggle"
                  :class="{ active: documentAssessment.evaluable }"
                  :aria-pressed="documentAssessment.evaluable"
                  @click="toggleEvaluable"
                >
                  <v-icon :icon="documentAssessment.evaluable ? 'mdi-check-circle' : 'mdi-checkbox-blank-circle-outline'" size="19" />
                  <span><strong>Evaluable</strong><small>Añadir el examen al cuaderno de calificaciones</small></span>
                </button>
                <template v-if="documentAssessment.evaluable">
                  <v-select
                    v-model="documentAssessment.groupId"
                    :items="groupOptions"
                    item-title="title"
                    item-value="id"
                    label="Grupo"
                    variant="outlined"
                    density="comfortable"
                    hide-details
                  />
                  <v-text-field
                    v-model="documentAssessment.shortName"
                    label="Nombre corto para las listas"
                    placeholder="Examen 1"
                    variant="outlined"
                    density="comfortable"
                    maxlength="24"
                    hide-details
                  />
                </template>
              </section>
            </template>
            <template v-else>
              <v-icon icon="mdi-arrow-left" size="30" />
              <span>Selecciona o arrastra una plantilla para configurar sus campos.</span>
            </template>
          </aside>
        </div>

        <ExerciseCurriculumPicker
          v-else-if="currentStep === 2"
          :key="curriculumPickerKey"
          v-model="documentCurriculum"
          class="document-curriculum-step"
          :nodes="conceptNodes"
          :subject-selections="subjectSelections"
          :exercise-counts="exerciseCounts"
          @update:model-value="invalidatePreview"
        />

        <div v-else-if="currentStep === 3" class="document-exercise-step">
          <section class="document-matches-pane">
            <div class="document-exercise-toolbar">
              <v-text-field
                v-model="exerciseQuery"
                aria-label="Buscar ejercicios coincidentes"
                placeholder="Buscar en los ejercicios coincidentes"
                prepend-inner-icon="mdi-magnify"
                variant="outlined"
                density="compact"
                rounded="pill"
                clearable
                hide-details
              />
              <span>{{ matchingExercises.length }} disponibles</span>
            </div>
            <div v-if="matchingExercises.length" class="document-matches-scroll">
              <MasonryGrid :items="matchingExercises" :item-key="(exercise) => exercise.id" :gap="9" :max-columns="2" class="document-matches-grid">
                <template #default="{ item: exercise }">
                  <article
                    class="document-exercise-card"
                    draggable="true"
                    @dragstart="startExerciseDrag($event, exercise)"
                  >
                    <header class="document-exercise-card-header">
                      <div class="document-exercise-card-identity">
                        <span>{{ subjectLabel(exercise) }}</span>
                        <div class="document-exercise-add-actions">
                          <v-tooltip text="Añadir ejercicio" location="top">
                            <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" icon="mdi-plus" size="x-small" color="primary" variant="text" elevation="0" aria-label="Añadir ejercicio" @click="addExercise(exercise)" /></template>
                          </v-tooltip>
                        </div>
                      </div>
                      <ExerciseVariantSelector
                        :model-value="selectedVersionFor(exercise)"
                        :variations="exercise.variaciones || []"
                        compact
                        @update:model-value="setSelectedVersion(exercise, $event)"
                      />
                    </header>
                    <div class="document-exercise-card-pdf">
                      <div v-if="activeThumbnail(exercise)" class="document-exercise-card-thumbnail-frame" :style="activeThumbnailStyle(exercise)">
                        <img
                          :src="activeThumbnail(exercise)"
                          :alt="`Enunciado del ejercicio ${exercise.id}`"
                          :width="activeThumbnailMetadata(exercise)?.width || undefined"
                          :height="activeThumbnailMetadata(exercise)?.height || undefined"
                          class="document-exercise-card-thumbnail"
                          loading="lazy"
                          decoding="async"
                          @load="revealDocumentExerciseThumbnail"
                        >
                      </div>
                      <ExercisePdfPreview v-else-if="activePdf(exercise)" :src="activePdf(exercise)" :aspect-ratio="activePdfAspectRatio(exercise)" :title="`Enunciado de la versión ${selectedVersionFor(exercise)} del ejercicio ${exercise.id}`" thumbnail />
                      <div v-else class="document-exercise-no-pdf"><v-icon icon="mdi-file-pdf-box" size="32" /><span>PDF pendiente</span></div>
                    </div>
                    <footer class="document-exercise-concepts" :title="conceptLabel(exercise)">{{ cardConceptLabel(exercise) }}</footer>
                    <footer class="document-exercise-authors">
                      <span :title="`Autor del enunciado: ${activeVersionAuthors(exercise).statement}`"><strong>Enunciado</strong> · {{ activeVersionAuthors(exercise).statement }}</span>
                      <v-spacer />
                      <span :title="`Autor de la solución: ${activeVersionAuthors(exercise).solution}`"><strong>Solución</strong> · {{ activeVersionAuthors(exercise).solution }}</span>
                    </footer>
                  </article>
                </template>
              </MasonryGrid>
            </div>
            <div v-else class="document-exercises-empty"><v-icon icon="mdi-file-search-outline" size="42" /><span>No hay ejercicios coincidentes.</span></div>
          </section>

          <section class="document-queue-pane">
            <div class="document-queue-content" @dragover.prevent @drop="dropOnQueueSection($event, 'required')">
              <div class="document-queue-section document-required-section">
                <header class="document-queue-heading">
                  <div><strong>Ejercicios seleccionados</strong><span>Arrastra para cambiar el orden.</span></div>
                  <v-chip size="small" color="primary" variant="tonal">{{ selectedExercises.length }}</v-chip>
                </header>
                <div v-if="exerciseQueue.length" class="document-queue-grid">
                  <article
                    v-for="(item, index) in exerciseQueue"
                    :key="item.type === 'tool' ? `tool-${item.toolId}-${index}` : item.exerciseId"
                    class="document-queue-card"
                    :class="{ 'document-tool-queue-card': isTool(item), [`document-tool-${toolForQueue(item)?.id}`]: isTool(item), 'document-tool-disabled': isTool(item) && toolForQueue(item)?.id === 'optativos' && optionalToolChoiceOptions(index).length === 0 }"
                    draggable="true"
                    @dragstart="startQueueDrag($event, item)"
                    @dragover.prevent
                    @drop.stop="dropOnQueueSection($event, 'required', isTool(item) ? `tool:${item.toolId}` : item.exerciseId)"
                  >
                    <header v-if="isTool(item)" class="document-tool-queue-header" :class="`document-tool-${toolForQueue(item)?.id}`">
                      <v-icon v-if="toolForQueue(item)?.icon" :icon="toolForQueue(item)?.icon" size="18" />
                      <strong>{{ toolForQueue(item)?.label || 'Herramienta' }}</strong>
                      <v-spacer />
                      <v-btn class="document-tool-remove" icon="mdi-close" size="x-small" variant="text" aria-label="Quitar herramienta" @click="removeQueuedExercise(`tool:${item.toolId}`)" />
                    </header>
                    <header v-else>
                      <span class="document-queue-order">{{ exerciseOrder(index) }}</span>
                      <strong>{{ subjectLabel(exerciseForQueue(item)) }}</strong>
                      <v-spacer />
                      <v-btn icon="mdi-close" size="x-small" variant="text" color="error" aria-label="Quitar ejercicio" @click="removeQueuedExercise(item.exerciseId)" />
                    </header>
                    <div v-if="isTool(item) && toolForQueue(item)?.id === 'optativos'" class="document-tool-queue-body">
                      <div class="document-tool-choice" role="group" aria-label="Número de ejercicios optativos que deben elegirse">
                        <button
                          v-for="option in optionalToolChoiceOptions(index)"
                          :key="option"
                          type="button"
                          :class="{ selected: Number(item.args?.count) === option }"
                          :aria-pressed="Number(item.args?.count) === option"
                          @click="setToolArgument(item, 'count', option)"
                        >{{ option }}</button>
                        <span v-if="!optionalToolChoiceOptions(index).length">Debe haber al menos dos ejercicios en esta sección</span>
                      </div>
                    </div>
                    <div v-else-if="isTool(item) && (toolForQueue(item)?.arguments || []).length" class="document-tool-queue-body">
                      <v-text-field
                        v-for="argument in toolForQueue(item)?.arguments || []"
                        :key="argument.key"
                        v-model="item.args[argument.key]"
                        :type="argument.type === 'number' ? 'number' : 'text'"
                        :label="argument.label"
                        :min="argument.min"
                        :max="argument.max"
                        density="compact"
                        variant="outlined"
                        hide-details
                        @update:model-value="invalidatePreview"
                      />
                    </div>
                    <ExerciseVariantSelector
                      v-if="!isTool(item)"
                      :model-value="item.version"
                      :variations="exerciseForQueue(item)?.variaciones || []"
                      compact
                      @update:model-value="setSelectedVersion(exerciseForQueue(item), $event)"
                    />
                    <div v-if="!isTool(item)" class="document-queue-sections">
                      <section class="document-queue-section">
                        <div class="document-queue-metric-row document-queue-metric-main">
                          <strong>{{ queueApartados(item).length ? 'Total' : 'Ejercicio' }}</strong>
                          <label>Puntos<input :value="queueMetrics(item).puntuacion" type="number" min="0" step="0.25" :disabled="queueApartados(item).length > 0" @change="updateQueueMetric(item, 'puntuacion', $event.target.value)" /></label>
                          <label>Minutos<input :value="queueMetrics(item).tiempo" type="number" min="0" step="1" :disabled="queueApartados(item).length > 0" @change="updateQueueMetric(item, 'tiempo', $event.target.value)" /></label>
                        </div>
                        <div class="document-queue-card-pdf">
                          <ExercisePdfPreview v-if="queueMainPdf(item)" :src="queueMainPdf(item)" :title="queueApartados(item).length ? `Enunciado común del ejercicio ${index + 1}` : `Ejercicio seleccionado ${index + 1}`" crop-bottom thumbnail />
                          <div v-else class="document-exercise-no-pdf compact"><v-icon icon="mdi-file-pdf-box" size="24" /><span>PDF común pendiente</span></div>
                        </div>
                      </section>
                      <section v-for="(apartado, apartadoIndex) in queueApartados(item)" :key="apartado.id || apartadoIndex" class="document-queue-section document-queue-apartado">
                        <div class="document-queue-metric-row">
                          <strong>{{ String.fromCharCode(97 + apartadoIndex) }}.</strong>
                          <label>Puntos<input :value="queueMetrics(item).apartados?.[apartadoIndex]?.puntuacion || 0" type="number" min="0" step="0.25" @change="updateQueueMetric(item, 'puntuacion', $event.target.value, apartadoIndex)" /></label>
                          <label>Minutos<input :value="queueMetrics(item).apartados?.[apartadoIndex]?.tiempo || 0" type="number" min="0" step="1" @change="updateQueueMetric(item, 'tiempo', $event.target.value, apartadoIndex)" /></label>
                        </div>
                        <div class="document-queue-card-pdf">
                          <ExercisePdfPreview v-if="queueApartadoPdf(item, apartadoIndex)" :src="queueApartadoPdf(item, apartadoIndex)" :title="`Apartado ${String.fromCharCode(97 + apartadoIndex)} del ejercicio ${index + 1}`" crop-bottom thumbnail />
                          <div v-else class="document-exercise-no-pdf compact"><v-icon icon="mdi-file-pdf-box" size="24" /><span>PDF pendiente</span></div>
                        </div>
                      </section>
                    </div>
                    <footer v-if="!isTool(item)">{{ conceptLabel(exerciseForQueue(item)) }}</footer>
                  </article>
                </div>
                <div v-else class="document-queue-empty compact"><v-icon icon="mdi-tray-arrow-down" size="36" /><span>Suelta aquí ejercicios y herramientas.</span></div>
              </div>
            </div>
            <aside class="document-tools-pane" aria-label="Herramientas del documento">
              <header><v-icon icon="mdi-tools" size="18" /><strong>Herramientas</strong></header>
              <div class="document-tools-list">
                <article
                  v-for="tool in documentTools"
                  :key="tool.id"
                  class="document-tool-card"
                  :class="`document-tool-${tool.id}`"
                  draggable="true"
                  @dragstart="startToolDrag($event, tool)"
                >
                  <v-icon v-if="tool.icon" :icon="tool.icon" size="20" />
                  <strong>{{ tool.label }}</strong>
                  <span>{{ tool.description }}</span>
                </article>
              </div>
            </aside>
          </section>
        </div>

        <div v-else-if="currentStep === 4" class="document-preview-step" :class="{ 'document-preview-with-code': showDocumentCode }">
          <div class="document-preview-display-toolbar">
            <v-btn
              prepend-icon="mdi-refresh"
              size="small"
              rounded="pill"
              variant="text"
              :loading="isCompiling"
              :disabled="isCompiling || !selectedTemplate"
              @click="compileDocument(true)"
            >Recompilar</v-btn>
            <v-btn
              v-if="!isAssessmentPreviewSelected"
              :prepend-icon="showDocumentCode ? 'mdi-code-tags-check' : 'mdi-code-tags'"
              size="small"
              rounded="pill"
              :color="showDocumentCode ? 'primary' : undefined"
              :variant="showDocumentCode ? 'tonal' : 'text'"
              :aria-pressed="showDocumentCode"
              @click="showDocumentCode = !showDocumentCode"
            >{{ showDocumentCode ? 'Ocultar código' : 'Mostrar código' }}</v-btn>
          </div>
          <div class="document-preview-layout">
            <aside class="document-preview-selector" aria-label="Documentos generados">
              <article v-if="workflowDocumentSummary.group || workflowDocumentSummary.items.length" class="document-preview-summary">
                <header>
                  <div>
                    <span>Grupo</span>
                    <strong>{{ workflowDocumentSummary.group || 'Sin grupo' }}</strong>
                  </div>
                  <small v-if="workflowDocumentSummary.studentCount !== null">
                    <v-icon icon="mdi-account-multiple-outline" size="14" />
                    {{ workflowDocumentSummary.studentCount }} {{ workflowDocumentSummary.studentCount === 1 ? 'alumno' : 'alumnos' }}
                  </small>
                </header>
                <dl v-if="workflowDocumentSummary.items.length">
                  <div v-for="item in workflowDocumentSummary.items" :key="item.key">
                    <dt><v-icon :icon="item.icon" size="14" />{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                  </div>
                </dl>
              </article>
              <strong>Documentos generados</strong>
              <div
                v-for="template in selectedTemplates"
                :key="template.key"
                class="document-preview-selector-item"
                :class="{ active: selectedPreviewTemplateKey === template.key }"
              >
                <button type="button" class="document-preview-select" @click="selectPreviewTemplate(template.key)">
                  <v-icon icon="mdi-file-pdf-box" size="18" />
                  <span>{{ template.nombre || template.metadata.name }}</span>
                </button>
                <span class="document-preview-actions">
                  <v-btn
                    icon="mdi-download"
                    size="x-small"
                    density="comfortable"
                    variant="text"
                    rounded="circle"
                    aria-label="Descargar documento"
                    :disabled="!previewEntryForTemplate(template.key)"
                    @click.stop="downloadGeneratedDocument(previewEntryForTemplate(template.key))"
                  />
                  <v-btn
                    icon="mdi-printer-outline"
                    size="x-small"
                    density="comfortable"
                    variant="text"
                    rounded="circle"
                    aria-label="Imprimir documento"
                    :disabled="!previewEntryForTemplate(template.key)"
                    @click.stop="printGeneratedDocument(previewEntryForTemplate(template.key))"
                  />
                </span>
              </div>
              <div
                v-if="documentAssessment.evaluable"
                class="document-preview-selector-item"
                :class="{ active: isAssessmentPreviewSelected }"
              >
                <button type="button" class="document-preview-select" @click="selectAssessmentPreview">
                  <v-icon icon="mdi-table-check" size="18" />
                  <span>Matriz de evaluación</span>
                </button>
              </div>
            </aside>
            <div class="document-preview-render">
              <DocumentAssessmentMatrix
                v-if="isAssessmentPreviewSelected"
                :exercises="assessmentPreviewExercises"
                subtitle="Resoluciones segmentadas y logros del documento"
                :badge="documentAssessment.shortName"
              />
              <template v-else>
                <DocumentCodeEditor
                  v-if="showDocumentCode"
                  :model-value="documentCode"
                  :compiling="isCompiling"
                  @update:model-value="updateDocumentCode"
                  @compile="compileDocument"
                />
                <DocumentPdfPreview :src="previewUrl" />
              </template>
            </div>
          </div>
        </div>
      </div>
      <v-snackbar
        v-model="compileErrorVisible"
        location="bottom"
        color="error"
        :timeout="-1"
        multi-line
        class="document-compile-snackbar"
      >
        <div class="document-compile-snackbar-message">{{ compileError }}</div>
        <template #actions>
          <v-btn variant="text" size="small" @click="copyCompileError">Copiar</v-btn>
          <v-btn icon="mdi-close" variant="text" size="small" aria-label="Cerrar error" @click="compileErrorVisible = false" />
        </template>
      </v-snackbar>
    </section>
  </div>
  <v-dialog v-model="documentDeleteDialog" max-width="430" persistent>
    <v-card>
      <v-card-title>Eliminar documento</v-card-title>
      <v-card-text>
        ¿Seguro que quieres eliminar «{{ documentDeleteTarget ? documentCardTitle(documentDeleteTarget) : '' }}»? Se borrarán también sus PDFs almacenados.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="isDeletingDocument" @click="documentDeleteDialog = false">Cancelar</v-btn>
        <v-btn color="error" variant="flat" :loading="isDeletingDocument" @click="deleteDocument">Eliminar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.document-creator { width: 100%; height: 100%; min-height: 0; overflow: hidden; background: #f4f7fb; }
.document-library { position: relative; width: 100%; height: 100%; overflow: auto; padding: 10px; }
.document-library-error { position: sticky; z-index: 3; top: 0; margin-bottom: 10px; }
.document-library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); align-items: start; gap: 10px; }
.document-library-card { overflow: hidden; border: 1px solid #dce5f0; border-radius: 15px !important; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
.document-library-card:hover { border-color: #94afd1; box-shadow: 0 9px 24px rgba(33, 64, 103, .12) !important; transform: translateY(-2px); }
.document-library-card header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 14px 15px 11px; border-bottom: 1px solid #e1e8f1; background: #f4f8fd; }
.document-library-card header div { min-width: 0; }
.document-library-card header span { display: block; color: #7387a1; font-size: .67rem; font-weight: 750; letter-spacing: .055em; text-transform: uppercase; }
.document-library-card header strong { display: block; margin-top: 3px; overflow: hidden; color: #26486f; font-size: .94rem; text-overflow: ellipsis; white-space: nowrap; }
.document-library-card dl { display: grid; grid-template-columns: minmax(82px, auto) 1fr; gap: 7px 12px; margin: 0; padding: 13px 15px; font-size: .75rem; }
.document-library-card dt { color: #8291a5; font-weight: 700; }
.document-library-card dd { min-width: 0; margin: 0; overflow: hidden; color: #405a79; text-overflow: ellipsis; white-space: nowrap; }
.document-library-card footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-top: 1px solid #e5ebf3; color: #7a8ba1; font-size: .67rem; }
.document-library-actions { display: flex; align-items: center; gap: 6px; }
.document-library-empty { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: #70839b; text-align: center; }
.document-library-empty strong { color: #34577f; }
.document-library-empty span { font-size: .78rem; }
.document-viewer { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.document-viewer-layout { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr); overflow: hidden; }

.document-workflow { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-rows: 76px minmax(0, 1fr); overflow: hidden; }
.document-stepper { display: grid; grid-template-columns: repeat(var(--document-step-count, 4), minmax(0, 1fr)); margin: 0; padding: 0 8%; border-bottom: 1px solid #d7e1ed; background: #fff; list-style: none; }
.document-stepper li { position: relative; display: flex; align-items: center; justify-content: center; }
.document-stepper li:not(:last-child)::after { position: absolute; z-index: 0; top: 31px; right: -50%; width: 100%; height: 2px; background: #dbe4ef; content: ''; }
.document-stepper li.complete:not(:last-child)::after { background: #6b94c9; }
.document-stepper button { position: relative; z-index: 1; display: flex; min-width: 105px; align-items: center; justify-content: center; flex-direction: column; gap: 3px; padding: 8px 12px; border: 0; outline: 0; background: #fff; color: #8a98aa; cursor: pointer; }
.document-stepper button:disabled { cursor: default; }
.document-step-number { display: inline-flex; width: 31px; height: 31px; align-items: center; justify-content: center; border: 2px solid #c9d5e4; border-radius: 50%; background: #fff; font-size: .72rem; font-weight: 800; }
.document-step-title { font-size: .7rem; font-weight: 750; }
.document-stepper li.active button { color: #315f97; }
.document-stepper li.active .document-step-number { border-color: #3e75ba; background: #3e75ba; color: #fff; box-shadow: 0 0 0 4px rgba(62, 117, 186, .13); }
.document-stepper li.complete button { color: #4d719e; }
.document-stepper li.complete .document-step-number { border-color: #6b94c9; background: #e6effa; color: #315f97; }
.document-step-content { min-width: 0; min-height: 0; overflow: hidden; }

.document-template-step { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(0, 1.35fr) minmax(220px, .8fr) minmax(280px, 1fr); overflow: hidden; }
.document-template-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); align-content: start; gap: 12px; padding: 14px; overflow: auto; }
.document-template-empty { display: flex; min-height: 220px; align-items: center; justify-content: center; grid-column: 1 / -1; flex-direction: column; gap: 9px; padding: 30px; border: 1px dashed #cfdbea; border-radius: 16px; background: rgba(255, 255, 255, .65); color: #71859d; text-align: center; }
.document-template-empty strong { color: #385b82; }
.document-template-empty span { max-width: 510px; font-size: .76rem; line-height: 1.45; }
.document-template-empty code { color: #315f97; font-size: .72rem; font-weight: 750; }
.document-template-card { position: relative; display: flex; min-height: 150px; align-items: flex-start; flex-direction: column; gap: 8px; padding: 18px; border: 1px solid #d5e0ec; border-radius: 16px; outline: 0; background: #fff; color: #66809f; text-align: left; cursor: pointer; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
.document-template-card:hover { border-color: #8daed5; box-shadow: 0 8px 22px rgba(36, 69, 110, .1); transform: translateY(-2px); }
.document-template-card strong { color: #2f527b; font-size: 1rem; }
.document-template-card span { color: #778ba3; font-size: .76rem; line-height: 1.4; }
.document-template-card.selected { border-color: #3e75ba; box-shadow: 0 0 0 2px rgba(62, 117, 186, .15); }
.document-template-selected { position: absolute; top: 12px; right: 12px; color: #3e75ba; }
.document-template-queue { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 10px; padding: 14px; border-left: 1px solid #d8e2ed; border-right: 1px solid #d8e2ed; background: #f5f8fc; overflow: auto; }
.document-template-queue > header { display: flex; align-items: center; gap: 8px; color: #315981; font-size: .78rem; }
.document-template-queue-list { display: flex; flex-direction: column; gap: 8px; }
.document-template-queue-card { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px; border: 1px solid #bfd0e4; border-radius: 10px; background: #fff; box-shadow: 0 2px 7px rgba(25, 54, 91, .06); }
.document-template-queue-card div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.document-template-queue-card strong { overflow: hidden; color: #31557e; font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.document-template-queue-card span { overflow: hidden; color: #7c8da2; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }
.document-template-queue-empty { display: flex; min-height: 150px; align-items: center; justify-content: center; flex-direction: column; gap: 8px; padding: 18px; border: 1px dashed #bfd0e4; border-radius: 12px; color: #7d8fa5; font-size: .72rem; text-align: center; }
.document-fields-pane { display: flex; min-height: 0; align-items: stretch; justify-content: flex-start; flex-direction: column; gap: 12px; padding: 18px; border-left: 1px solid #d8e2ed; overflow: auto; background: #fff; }
.document-fields-pane :deep(.v-input) { flex: 0 0 auto; }
.document-fields-pane.empty { align-items: center; justify-content: center; color: #7d8fa5; text-align: center; font-size: .78rem; }
.document-fields-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; color: #315981; }
.document-fields-heading div { display: flex; flex-direction: column; }
.document-fields-heading span { color: #7e8fa4; font-size: .69rem; }
.document-assessment-fields { display: grid; gap: 10px; margin-top: 4px; padding-top: 12px; border-top: 1px solid #dbe4ef; }
.document-evaluable-toggle { display: flex; width: 100%; min-height: 48px; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid #ccd8e6; border-radius: 10px; outline: 0; background: #f7f9fc; color: #708299; font: inherit; text-align: left; cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease; }
.document-evaluable-toggle span { display: flex; min-width: 0; flex-direction: column; }
.document-evaluable-toggle strong { font-size: .75rem; }
.document-evaluable-toggle small { margin-top: 1px; font-size: .61rem; line-height: 1.25; }
.document-evaluable-toggle.active { border-color: #3f72b7; background: #e9f1fb; color: #315f97; }
.document-evaluable-toggle:focus-visible { box-shadow: 0 0 0 3px rgba(63,114,183,.18); }

.document-curriculum-step { width: 100%; height: 100%; }
.document-exercise-step { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) 142px; overflow: hidden; }
.document-matches-pane { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; border-right: 1px solid #d8e2ed; }
.document-exercise-toolbar { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-bottom: 1px solid #dbe4ef; background: #fff; }
.document-exercise-toolbar .v-text-field { flex: 1; }
.document-exercise-toolbar > span { color: #74879e; font-size: .7rem; font-weight: 700; white-space: nowrap; }
.document-matches-scroll { flex: 1 1 auto; min-height: 0; padding: 9px; overflow: auto; }
.document-matches-grid { width: 100%; }
.document-exercise-card { width: 100%; min-width: 0; overflow: hidden; border: 1px solid #d3deeb; border-radius: 13px; background: #fff; cursor: grab; }
.document-exercise-card:active { cursor: grabbing; }
.document-exercise-card > .document-exercise-card-header { display: flex; min-height: 29px; flex-direction: column; padding: 0; background: #eaf1fa; color: #3b5779; font-size: .64rem; font-weight: 800; }
.document-exercise-card-identity { display: flex; min-width: 0; min-height: 29px; align-items: center; gap: 6px; padding: 3px 5px 3px 9px; }
.document-exercise-card-identity > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.document-exercise-add-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 1px; margin-left: auto; }
.document-exercise-add-actions :deep(.v-btn) { width: 25px; height: 25px; box-shadow: none !important; }
.document-exercise-card-header :deep(.exercise-variant-bar) { width: 100%; border-top: 1px solid #d4e0ed; border-bottom: 0; background: #f3f7fc; }
.document-exercise-card-pdf { overflow: hidden; background: #fff; }
.document-exercise-card-thumbnail-frame { position: relative; width: 100%; min-height: 155px; overflow: hidden; background: #e8edf5; }
.document-exercise-card-thumbnail-frame[style] { min-height: 0; }
.document-exercise-card-thumbnail-frame::after { position: absolute; z-index: 0; inset: 0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.72) 50%, transparent 65%); content: ''; transform: translateX(-100%); animation: document-thumbnail-shimmer 1.25s ease-in-out infinite; }
.document-exercise-card-thumbnail-frame.is-loaded::after { display: none; }
.document-exercise-card-thumbnail { position: relative; z-index: 1; display: block; width: 100%; height: 100%; margin: 0; opacity: 0; background: #fff; object-fit: contain; transition: opacity .12s ease; }
.document-exercise-card-thumbnail-frame.is-loaded .document-exercise-card-thumbnail { opacity: 1; }
@keyframes document-thumbnail-shimmer { to { transform: translateX(100%); } }
.document-exercise-card-pdf :deep(.exercise-pdf-preview) { min-height: 155px; }
.document-exercise-card-pdf :deep(.exercise-pdf-preview.exercise-pdf-preview-loaded) { min-height: 0; }
.document-exercise-no-pdf { display: flex; min-height: 155px; align-items: center; justify-content: center; flex-direction: column; color: #7d8da2; font-size: .72rem; }
.document-exercise-card > footer { padding: 5px 8px; color: #5a6f8a; font-size: .6rem; line-height: 1.25; }
.document-exercise-concepts { overflow: hidden; border-top: 1px solid #dfe7f0; background: #f7f9fc; text-overflow: ellipsis; white-space: nowrap; }
.document-exercise-authors { display: flex; min-width: 0; min-height: 27px; align-items: center; gap: 6px; border-top: 1px solid #e1e7ef; background: #fff; color: #718198 !important; font-size: .56rem !important; }
.document-exercise-authors > span:not(.v-spacer) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.document-exercise-authors strong { color: #3e5878; font-weight: 800; }
.document-exercises-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 9px; color: #73859c; }
.document-queue-pane { display: contents; }
.document-queue-content { grid-column: 2; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; background: #f4f7fb; }
.document-queue-section { display: flex; min-width: 0; flex: 0 0 auto; flex-direction: column; overflow: visible; }
.document-required-section { background: #f7faff; }
.document-optional-section { background: #fbf8fd; }
.document-queue-heading { display: flex; min-height: 49px; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 12px; border-bottom: 1px solid #dbe4ef; background: rgba(255, 255, 255, .92); }
.document-queue-heading div { display: flex; flex-direction: column; }
.document-queue-heading strong { color: #31557e; font-size: .82rem; }
.document-queue-heading span { color: #7c8da2; font-size: .68rem; }
.document-queue-grid { display: flex; min-height: 0; flex-direction: column; gap: 8px; padding: 8px; overflow: visible; }
.document-queue-card { min-width: 0; overflow: hidden; border: 1px solid #d5e0ec; border-radius: 12px; background: #fff; box-shadow: 0 2px 7px rgba(25, 54, 91, .06); cursor: grab; }
.document-queue-card:active { cursor: grabbing; }
.document-queue-card > header { display: flex; min-height: 34px; align-items: center; gap: 3px; padding: 4px 5px 4px 7px; background: #edf3fb; }
.document-queue-card > header strong { min-width: 0; overflow: hidden; color: #3b5879; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }
.document-queue-order { display: inline-flex; width: 25px; height: 25px; align-items: center; justify-content: center; border-radius: 50%; background: #3f72b7; color: #fff; font-size: .7rem; font-weight: 800; }
.document-queue-order.optional { background: #a25091; }
.document-queue-card :deep(.exercise-variant-bar) { border-inline: 0; border-radius: 0; }
.document-queue-sections { display: grid; border-top: 1px solid #dfe7f0; border-bottom: 1px solid #dfe7f0; background: #f9fbfe; }
.document-queue-section { min-width: 0; overflow: hidden; border-top: 1px solid #dfe7f0; }
.document-queue-section:first-child { border-top: 0; }
.document-queue-metric-row { display: grid; min-height: 29px; align-items: center; grid-template-columns: 32px 1fr 1fr; gap: 5px; padding: 3px 7px; border-top: 1px solid #e8edf4; }
.document-queue-metric-row:first-child { border-top: 0; }
.document-queue-metric-row > strong { color: #416185; font-size: .62rem; }
.document-queue-metric-row label { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 3px; color: #77899f; font-size: .49rem; font-weight: 750; text-transform: uppercase; }
.document-queue-metric-row input { width: 58px; height: 23px; padding: 0 5px; border: 1px solid #c9d6e5; border-radius: 5px; outline: 0; background: #fff; color: #31557e; font: inherit; font-size: .64rem; text-align: center; }
.document-queue-metric-row input:focus { border-color: #4b7fbc; box-shadow: 0 0 0 2px rgba(75,127,188,.13); }
.document-queue-metric-row input:disabled { border-color: transparent; background: #e9eff6; color: #60758f; opacity: 1; }
.document-queue-metric-main { background: #edf3fa; }
.document-queue-card-pdf { overflow: hidden; background: #fff; }
.document-queue-card-pdf :deep(.exercise-pdf-preview) { min-height: 135px; }
.document-queue-card-pdf :deep(.exercise-pdf-preview.exercise-pdf-preview-loaded) { min-height: 0; }
.document-queue-apartado .document-queue-metric-row { background: #f5f8fc; }
.document-queue-apartado .document-queue-card-pdf :deep(.exercise-pdf-preview) { min-height: 92px; }
.document-exercise-no-pdf.compact { min-height: 76px; gap: 4px; font-size: .6rem; }
.document-queue-card > footer { min-height: 31px; padding: 6px 8px; color: #5a6f8a; font-size: .62rem; line-height: 1.35; }
.document-optional-divider { display: grid; min-height: 48px; align-items: center; grid-template-columns: minmax(132px, auto) auto minmax(0, 1fr); gap: 10px; padding: 6px 12px; border-top: 1px solid #d7e1ed; border-bottom: 1px solid #d7e1ed; background: #fff; }
.document-optional-divider > div { display: flex; align-items: baseline; gap: 8px; color: #734b76; }
.document-optional-divider strong { font-size: .8rem; }
.document-optional-divider > div span { color: #8c7890; font-size: .65rem; font-weight: 700; text-transform: uppercase; }
.document-optional-divider > .v-chip { justify-self: end; }
.document-optional-count { display: inline-flex; align-items: center; justify-self: start; gap: 3px; padding: 3px; border: 1px solid #d7c9d8; border-radius: 999px; background: #f4edf5; }
.document-optional-count button { display: inline-flex; width: 25px; height: 25px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; outline: 0; background: transparent; color: #806d82; font: inherit; font-size: .68rem; font-weight: 800; cursor: pointer; }
.document-optional-count button:hover { background: rgba(162, 80, 145, .1); }
.document-optional-count button.selected { background: #a25091; color: #fff; box-shadow: 0 1px 4px rgba(112, 54, 101, .24); }
.document-optional-count button:focus-visible { box-shadow: 0 0 0 2px rgba(162, 80, 145, .28); }
.document-optional-single, .document-optional-empty-label { color: #7f7182; font-size: .68rem; font-weight: 700; }
.document-queue-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 8px; padding: 24px; color: #71859d; text-align: center; }
.document-queue-empty.compact { min-height: 0; padding: 14px; }
.document-queue-empty strong { color: #3c5d81; }
.document-queue-empty span { font-size: .7rem; }
.document-tool-queue-card { border-color: #b9cce2; background: #f8fbff; }
.document-tool-obligatorios { border-color: #9bb9d8; background: #edf5ff; }
.document-tool-optativos { border-color: #d0afd0; background: #fbf1fb; }
.document-tool-salto-pagina { border-color: #c9b993; background: #fff9ed; }
.document-tool-card.document-tool-obligatorios { border-color: #9bb9d8; background: #edf5ff; color: #315f97; }
.document-tool-card.document-tool-optativos { border-color: #d0afd0; background: #fbf1fb; color: #86517e; }
.document-tool-card.document-tool-salto-pagina { border-color: #c9b993; background: #fff9ed; color: #876b2f; }
.document-tool-queue-header.document-tool-obligatorios { background: #e2effd; color: #315f97; }
.document-tool-queue-header.document-tool-optativos { background: #f6e6f5; color: #86517e; }
.document-tool-queue-header.document-tool-salto-pagina { background: #fff1cf; color: #876b2f; }
.document-tool-card.document-tool-obligatorios,
.document-tool-card.document-tool-optativos,
.document-tool-card.document-tool-salto-pagina {
  border-color: #244f88;
  background: #315f97;
  color: #fff;
  box-shadow: 0 3px 9px rgba(30, 65, 102, .2);
}
.document-tool-queue-header.document-tool-obligatorios,
.document-tool-queue-header.document-tool-optativos,
.document-tool-queue-header.document-tool-salto-pagina {
  background: #315f97;
  color: #fff;
}
.document-tool-queue-card.document-tool-obligatorios,
.document-tool-queue-card.document-tool-optativos,
.document-tool-queue-card.document-tool-salto-pagina {
  border-color: #244f88;
  background: #315f97;
  color: #fff;
}
.document-tool-queue-card {
  border-color: #244f88;
  background: #315f97;
  color: #fff;
}
.document-tool-queue-card > header {
  background: #315f97;
}
.document-tool-queue-card > header strong,
.document-tool-queue-card .document-tool-queue-body,
.document-tool-queue-card .document-tool-queue-body span {
  color: #fff;
}
.document-tool-queue-card .document-tool-queue-body {
  color: rgba(255,255,255,.88);
}
.document-tool-card.document-tool-obligatorios span,
.document-tool-card.document-tool-optativos span,
.document-tool-card.document-tool-salto-pagina span {
  color: rgba(255,255,255,.82);
}
.document-tool-choice {
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
}
.document-tool-choice button {
  color: rgba(255,255,255,.88);
  border: 1px solid rgba(255,255,255,.52);
}
.document-tool-choice button:hover {
  background: rgba(255,255,255,.16);
}
.document-tool-choice button.selected {
  border-color: #dce9f8;
  background: #dce9f8;
  color: #244f88;
  box-shadow: 0 1px 4px rgba(9, 29, 55, .24);
}
.document-tool-choice button:focus-visible {
  box-shadow: 0 0 0 2px rgba(255,255,255,.62);
}
.document-tool-remove {
  color: rgba(255,255,255,.82) !important;
}
.document-tool-remove:hover {
  background: rgba(255,255,255,.14) !important;
  color: #ffd7d7 !important;
}
.document-tool-disabled { opacity: .55; }
.document-tool-queue-header { min-height: 34px; color: #315f97; }
.document-tool-queue-body { display: grid; gap: 8px; padding: 10px 9px; color: #5d7592; font-size: .66rem; line-height: 1.35; }
.document-tool-queue-body p { margin: 0; }
.document-tool-choice { display: inline-flex; align-items: center; justify-self: end; gap: 4px; width: fit-content; padding: 0; border: 0; background: transparent; }
.document-tool-choice button { display: inline-flex; width: 25px; height: 25px; align-items: center; justify-content: center; padding: 0; border: 1px solid rgba(255,255,255,.52); border-radius: 50%; outline: 0; background: transparent; color: rgba(255,255,255,.88); font: inherit; font-size: .68rem; font-weight: 800; cursor: pointer; }
.document-tool-choice button:hover { background: rgba(255,255,255,.16); }
.document-tool-choice button.selected { border-color: #dce9f8; background: #dce9f8; color: #244f88; box-shadow: 0 1px 4px rgba(9, 29, 55, .24); }
.document-tool-choice button:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,.62); }
.document-tool-choice span { max-width: 145px; padding: 3px 5px; color: rgba(255,255,255,.84); font-size: .62rem; }
.document-tools-pane { grid-column: 3; min-width: 0; padding: 8px; border-left: 1px solid #d8e2ed; background: #eef3f9; overflow: auto; }
.document-tools-pane > header { display: flex; align-items: center; gap: 6px; padding: 5px 3px 9px; border-bottom: 1px solid #d3dfec; color: #315981; font-size: .72rem; }
.document-tools-list { display: grid; gap: 8px; padding-top: 8px; }
.document-tool-card { display: flex; min-width: 0; align-items: center; flex-direction: column; gap: 5px; padding: 10px 6px; border: 1px solid #c7d6e7; border-radius: 10px; background: #fff; color: #315f97; text-align: center; cursor: grab; box-shadow: 0 2px 6px rgba(30, 65, 102, .06); }
.document-tool-card:active { cursor: grabbing; }
.document-tool-card strong { font-size: .68rem; }
.document-tool-card span { color: #74879e; font-size: .6rem; line-height: 1.3; }

.document-preview-step { position: relative; display: grid; width: 100%; height: 100%; min-height: 0; grid-template-rows: 43px minmax(0, 1fr); overflow: hidden; }
.document-preview-display-toolbar { display: flex; align-items: center; justify-content: flex-end; padding: 5px 10px; border-bottom: 1px solid #d7e1ed; background: #fff; }
.document-preview-layout { display: grid; min-width: 0; min-height: 0; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr); overflow: hidden; }
.document-preview-selector { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 8px; padding: 12px; border-right: 1px solid #d8e2ed; background: #f4f7fb; overflow: auto; }
.document-preview-summary { overflow: hidden; border: 1px solid #c4d5e8; border-radius: 12px; background: #fff; color: #315981; box-shadow: 0 4px 12px rgba(43, 76, 118, .08); }
.document-preview-summary header { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 11px; background: linear-gradient(135deg, #315f97, #477ebd); color: #fff; }
.document-preview-summary header div { min-width: 0; }
.document-preview-summary header span { display: block; margin-bottom: 1px; color: #cfe0f3; font-size: .54rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.document-preview-summary header strong { display: block; overflow: hidden; font-size: .85rem; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.document-preview-summary header small { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; padding: 4px 7px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; font-size: .58rem; font-weight: 750; white-space: nowrap; }
.document-preview-summary dl { display: grid; gap: 0; margin: 0; padding: 5px 10px 7px; }
.document-preview-summary dl > div { display: grid; min-width: 0; grid-template-columns: 76px minmax(0, 1fr); align-items: baseline; gap: 7px; padding: 6px 1px; border-bottom: 1px solid #e4ebf3; }
.document-preview-summary dl > div:last-child { border-bottom: 0; }
.document-preview-summary dt { display: inline-flex; align-items: center; gap: 4px; color: #7b8ea6; font-size: .57rem; font-weight: 750; }
.document-preview-summary dd { min-width: 0; margin: 0; overflow: hidden; color: #385a80; font-size: .65rem; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.document-preview-selector > strong { padding: 2px 4px 7px; color: #315981; font-size: .76rem; }
.document-preview-selector-item { display: flex; min-width: 0; align-items: center; gap: 2px; padding: 3px 4px 3px 6px; border: 1px solid #d2deeb; border-radius: 10px; background: #fff; color: #557292; }
.document-preview-selector-item.active { border-color: #3e75ba; background: #e8f0fb; color: #28588f; box-shadow: 0 0 0 2px rgba(62,117,186,.12); }
.document-preview-select { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; gap: 7px; padding: 7px 3px; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; font-size: .72rem; text-align: left; cursor: pointer; }
.document-preview-select span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.document-preview-actions { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 0; }
.document-preview-actions .v-btn { color: currentColor; }
.document-preview-render { min-width: 0; min-height: 0; overflow: hidden; }
.document-preview-with-code .document-preview-render { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); }
.document-preview-with-code .document-preview-render .document-pdf-preview { border-left: 1px solid #cbd7e5; }
.document-compile-error { position: absolute; z-index: 4; top: 53px; right: 12px; left: 12px; max-height: 38%; overflow: auto; }
.document-compile-snackbar-message { max-width: min(70vw, 920px); max-height: 28vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; line-height: 1.35; }
.document-assessment-loading { display: flex; width: 100%; height: 100%; min-height: 220px; align-items: center; justify-content: center; gap: 12px; color: #6f8298; font-size: .74rem; }

@media (max-width: 900px) {
  .document-stepper { padding-inline: 2%; }
  .document-template-step { grid-template-columns: minmax(0, 1.15fr) minmax(190px, .8fr) minmax(250px, 1fr); }
  .document-exercise-step { grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr) 124px; }
}
</style>
