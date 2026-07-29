<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db, storage } from '../services/firebase'
import { mathSubjects } from '../data/mathCurriculum'
import ExerciseCurriculumPicker from './ExerciseCurriculumPicker.vue'
import ExercisePdfPreview from './ExercisePdfPreview.vue'
import ExerciseVariantSelector from './ExerciseVariantSelector.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import DocumentCodeEditor from './DocumentCodeEditor.vue'
import MasonryGrid from './MasonryGrid.vue'

const props = defineProps({
  templates: { type: Array, default: () => [] },
  exercises: { type: Array, default: () => [] },
  conceptNodes: { type: Array, default: () => [] },
  subjectSelections: { type: Object, default: () => ({}) },
  exerciseCounts: { type: Object, default: () => ({}) },
  compilerBaseUrl: { type: String, default: '/compiler-api/v1' },
  libraryQuery: { type: String, default: '' },
})

const emit = defineEmits(['busy-change', 'state-change'])

const steps = Object.freeze([
  { number: 1, title: 'Plantilla', icon: 'mdi-file-document-outline' },
  { number: 2, title: 'Contenidos', icon: 'mdi-chart-donut-variant' },
  { number: 3, title: 'Ejercicios', icon: 'mdi-format-list-numbered' },
  { number: 4, title: 'Vista previa', icon: 'mdi-file-pdf-box' },
])

const defaultMetadata = Object.freeze({
  name: 'Examen',
  command: 'logo',
  fields: [
    { key: 'subject', label: 'Asignatura', argument: 1, type: 'subject', placeholder: 'Matemáticas II' },
    { key: 'title', label: 'Título', argument: 2, type: 'text', placeholder: 'Recuperación -- 2ª Evaluación' },
    { key: 'date', label: 'Fecha', argument: 3, type: 'text', placeholder: '09 / 03 / 26' },
    { key: 'course', label: 'Curso y grupo', argument: 4, type: 'course', placeholder: '2ºBTO VA' },
  ],
})

const mode = ref('library')
const currentStep = ref(1)
const maxVisitedStep = ref(1)
const documents = ref([])
const isLoadingDocuments = ref(false)
const documentsError = ref('')
const selectedDocumentId = ref(null)
const createdAt = ref(null)
const selectedTemplateKey = ref('')
const fieldValues = reactive({})
const documentCurriculum = ref(emptyCurriculum())
const exerciseQuery = ref('')
const selectedVersions = reactive({})
const exerciseQueue = ref([])
const optionalRequiredCount = ref(1)
const previewUrl = ref('')
const previewBlob = ref(null)
const previewCode = ref('')
const documentCode = ref('')
const documentCodeNeedsRegeneration = ref(true)
const showDocumentCode = ref(false)
const compileError = ref('')
const isCompiling = ref(false)
const isSaving = ref(false)
const dragPayload = ref(null)
const viewedDocument = ref(null)

function emptyCurriculum() {
  return { course: null, subjectId: null, conceptIds: [], competencial: false }
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

function parseTemplateMetadata(code = '') {
  const documentMatch = code.match(/^\s*%\s*neope:document\s+(\{.*\})\s*$/m)
  if (!documentMatch) return null
  try {
    const documentData = JSON.parse(documentMatch[1])
    const fields = [...code.matchAll(/^\s*%\s*neope:field\s+(\{.*\})\s*$/gm)]
      .map((match) => JSON.parse(match[1]))
      .filter((field) => field?.key && field?.label && Number.isFinite(Number(field.argument)))
      .map((field) => ({ ...field, argument: Number(field.argument), type: field.type || 'text' }))
      .sort((a, b) => a.argument - b.argument)
    const detectedOptionalCommand = /\\(?:newcommand\s*\{\\optativos\}|def\s*\\optativos\b)/.test(code)
      ? 'optativos'
      : ''
    const optionalCommand = String(documentData.optionalCommand || detectedOptionalCommand)
      .replace(/^\\/, '')
      .replace(/[^A-Za-z@]/g, '')
    return {
      name: documentData.name || 'Documento',
      command: documentData.command || 'logo',
      optionalCommand,
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
      metadata,
    }]
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
})

const selectedTemplate = computed(() => documentTemplates.value.find((template) => template.key === selectedTemplateKey.value) || null)
const selectedMetadata = computed(() => selectedTemplate.value?.metadata || defaultMetadata)
const filteredDocuments = computed(() => {
  const query = normalizeName(props.libraryQuery)
  if (!query) return documents.value
  return documents.value.filter((documentData) => normalizeName([
    documentData.plantilla?.nombre,
    documentCardTitle(documentData),
    ...Object.values(documentData.campos || {}),
  ].join(' ')).includes(query))
})
const requiredExercises = computed(() => exerciseQueue.value.filter((item) => item.section !== 'optional'))
const optionalExercises = computed(() => exerciseQueue.value.filter((item) => item.section === 'optional'))
const optionalChoiceOptions = computed(() => Array.from(
  { length: Math.max(0, optionalExercises.value.length - 1) },
  (_, index) => index + 1,
))
const requiredFieldsComplete = computed(() => Boolean(selectedTemplate.value)
  && selectedMetadata.value.fields.every((field) => String(fieldValues[field.key] || '').trim()))
const canContinue = computed(() => {
  if (currentStep.value === 1) return requiredFieldsComplete.value
  if (currentStep.value === 2) return Boolean(documentCurriculum.value.subjectId)
  if (currentStep.value === 3) return exerciseQueue.value.length > 0
  return false
})
const workflowState = computed(() => ({
  mode: mode.value,
  step: currentStep.value,
  canContinue: canContinue.value,
  canGoBack: currentStep.value > 1,
  isCompiling: isCompiling.value,
  isSaving: isSaving.value,
  canSave: currentStep.value === 4 && Boolean(previewUrl.value) && !isCompiling.value,
}))

watch(workflowState, (state) => emit('state-change', state), { immediate: true })
watch(() => optionalExercises.value.length, (length) => {
  if (length <= 1) optionalRequiredCount.value = Math.max(1, length)
  else optionalRequiredCount.value = Math.min(Math.max(1, optionalRequiredCount.value), length - 1)
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

const matchingExercises = computed(() => {
  const query = normalizeName(exerciseQuery.value)
  const filter = documentCurriculum.value
  const queuedIds = new Set(exerciseQueue.value.map((item) => item.exerciseId))
  return props.exercises.filter((exercise) => {
    if (queuedIds.has(exercise.id)) return false
    const searchText = normalizeName(`${exercise.enunciado || ''} ${subjectLabel(exercise)} ${conceptLabel(exercise)}`)
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

function activePdf(exercise) {
  return activeVersion(exercise).pdf?.enunciado || ''
}

function setSelectedVersion(exercise, version) {
  if (!exercise) return
  selectedVersions[exercise.id] = version
  const queued = exerciseQueue.value.find((item) => item.exerciseId === exercise.id)
  if (queued) queued.version = version
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

function queueExerciseCode(item) {
  const exercise = exerciseForQueue(item)
  if (!exercise) return ''
  return statementCode(activeVersion(exercise, item.version).enunciado)
}

function queueExercisePdf(item) {
  const exercise = exerciseForQueue(item)
  return activeVersion(exercise, item.version)?.pdf?.enunciado || ''
}

function normalizeQueueSections() {
  exerciseQueue.value = [...requiredExercises.value, ...optionalExercises.value]
}

function addExercise(exercise, section = 'required') {
  const existingIndex = exerciseQueue.value.findIndex((item) => item.exerciseId === exercise.id)
  let item
  if (existingIndex !== -1) {
    ;[item] = exerciseQueue.value.splice(existingIndex, 1)
  } else {
    item = { exerciseId: exercise.id, version: selectedVersionFor(exercise) }
  }
  item.section = section
  exerciseQueue.value.push(item)
  normalizeQueueSections()
  invalidatePreview()
}

function removeQueuedExercise(exerciseId) {
  exerciseQueue.value = exerciseQueue.value.filter((item) => item.exerciseId !== exerciseId)
  invalidatePreview()
}

function moveQueuedExercise(item, section) {
  const exercise = exerciseForQueue(item)
  if (exercise) addExercise(exercise, section)
}

function startExerciseDrag(event, exercise) {
  dragPayload.value = { type: 'exercise', exerciseId: exercise.id }
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('text/plain', exercise.id)
}

function startQueueDrag(event, item) {
  dragPayload.value = { type: 'queue', exerciseId: item.exerciseId }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', item.exerciseId)
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
  if (payload.type === 'queue') {
    const sourceIndex = exerciseQueue.value.findIndex((item) => item.exerciseId === payload.exerciseId)
    if (sourceIndex === -1) return
    const [item] = exerciseQueue.value.splice(sourceIndex, 1)
    item.section = section
    if (targetExerciseId) {
      const targetIndex = exerciseQueue.value.findIndex((candidate) => candidate.exerciseId === targetExerciseId)
      exerciseQueue.value.splice(targetIndex === -1 ? exerciseQueue.value.length : targetIndex, 0, item)
    } else {
      exerciseQueue.value.push(item)
    }
    normalizeQueueSections()
    invalidatePreview()
  }
}

function headerCode() {
  const fields = [...selectedMetadata.value.fields].sort((a, b) => a.argument - b.argument)
  return `\\${selectedMetadata.value.command}\n${fields.map((field) => `    {${String(fieldValues[field.key] || '').trim()}}`).join('\n')}`
}

function templateInputName(template) {
  return (template.archivo || template.nombre || 'plantilla').replace(/\.tex$/i, '')
}

function generatedCode() {
  if (!selectedTemplate.value) return ''
  const requiredCode = requiredExercises.value.map(queueExerciseCode).filter(Boolean).join('\n\n')
  const optionalCode = optionalExercises.value.map(queueExerciseCode).filter(Boolean).join('\n\n')
  const optionalSeparator = selectedMetadata.value.optionalCommand
    ? `\\${selectedMetadata.value.optionalCommand}{${optionalRequiredCount.value}}`
    : `% Ejercicios optativos: elegir ${optionalRequiredCount.value}`
  const exercises = [
    requiredCode ? `% Ejercicios obligatorios\n${requiredCode}` : '',
    optionalCode ? `${optionalSeparator}\n${optionalCode}` : '',
  ].filter(Boolean).join('\n\n')
  return `\\input{../${templateInputName(selectedTemplate.value)}}

\\begin{document}

${headerCode()}

${exercises ? `\\begin{ejercicios}\n${exercises}\n\\end{ejercicios}` : ''}

\\end{document}`
}

function bodyForCompiler(source) {
  const match = source.match(/\\begin\s*\{document\}([\s\S]*?)\\end\s*\{document\}/)
  return (match?.[1] || source).replace(/^\s*\\input\s*\{[^}]+\}\s*/m, '').trim()
}

function invalidatePreview() {
  previewBlob.value = null
  previewCode.value = ''
  compileError.value = ''
  if (currentStep.value < 4) documentCodeNeedsRegeneration.value = true
}

function updateDocumentCode(value) {
  documentCode.value = value
  documentCodeNeedsRegeneration.value = false
  previewBlob.value = null
  previewCode.value = ''
  compileError.value = ''
}

function activeDocumentCode() {
  return currentStep.value === 4 && documentCode.value.trim()
    ? documentCode.value
    : generatedCode()
}

function revokePreview() {
  if (previewUrl.value.startsWith('blob:')) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewBlob.value = null
  previewCode.value = ''
}

function resetFields() {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key])
  selectedMetadata.value.fields.forEach((field) => { fieldValues[field.key] = '' })
}

function selectTemplate(template) {
  if (selectedTemplateKey.value === template.key) return
  selectedTemplateKey.value = template.key
  resetFields()
  documentCurriculum.value = emptyCurriculum()
  exerciseQueue.value = []
  optionalRequiredCount.value = 1
  Object.keys(selectedVersions).forEach((key) => delete selectedVersions[key])
  invalidatePreview()
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
  const courseField = selectedMetadata.value.fields.find((field) => field.type === 'course' || field.key === 'course')
  const subjectField = selectedMetadata.value.fields.find((field) => field.type === 'subject' || field.key === 'subject')
  const course = matchCourse(courseField ? fieldValues[courseField.key] : '')
  const subject = matchSubject(subjectField ? fieldValues[subjectField.key] : '', course)
  const currentSubject = mathSubjects.find((item) => item.id === documentCurriculum.value.subjectId)
  documentCurriculum.value = {
    ...documentCurriculum.value,
    course,
    subjectId: subject?.id || (currentSubject?.course === course ? currentSubject.id : null),
    conceptIds: subject?.id === documentCurriculum.value.subjectId ? documentCurriculum.value.conceptIds : [],
  }
  invalidatePreview()
}

function onFieldInput() {
  syncCurriculumFromFields()
  invalidatePreview()
}

function resetWorkflow() {
  selectedDocumentId.value = null
  createdAt.value = null
  selectedTemplateKey.value = ''
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key])
  documentCurriculum.value = emptyCurriculum()
  exerciseQuery.value = ''
  exerciseQueue.value = []
  optionalRequiredCount.value = 1
  Object.keys(selectedVersions).forEach((key) => delete selectedVersions[key])
  currentStep.value = 1
  maxVisitedStep.value = 1
  compileError.value = ''
  documentCode.value = ''
  documentCodeNeedsRegeneration.value = true
  showDocumentCode.value = false
  viewedDocument.value = null
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

function viewDocument(documentData) {
  if (!documentData?.pdf?.url) return
  resetWorkflow()
  viewedDocument.value = documentData
  previewUrl.value = documentData.pdf.url
  mode.value = 'viewer'
}

function setOptionalRequiredCount(value) {
  optionalRequiredCount.value = value
  invalidatePreview()
}

function previousStep() {
  if (currentStep.value > 1) currentStep.value -= 1
}

async function nextStep() {
  if (!canContinue.value || currentStep.value >= 4) return
  currentStep.value += 1
  maxVisitedStep.value = Math.max(maxVisitedStep.value, currentStep.value)
  if (currentStep.value === 4) {
    if (documentCodeNeedsRegeneration.value || !documentCode.value.trim()) documentCode.value = generatedCode()
    documentCodeNeedsRegeneration.value = false
    await compileDocument()
  }
}

function goToVisitedStep(step) {
  if (step <= maxVisitedStep.value && step <= currentStep.value) currentStep.value = step
}

async function compilerRequest(path, options = {}) {
  const response = await fetch(`${props.compilerBaseUrl}${path}`, options)
  if (response.ok) return response
  let details = {}
  try { details = await response.json() } catch { /* La API puede devolver texto. */ }
  throw new Error(details.log || details.message || `Error del compilador (${response.status})`)
}

async function compileDocument() {
  if (!selectedTemplate.value || isCompiling.value) return
  const code = activeDocumentCode()
  if (previewBlob.value && previewUrl.value && previewCode.value === code) return
  isCompiling.value = true
  emit('busy-change', true)
  compileError.value = ''
  try {
    const response = await compilerRequest('/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: bodyForCompiler(code), preamble_name: selectedTemplate.value.archivo }),
    })
    const blob = await response.blob()
    revokePreview()
    previewBlob.value = blob
    previewCode.value = code
    previewUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    compileError.value = error.message || 'No se ha podido compilar el documento.'
  } finally {
    isCompiling.value = false
    emit('busy-change', false)
  }
}

function documentCardTitle(documentData) {
  const values = documentData.campos || {}
  return values.title || values.subject || documentData.plantilla?.nombre || 'Documento sin título'
}

function documentFieldEntries(documentData) {
  const metadata = documentTemplates.value.find((template) => template.archivo === documentData.plantilla?.archivo)?.metadata || defaultMetadata
  return metadata.fields.map((field) => ({ label: field.label, value: documentData.campos?.[field.key] || '—' }))
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
  const template = documentTemplates.value.find((item) => item.archivo === documentData.plantilla?.archivo)
    || documentTemplates.value.find((item) => item.nombre === documentData.plantilla?.nombre)
  if (!template) {
    documentsError.value = 'La plantilla utilizada por este documento ya no está disponible.'
    return
  }
  selectedDocumentId.value = documentData.id
  createdAt.value = documentData.createdAt || null
  selectedTemplateKey.value = template.key
  resetFields()
  Object.assign(fieldValues, documentData.campos || {})
  documentCurriculum.value = { ...emptyCurriculum(), ...(documentData.curriculum || {}) }
  exerciseQueue.value = Array.isArray(documentData.ejercicios)
    ? documentData.ejercicios.filter((item) => item?.exerciseId).map((item) => ({
        exerciseId: item.exerciseId,
        version: Number(item.version) || 0,
        section: item.section === 'optional' ? 'optional' : 'required',
      }))
    : []
  optionalRequiredCount.value = Number(documentData.optativos?.elegir) || 1
  normalizeQueueSections()
  exerciseQueue.value.forEach((item) => { selectedVersions[item.exerciseId] = item.version })
  previewUrl.value = documentData.pdf?.url || ''
  previewCode.value = documentData.codigo || ''
  documentCode.value = documentData.codigo || generatedCode()
  documentCodeNeedsRegeneration.value = false
  showDocumentCode.value = false
  currentStep.value = 1
  maxVisitedStep.value = 4
  mode.value = 'editor'
}

async function saveDocument() {
  if (currentStep.value !== 4 || isSaving.value) return
  if (!previewBlob.value || previewCode.value !== activeDocumentCode()) await compileDocument()
  if (!previewBlob.value) return
  isSaving.value = true
  emit('busy-change', true)
  documentsError.value = ''
  try {
    const reference = selectedDocumentId.value
      ? doc(db, 'documentos', selectedDocumentId.value)
      : doc(collection(db, 'documentos'))
    const path = `documentos/${reference.id}/documento_${reference.id}.pdf`
    await uploadBytes(storageRef(storage, path), previewBlob.value, {
      contentType: 'application/pdf',
      customMetadata: { documentId: reference.id },
    })
    const url = await getDownloadURL(storageRef(storage, path))
    const now = new Date().toISOString()
    const data = {
      plantilla: {
        archivo: selectedTemplate.value.archivo,
        nombre: selectedTemplate.value.metadata.name || selectedTemplate.value.nombre,
      },
      campos: Object.fromEntries(selectedMetadata.value.fields.map((field) => [field.key, String(fieldValues[field.key] || '').trim()])),
      curriculum: {
        course: documentCurriculum.value.course || null,
        subjectId: documentCurriculum.value.subjectId || null,
        conceptIds: [...new Set(documentCurriculum.value.conceptIds || [])],
        competencial: Boolean(documentCurriculum.value.competencial),
      },
      ejercicios: exerciseQueue.value.map((item, order) => ({ ...item, order })),
      optativos: {
        disponibles: optionalExercises.value.length,
        elegir: optionalExercises.value.length ? optionalRequiredCount.value : 0,
      },
      codigo: activeDocumentCode(),
      pdf: { url, path },
      createdAt: createdAt.value || now,
      updatedAt: now,
    }
    await setDoc(reference, data)
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
  compile: compileDocument,
  save: saveDocument,
})
</script>

<template>
  <div class="document-creator">
    <section v-if="mode === 'library'" class="document-library">
      <v-alert v-if="documentsError" type="error" variant="tonal" density="compact" class="document-library-error">{{ documentsError }}</v-alert>
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
      <DocumentPdfPreview :src="previewUrl" :title="documentCardTitle(viewedDocument || {})" />
    </section>

    <section v-else class="document-workflow">
      <ol class="document-stepper" aria-label="Proceso de creación del documento">
        <li v-for="step in steps" :key="step.number" :class="{ active: currentStep === step.number, complete: currentStep > step.number }">
          <button type="button" :disabled="step.number > currentStep" @click="goToVisitedStep(step.number)">
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
              <span>Crea o edita una desde «Plantillas» y añade las instrucciones <code>neope:document</code> y <code>neope:field</code>.</span>
            </div>
            <button
              v-for="template in documentTemplates"
              :key="template.key"
              type="button"
              class="document-template-card"
              :class="{ selected: selectedTemplateKey === template.key }"
              @click="selectTemplate(template)"
            >
              <v-icon icon="mdi-file-document-outline" size="30" />
              <strong>{{ template.metadata.name || template.nombre }}</strong>
              <span>{{ template.descripcion || 'Sin descripción' }}</span>
              <v-icon v-if="selectedTemplateKey === template.key" class="document-template-selected" icon="mdi-check-circle" size="22" />
            </button>
          </div>
          <aside class="document-fields-pane" :class="{ empty: !selectedTemplate }">
            <template v-if="selectedTemplate">
              <div class="document-fields-heading">
                <v-icon icon="mdi-form-textbox" size="22" />
                <div><strong>Datos del documento</strong><span>Completa todos los campos para continuar.</span></div>
              </div>
              <v-text-field
                v-for="field in selectedMetadata.fields"
                :key="field.key"
                v-model="fieldValues[field.key]"
                :label="field.label"
                :placeholder="field.placeholder"
                variant="outlined"
                density="comfortable"
                hide-details
                @update:model-value="onFieldInput"
              />
            </template>
            <template v-else>
              <v-icon icon="mdi-arrow-left" size="30" />
              <span>Selecciona una plantilla para configurar sus campos.</span>
            </template>
          </aside>
        </div>

        <ExerciseCurriculumPicker
          v-else-if="currentStep === 2"
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
                    <header>
                      <span>{{ subjectLabel(exercise) }}</span>
                      <div class="document-exercise-add-actions">
                        <v-tooltip text="Añadir como obligatorio" location="top">
                          <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" icon="mdi-lock-outline" size="x-small" color="primary" variant="tonal" aria-label="Añadir como obligatorio" @click="addExercise(exercise, 'required')" /></template>
                        </v-tooltip>
                        <v-tooltip text="Añadir como optativo" location="top">
                          <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" icon="mdi-source-branch" size="x-small" color="secondary" variant="tonal" aria-label="Añadir como optativo" @click="addExercise(exercise, 'optional')" /></template>
                        </v-tooltip>
                      </div>
                    </header>
                    <ExerciseVariantSelector
                      :model-value="selectedVersionFor(exercise)"
                      :variations="exercise.variaciones || []"
                      compact
                      @update:model-value="setSelectedVersion(exercise, $event)"
                    />
                    <div class="document-exercise-card-pdf">
                      <ExercisePdfPreview v-if="activePdf(exercise)" :src="activePdf(exercise)" :title="`Vista previa del ejercicio ${exercise.id}`" />
                      <div v-else class="document-exercise-no-pdf"><v-icon icon="mdi-file-pdf-box" size="32" /><span>PDF pendiente</span></div>
                    </div>
                    <footer>{{ conceptLabel(exercise) }}</footer>
                  </article>
                </template>
              </MasonryGrid>
            </div>
            <div v-else class="document-exercises-empty"><v-icon icon="mdi-file-search-outline" size="42" /><span>No hay ejercicios coincidentes.</span></div>
          </section>

          <section class="document-queue-pane">
            <div class="document-queue-section document-required-section" @dragover.prevent @drop="dropOnQueueSection($event, 'required')">
              <header class="document-queue-heading">
                <div><strong>Ejercicios obligatorios</strong><span>Todos deberán resolverse.</span></div>
                <v-chip size="small" color="primary" variant="tonal">{{ requiredExercises.length }}</v-chip>
              </header>
              <div v-if="requiredExercises.length" class="document-queue-grid">
                <article
                  v-for="(item, index) in requiredExercises"
                  :key="item.exerciseId"
                  class="document-queue-card"
                  draggable="true"
                  @dragstart="startQueueDrag($event, item)"
                  @dragover.prevent
                  @drop.stop="dropOnQueueSection($event, 'required', item.exerciseId)"
                >
                  <header>
                    <span class="document-queue-order">{{ index + 1 }}</span>
                    <strong>{{ subjectLabel(exerciseForQueue(item)) }}</strong>
                    <v-spacer />
                    <v-tooltip text="Mover a optativos" location="top">
                      <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" icon="mdi-arrow-down" size="x-small" variant="text" color="secondary" aria-label="Mover a optativos" @click="moveQueuedExercise(item, 'optional')" /></template>
                    </v-tooltip>
                    <v-btn icon="mdi-close" size="x-small" variant="text" color="error" aria-label="Quitar ejercicio" @click="removeQueuedExercise(item.exerciseId)" />
                  </header>
                  <ExerciseVariantSelector
                    :model-value="item.version"
                    :variations="exerciseForQueue(item)?.variaciones || []"
                    compact
                    @update:model-value="setSelectedVersion(exerciseForQueue(item), $event)"
                  />
                  <div class="document-queue-card-pdf">
                    <ExercisePdfPreview v-if="queueExercisePdf(item)" :src="queueExercisePdf(item)" :title="`Ejercicio obligatorio ${index + 1}`" />
                    <div v-else class="document-exercise-no-pdf"><v-icon icon="mdi-file-pdf-box" size="30" /><span>PDF pendiente</span></div>
                  </div>
                  <footer>{{ conceptLabel(exerciseForQueue(item)) }}</footer>
                </article>
              </div>
              <div v-else class="document-queue-empty compact"><v-icon icon="mdi-tray-arrow-down" size="36" /><span>Suelta aquí los ejercicios obligatorios.</span></div>
            </div>

            <div class="document-optional-divider">
              <div><strong>Ejercicios optativos</strong><span v-if="optionalExercises.length">Elegir</span></div>
              <div
                v-if="optionalChoiceOptions.length"
                class="document-optional-count"
                aria-label="Número de ejercicios optativos que deben elegirse"
                role="group"
              >
                <button
                  v-for="option in optionalChoiceOptions"
                  :key="option"
                  type="button"
                  :class="{ selected: optionalRequiredCount === option }"
                  :aria-pressed="optionalRequiredCount === option"
                  @click="setOptionalRequiredCount(option)"
                >{{ option }}</button>
              </div>
              <span v-else-if="optionalExercises.length === 1" class="document-optional-single">1 de 1</span>
              <span v-else class="document-optional-empty-label">Ninguno</span>
              <v-chip size="small" color="secondary" variant="tonal">{{ optionalExercises.length }}</v-chip>
            </div>

            <div class="document-queue-section document-optional-section" @dragover.prevent @drop="dropOnQueueSection($event, 'optional')">
              <div v-if="optionalExercises.length" class="document-queue-grid">
                <article
                  v-for="(item, index) in optionalExercises"
                  :key="item.exerciseId"
                  class="document-queue-card"
                  draggable="true"
                  @dragstart="startQueueDrag($event, item)"
                  @dragover.prevent
                  @drop.stop="dropOnQueueSection($event, 'optional', item.exerciseId)"
                >
                  <header>
                    <span class="document-queue-order optional">{{ index + 1 }}</span>
                    <strong>{{ subjectLabel(exerciseForQueue(item)) }}</strong>
                    <v-spacer />
                    <v-tooltip text="Mover a obligatorios" location="top">
                      <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" icon="mdi-arrow-up" size="x-small" variant="text" color="primary" aria-label="Mover a obligatorios" @click="moveQueuedExercise(item, 'required')" /></template>
                    </v-tooltip>
                    <v-btn icon="mdi-close" size="x-small" variant="text" color="error" aria-label="Quitar ejercicio" @click="removeQueuedExercise(item.exerciseId)" />
                  </header>
                  <ExerciseVariantSelector
                    :model-value="item.version"
                    :variations="exerciseForQueue(item)?.variaciones || []"
                    compact
                    @update:model-value="setSelectedVersion(exerciseForQueue(item), $event)"
                  />
                  <div class="document-queue-card-pdf">
                    <ExercisePdfPreview v-if="queueExercisePdf(item)" :src="queueExercisePdf(item)" :title="`Ejercicio optativo ${index + 1}`" />
                    <div v-else class="document-exercise-no-pdf"><v-icon icon="mdi-file-pdf-box" size="30" /><span>PDF pendiente</span></div>
                  </div>
                  <footer>{{ conceptLabel(exerciseForQueue(item)) }}</footer>
                </article>
              </div>
              <div v-else class="document-queue-empty compact"><v-icon icon="mdi-source-branch" size="36" /><span>Suelta aquí al menos dos ejercicios optativos.</span></div>
            </div>
          </section>
        </div>

        <div v-else class="document-preview-step" :class="{ 'document-preview-with-code': showDocumentCode }">
          <div class="document-preview-display-toolbar">
            <v-btn
              :prepend-icon="showDocumentCode ? 'mdi-code-tags-check' : 'mdi-code-tags'"
              size="small"
              rounded="pill"
              :color="showDocumentCode ? 'primary' : undefined"
              :variant="showDocumentCode ? 'tonal' : 'text'"
              :aria-pressed="showDocumentCode"
              @click="showDocumentCode = !showDocumentCode"
            >{{ showDocumentCode ? 'Ocultar código' : 'Mostrar código' }}</v-btn>
          </div>
          <v-alert v-if="compileError" type="error" variant="tonal" density="compact" class="document-compile-error">{{ compileError }}</v-alert>
          <div class="document-preview-layout">
            <DocumentCodeEditor
              v-if="showDocumentCode"
              :model-value="documentCode"
              :compiling="isCompiling"
              @update:model-value="updateDocumentCode"
              @compile="compileDocument"
            />
            <DocumentPdfPreview :src="previewUrl" />
          </div>
        </div>
      </div>
    </section>
  </div>
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

.document-workflow { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-rows: 76px minmax(0, 1fr); overflow: hidden; }
.document-stepper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 0 8%; border-bottom: 1px solid #d7e1ed; background: #fff; list-style: none; }
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

.document-template-step { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); overflow: hidden; }
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
.document-fields-pane { display: flex; min-height: 0; align-items: stretch; justify-content: flex-start; flex-direction: column; gap: 12px; padding: 18px; border-left: 1px solid #d8e2ed; overflow: auto; background: #fff; }
.document-fields-pane :deep(.v-input) { flex: 0 0 auto; }
.document-fields-pane.empty { align-items: center; justify-content: center; color: #7d8fa5; text-align: center; font-size: .78rem; }
.document-fields-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; color: #315981; }
.document-fields-heading div { display: flex; flex-direction: column; }
.document-fields-heading span { color: #7e8fa4; font-size: .69rem; }

.document-curriculum-step { width: 100%; height: 100%; }
.document-exercise-step { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); overflow: hidden; }
.document-matches-pane { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; border-right: 1px solid #d8e2ed; }
.document-exercise-toolbar { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-bottom: 1px solid #dbe4ef; background: #fff; }
.document-exercise-toolbar .v-text-field { flex: 1; }
.document-exercise-toolbar > span { color: #74879e; font-size: .7rem; font-weight: 700; white-space: nowrap; }
.document-matches-scroll { flex: 1 1 auto; min-height: 0; padding: 9px; overflow: auto; }
.document-matches-grid { width: 100%; }
.document-exercise-card { width: 100%; min-width: 0; overflow: hidden; border: 1px solid #d3deeb; border-radius: 13px; background: #fff; box-shadow: 0 2px 8px rgba(27, 56, 91, .07); cursor: grab; }
.document-exercise-card:active { cursor: grabbing; }
.document-exercise-card > header { display: flex; min-height: 36px; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 8px 5px 10px; background: #eaf1fa; color: #3b5779; font-size: .68rem; font-weight: 800; }
.document-exercise-add-actions { display: flex; align-items: center; gap: 5px; }
.document-exercise-card-pdf { overflow: hidden; background: #fff; }
.document-exercise-card-pdf :deep(.exercise-pdf-preview) { min-height: 155px; }
.document-exercise-card-pdf :deep(.exercise-pdf-preview.exercise-pdf-preview-loaded) { min-height: 0; }
.document-exercise-no-pdf { display: flex; min-height: 155px; align-items: center; justify-content: center; flex-direction: column; color: #7d8da2; font-size: .72rem; }
.document-exercise-card > footer { padding: 7px 9px; color: #5a6f8a; font-size: .67rem; line-height: 1.35; }
.document-exercises-empty { display: flex; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: 9px; color: #73859c; }
.document-queue-pane { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow-x: hidden; overflow-y: auto; background: #f4f7fb; }
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
.document-queue-card-pdf { overflow: hidden; background: #fff; }
.document-queue-card-pdf :deep(.exercise-pdf-preview) { min-height: 135px; }
.document-queue-card-pdf :deep(.exercise-pdf-preview.exercise-pdf-preview-loaded) { min-height: 0; }
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

.document-preview-step { position: relative; display: grid; width: 100%; height: 100%; min-height: 0; grid-template-rows: 43px minmax(0, 1fr); overflow: hidden; }
.document-preview-display-toolbar { display: flex; align-items: center; justify-content: flex-end; padding: 5px 10px; border-bottom: 1px solid #d7e1ed; background: #fff; }
.document-preview-layout { min-width: 0; min-height: 0; overflow: hidden; }
.document-preview-with-code .document-preview-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); }
.document-preview-with-code .document-pdf-preview { border-left: 1px solid #cbd7e5; }
.document-compile-error { position: absolute; z-index: 4; top: 53px; right: 12px; left: 12px; max-height: 38%; overflow: auto; }

@media (max-width: 900px) {
  .document-stepper { padding-inline: 2%; }
  .document-template-step { grid-template-columns: minmax(0, 3fr) minmax(260px, 2fr); }
  .document-exercise-step { grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); }
}
</style>
