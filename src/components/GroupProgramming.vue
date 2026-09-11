<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { auth } from '../services/firebase'
import { loadRubrics } from '../services/rubricRepository'
import {
  addRubricToProgrammingDay,
  deleteProgrammingContentFiles,
  removeDocumentFromProgramming,
  removeRubricFromProgrammingDay,
  deleteProgrammingResource,
  loadAndSynchronizeProgrammingDays,
  loadProgrammingDocuments,
  programmingDocumentDate,
  saveProgrammingDay,
  uploadProgrammingContentPdf,
  uploadProgrammingContentSource,
  uploadProgrammingResource,
} from '../services/programmingRepository'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import { normalizeDisplayMathDelimiters } from '../utils/latexNormalization'
import ProgrammingLatexContent from './ProgrammingLatexContent.vue'

const props = defineProps({
  group: { type: Object, required: true },
  calendar: { type: Object, default: () => ({ types: [], days: {} }) },
  teacherId: { type: String, required: true },
  templates: { type: Array, default: () => [] },
  compilerBaseUrl: { type: String, default: '/compiler-api/v1' },
})

const emit = defineEmits(['new-document', 'assessment-removed'])
const days = ref([])
const documents = ref([])
const rubrics = ref([])
const loading = ref(false)
const editingDates = ref(new Set())
const noteEditorDates = ref(new Set())
const savingDates = ref(new Set())
const dayElements = new Map()
const rubricDialog = ref(false)
const rubricDay = ref(null)
const linkDialog = ref(false)
const linkDay = ref(null)
const linkForm = ref({ title: '', url: '' })
const fileInput = ref(null)
const fileDay = ref(null)
const deleteDialog = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const compilingContentIds = ref(new Set())

const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, '')
const eligibleRubrics = computed(() => rubrics.value.filter((rubric) => {
  const courseMatches = !rubric.course || normalized(rubric.course) === normalized(props.group.curso)
  const subjectMatches = rubric.subjectId && props.group.subjectId
    ? rubric.subjectId === props.group.subjectId
    : !rubric.subjectTitle || normalized(rubric.subjectTitle) === normalized(props.group.asignatura)
  return courseMatches && subjectMatches
}))
const hasProgrammingSchedule = computed(() => (props.group.horario || []).some((segment) => (
  Number.isInteger(Number(segment?.dia)) && Number(segment.dia) >= 0 && Number(segment.dia) <= 4
)))

function documentBelongsToDay(documentData, day) {
  if (programmingDocumentDate(documentData) !== day.date) return false
  const programming = documentData.programming || {}
  if (programming.programmingDayId) return programming.programmingDayId === day.id
    || (programming.sessionKey && programming.sessionKey === day.sessionKey)
  if (programming.sessionKey) return programming.sessionKey === day.sessionKey
  return Boolean(day.primaryForDate)
}

const documentsByDay = computed(() => {
  const result = new Map()
  days.value.forEach((day) => {
    result.set(day.id, documents.value.filter((documentData) => documentBelongsToDay(documentData, day)))
  })
  return result
})

function dateLabel(date) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${date}T12:00:00`))
    .replace(/^./, (letter) => letter.toLocaleUpperCase('es'))
}

function readableTextColor(backgroundColor) {
  const hex = String(backgroundColor || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/iu.test(hex)) return '#294f7d'
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
  return ((red * 299) + (green * 587) + (blue * 114)) / 1000 < 145 ? '#fff' : '#294f7d'
}

function dayHeaderStyle(day) {
  if (!day.color) return undefined
  return { backgroundColor: day.color, color: readableTextColor(day.color) }
}

function documentTitle(documentData) {
  return documentData.campos?.title || documentData.campos?.titulo || documentData.assessment?.shortName || documentData.plantilla?.nombre || 'Documento'
}

function registerDayElement(dayId, element) {
  if (element) dayElements.set(dayId, element)
  else dayElements.delete(dayId)
}

async function load() {
  if (!props.group?.id || !props.teacherId) return
  loading.value = true
  try {
    const [loadedDays, loadedDocuments, loadedRubrics] = await Promise.all([
      loadAndSynchronizeProgrammingDays({ group: props.group, calendar: props.calendar, teacherId: props.teacherId }),
      loadProgrammingDocuments(props.group.id),
      loadRubrics(props.teacherId),
    ])
    days.value = loadedDays
    documents.value = loadedDocuments
    rubrics.value = loadedRubrics
    await nextTick()
    const today = new Date()
    const current = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const target = loadedDays.find((day) => day.date >= current) || loadedDays.at(-1)
    dayElements.get(target?.id)?.scrollIntoView?.({ block: 'center', behavior: 'instant' })
  } catch (error) {
    console.error('No se ha podido cargar la programación:', error)
    showAppErrorToast(error.message || 'No se ha podido cargar la programación del grupo.')
  } finally {
    loading.value = false
  }
}

function isEditing(dayId) {
  return editingDates.value.has(dayId)
}

function setSaving(date, value) {
  const next = new Set(savingDates.value)
  if (value) next.add(date)
  else next.delete(date)
  savingDates.value = next
}

async function persist(day) {
  setSaving(day.id, true)
  try {
    for (const content of day.contents || []) {
      if (!content?.id || !String(content.code || '').trim()) continue
      content.source = await uploadProgrammingContentSource({
        teacherId: props.teacherId,
        groupId: props.group.id,
        date: day.date,
        content,
      })
    }
    await saveProgrammingDay(props.group.id, day, props.teacherId)
  } catch (error) {
    showAppErrorToast(error.message || 'No se han podido guardar los cambios de este día.')
    throw error
  } finally {
    setSaving(day.id, false)
  }
}

async function toggleEditing(day) {
  if (isEditing(day.id)) {
    try { await persist(day) } catch { return }
  }
  const next = new Set(editingDates.value)
  if (next.has(day.id)) {
    next.delete(day.id)
    const noteEditors = new Set(noteEditorDates.value)
    noteEditors.delete(day.id)
    noteEditorDates.value = noteEditors
  } else {
    next.add(day.id)
    if (day.notes) {
      const noteEditors = new Set(noteEditorDates.value)
      noteEditors.add(day.id)
      noteEditorDates.value = noteEditors
    }
  }
  editingDates.value = next
}

function openNoteEditor(day) {
  const next = new Set(noteEditorDates.value)
  next.add(day.id)
  noteEditorDates.value = next
  nextTick(() => dayElements.get(day.id)?.querySelector?.('textarea')?.focus?.())
}

function openRubrics(day) {
  rubricDay.value = day
  rubricDialog.value = true
}

async function addRubric(rubric) {
  if (!rubricDay.value) return
  const day = rubricDay.value
  try {
    const result = await addRubricToProgrammingDay({
      groupId: props.group.id,
      date: day.date,
      programmingDayId: day.id,
      session: day,
      rubric,
      teacherId: props.teacherId,
    })
    day.rubricInstruments.push(result.instrument)
    rubricDialog.value = false
  } catch (error) {
    showAppErrorToast(error.message || 'No se ha podido añadir la rúbrica.')
  }
}

function openLink(day) {
  linkDay.value = day
  linkForm.value = { title: '', url: '' }
  linkDialog.value = true
}

async function saveLink() {
  const day = linkDay.value
  if (!day || !linkForm.value.url.trim()) return
  let url = linkForm.value.url.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  day.resources.push({
    id: globalThis.crypto?.randomUUID?.() || `enlace-${Date.now()}`,
    type: 'link',
    title: linkForm.value.title.trim() || url,
    url,
  })
  try {
    await persist(day)
    linkDialog.value = false
  } catch {
    day.resources.pop()
  }
}

function chooseFile(day) {
  fileDay.value = day
  fileInput.value?.click()
}

async function receiveFile(event) {
  const file = event.target.files?.[0]
  const day = fileDay.value
  event.target.value = ''
  if (!file || !day) return
  setSaving(day.id, true)
  try {
    const resource = await uploadProgrammingResource({
      teacherId: props.teacherId,
      groupId: props.group.id,
      date: day.date,
      file,
      existingResources: day.resources,
    })
    day.resources.push(resource)
    await saveProgrammingDay(props.group.id, day, props.teacherId)
  } catch (error) {
    showAppErrorToast(error.message || 'No se ha podido subir el archivo.')
  } finally {
    setSaving(day.id, false)
  }
}

function addContent(day) {
  const template = props.templates.find((item) => item.archivo) || null
  day.contents ||= []
  day.contents.push({
    id: globalThis.crypto?.randomUUID?.() || `contenido-${Date.now()}`,
    type: 'latex',
    code: '',
    templateFile: template?.archivo || '',
    templateName: template?.nombre || '',
    codeVisible: true,
    source: null,
    pdf: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
}

function setContentValue(content, field, value) {
  content[field] = value
  content.updatedAt = new Date().toISOString()
  if (field === 'templateFile') {
    content.templateName = props.templates.find((template) => template.archivo === value)?.nombre || ''
  }
}

function setContentCompiling(contentId, value) {
  const next = new Set(compilingContentIds.value)
  if (value) next.add(contentId)
  else next.delete(contentId)
  compilingContentIds.value = next
}

function programmingContentAssets(day) {
  const result = {}
  ;(day.resources || [])
    .filter((resource) => resource.type === 'file' && resource.url && String(resource.contentType || '').startsWith('image/'))
    .forEach((resource, index) => {
      const fallbackExtension = String(resource.title || '').match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase() || '.png'
      const name = resource.compilerName || `imagen${index + 1}${fallbackExtension}`
      result[name] = { url: resource.url }
    })
  return result
}

function programmingContentBody(source) {
  const value = String(source || '')
  const documentMatch = value.match(/\\begin\s*\{document\}([\s\S]*?)\\end\s*\{document\}/)
  return normalizeDisplayMathDelimiters(
    (documentMatch?.[1] || value).replace(/^\s*\\input\s*\{[^}]+\}\s*/m, '').trim(),
  )
}

async function compilerRequest(path, options = {}) {
  const token = await auth.currentUser?.getIdToken()
  let response
  try {
    response = await fetch(`${props.compilerBaseUrl}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
  } catch (error) {
    throw new Error(`No se ha podido conectar con el compilador LaTeX: ${error?.message || 'error de red'}`)
  }
  if (response.ok) return response
  let details = {}
  try { details = await response.json() } catch { /* La API puede devolver texto. */ }
  throw new Error(details.log || details.message || `Error del compilador (${response.status})`)
}

async function compileContent(day, content) {
  if (!content?.id || compilingContentIds.value.has(content.id)) return
  const template = props.templates.find((item) => item.archivo === content.templateFile)
  if (!template) {
    showAppErrorToast('Selecciona una plantilla antes de compilar el contenido.')
    return
  }
  const code = programmingContentBody(content.code)
  if (!code) return
  setContentCompiling(content.id, true)
  try {
    await compilerRequest('/preambles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: template.archivo, content: template.codigo }),
    })
    const response = await compilerRequest('/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        preamble_name: template.archivo,
        assets: programmingContentAssets(day),
      }),
    })
    const blob = await response.blob()
    content.pdf = await uploadProgrammingContentPdf({
      teacherId: props.teacherId,
      groupId: props.group.id,
      date: day.date,
      contentId: content.id,
      blob,
      previousPdf: content.pdf,
    })
    content.templateName = template.nombre
    content.updatedAt = new Date().toISOString()
    await persist(day)
  } catch (error) {
    showAppErrorToast(`${error.message || 'No se ha podido compilar el contenido.'}\n\nLaTeX enviado al compilador:\n\n${code}`)
  } finally {
    setContentCompiling(content.id, false)
  }
}

async function removeContent(day, content) {
  const index = (day.contents || []).findIndex((item) => item.id === content.id)
  if (index < 0) return
  day.contents.splice(index, 1)
  try {
    await saveProgrammingDay(props.group.id, day, props.teacherId)
    await deleteProgrammingContentFiles(content)
  } catch (error) {
    day.contents.splice(index, 0, content)
    showAppErrorToast(error.message || 'No se ha podido eliminar el contenido.')
  }
}

async function removeResource(day, resource) {
  const previous = [...day.resources]
  day.resources = day.resources.filter((item) => item.id !== resource.id)
  try {
    await persist(day)
    try {
      await deleteProgrammingResource(resource)
    } catch (error) {
      console.warn('El recurso se ha desvinculado, pero el archivo no se ha podido limpiar:', error)
    }
  } catch (error) {
    day.resources = previous
    showAppErrorToast(error.message || 'No se ha podido eliminar el recurso.')
  }
}

function requestInstrumentRemoval(day, type, value) {
  if (deleting.value) return
  deleteTarget.value = { day, type, value }
  deleteDialog.value = true
}

function closeInstrumentRemovalDialog() {
  deleteDialog.value = false
  deleteTarget.value = null
}

async function withRemovalTimeout(operation) {
  let timeoutId
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => reject(new Error('El servidor no ha respondido al retirar el elemento. Comprueba la conexión y vuelve a intentarlo.')), 15000)
      }),
    ])
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function confirmInstrumentRemoval() {
  const target = deleteTarget.value
  if (!target || deleting.value) return
  closeInstrumentRemovalDialog()
  deleting.value = true
  try {
    if (target.type === 'rubric') {
      const result = await withRemovalTimeout(removeRubricFromProgrammingDay({
        groupId: props.group.id,
        date: target.day.date,
        programmingDayId: target.day.id,
        instrument: target.value,
        evaluationStructure: props.group.evaluaciones?.estructura || [],
        dayRubricInstruments: target.day.rubricInstruments,
        studentIds: (props.group.alumnos || []).map((student) => student.id),
      }))
      target.day.rubricInstruments = target.day.rubricInstruments.filter((item) => item.id !== target.value.id)
      emit('assessment-removed', { groupId: props.group.id, itemIds: result.removedIds })
    } else {
      const result = await withRemovalTimeout(removeDocumentFromProgramming(target.value, {
        evaluationStructure: props.group.evaluaciones?.estructura || [],
        studentIds: (props.group.alumnos || []).map((student) => student.id),
      }))
      documents.value = documents.value.map((item) => item.id === target.value.id
        ? { ...item, programming: { hidden: true }, assessment: { ...(item.assessment || {}), evaluable: false, groupId: null, gradebookItemId: null } }
        : item)
      emit('assessment-removed', { groupId: result.groupId || props.group.id, itemIds: result.removedIds })
    }
  } catch (error) {
    showAppErrorToast(error.message || 'No se ha podido retirar la tarea de la programación.')
  } finally {
    deleting.value = false
  }
}

function removalTitle() {
  if (deleteTarget.value?.type === 'rubric') return deleteTarget.value.value?.title || 'Rúbrica'
  return documentTitle(deleteTarget.value?.value)
}

function removalDeletesAssessment() {
  return deleteTarget.value?.type === 'rubric' || Boolean(deleteTarget.value?.value?.assessment?.evaluable)
}

async function flush() {
  const pending = days.value.filter((day) => isEditing(day.id))
  await Promise.allSettled(pending.map((day) => persist(day)))
}

function saveNotes(day) {
  void persist(day).catch(() => {})
}

watch(() => [props.group.id, props.calendar], load, { deep: true })
onMounted(load)
onBeforeUnmount(() => {
  closeInstrumentRemovalDialog()
  rubricDialog.value = false
  linkDialog.value = false
})
defineExpose({ flush })
</script>

<template>
  <section class="group-programming">
    <input ref="fileInput" type="file" hidden @change="receiveFile">
    <div v-if="loading" class="programming-state"><v-progress-circular indeterminate color="primary" /><span>Preparando los días lectivos…</span></div>
    <div v-else-if="!days.length" class="programming-state">
      <v-icon icon="mdi-calendar-alert-outline" size="42" color="primary" />
      <strong>{{ hasProgrammingSchedule ? 'Falta delimitar el curso' : 'No hay clases ni tutorías en el horario' }}</strong>
      <span v-if="hasProgrammingSchedule">Asigna un inicio y un fin de curso a este grupo en el calendario escolar.</span>
      <span v-else>Configura al menos una clase o tutoría para este grupo en el horario semanal.</span>
    </div>
    <div v-else class="programming-days">
      <article
        v-for="day in days"
        :key="day.id"
        :ref="(element) => registerDayElement(day.id, element)"
        class="programming-day"
        :class="{ 'programming-day-editing': isEditing(day.id), 'programming-day-tutoring': day.sessionType === 'tutoring' }"
      >
        <header class="programming-day-header" :style="dayHeaderStyle(day)">
          <div class="programming-day-heading">
            <strong>{{ dateLabel(day.date) }}</strong>
            <span>{{ day.title }}</span>
          </div>
          <v-btn
            icon="mdi-cog-outline"
            size="small"
            rounded="circle"
            :loading="savingDates.has(day.id)"
            :color="isEditing(day.id) ? undefined : 'currentColor'"
            :variant="isEditing(day.id) ? 'flat' : 'text'"
            :aria-label="isEditing(day.id) ? 'Finalizar edición' : 'Configurar sesión'"
            @click="toggleEditing(day)"
          />
        </header>

        <div class="programming-day-body">
          <v-textarea
            v-if="isEditing(day.id) && noteEditorDates.has(day.id)"
            v-model="day.notes"
            label="Anotaciones"
            placeholder="Planificación, incidencias, recordatorios…"
            variant="outlined"
            density="compact"
            rows="2"
            auto-grow
            hide-details
            @blur="saveNotes(day)"
          />
          <p v-else-if="day.notes" class="programming-notes">{{ day.notes }}</p>

          <section v-if="day.contents?.length" class="programming-contents">
            <ProgrammingLatexContent
              v-for="content in day.contents"
              :key="content.id"
              :content="content"
              :templates="templates"
              :resources="day.resources"
              :editing="isEditing(day.id)"
              :compiling="compilingContentIds.has(content.id)"
              @update-code="setContentValue(content, 'code', $event)"
              @update-template="setContentValue(content, 'templateFile', $event)"
              @update-code-visible="setContentValue(content, 'codeVisible', $event)"
              @compile="compileContent(day, content)"
              @remove="removeContent(day, content)"
            />
          </section>

          <section v-if="documentsByDay.get(day.id)?.length || day.rubricInstruments.length" class="programming-instruments">
            <div
              v-for="documentData in documentsByDay.get(day.id) || []"
              :key="documentData.id"
              class="programming-chip programming-document"
            >
              <a :href="documentData.pdf?.url" target="_blank" rel="noopener noreferrer">
                <v-icon icon="mdi-file-document-outline" size="18" />
                <span>{{ documentTitle(documentData) }}</span>
                <small v-if="documentData.assessment?.evaluable">Evaluable</small>
              </a>
              <v-btn v-if="isEditing(day.id)" icon="mdi-close" size="x-small" rounded="circle" variant="text" color="error" aria-label="Retirar documento" @click="requestInstrumentRemoval(day, 'document', documentData)" />
            </div>
            <div v-for="instrument in day.rubricInstruments" :key="instrument.id" class="programming-chip programming-rubric">
              <v-icon icon="mdi-table-star" size="18" />
              <span>{{ instrument.title }}</span>
              <v-btn v-if="isEditing(day.id)" icon="mdi-close" size="x-small" rounded="circle" variant="text" color="error" aria-label="Eliminar rúbrica" @click="requestInstrumentRemoval(day, 'rubric', instrument)" />
            </div>
          </section>

          <section v-if="day.resources.length" class="programming-resources">
            <div v-for="resource in day.resources" :key="resource.id" class="programming-resource">
              <a :href="resource.url" target="_blank" rel="noopener noreferrer">
                <v-icon :icon="resource.type === 'file' ? 'mdi-paperclip' : 'mdi-link-variant'" size="17" />
                <span>{{ resource.title }}</span>
                <code v-if="resource.compilerName && String(resource.contentType || '').startsWith('image/')">{{ resource.compilerName }}</code>
              </a>
              <v-btn v-if="isEditing(day.id)" icon="mdi-close" size="x-small" rounded="circle" variant="text" color="error" aria-label="Eliminar recurso" @click="removeResource(day, resource)" />
            </div>
          </section>

          <footer v-if="isEditing(day.id)" class="programming-tools">
            <v-btn size="small" variant="text" prepend-icon="mdi-file-plus-outline" @click="emit('new-document', { date: day.date, programmingDayId: day.id, sessionKey: day.sessionKey, sessionType: day.sessionType, sessionTitle: day.title, sessionColor: day.color })">Documento</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-table-star" @click="openRubrics(day)">Rúbrica</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-note-edit-outline" @click="openNoteEditor(day)">Anotación</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-language-latex" @click="addContent(day)">Contenido</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-link-plus" @click="openLink(day)">Enlace</v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-paperclip" @click="chooseFile(day)">Archivo</v-btn>
          </footer>
        </div>
      </article>
    </div>

    <v-dialog v-model="rubricDialog" width="760">
      <v-card>
        <v-card-title>Seleccionar rúbrica</v-card-title>
        <v-card-text class="programming-rubric-list">
          <button v-for="rubric in eligibleRubrics" :key="rubric.id" type="button" @click="addRubric(rubric)">
            <strong>{{ rubric.shortName ? `${rubric.shortName} · ${rubric.title}` : rubric.title }}</strong><span>{{ rubric.course }} · {{ rubric.subjectTitle }}</span>
          </button>
          <p v-if="!eligibleRubrics.length">No hay rúbricas disponibles para este curso y asignatura.</p>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="rubricDialog = false">Cerrar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="linkDialog" width="560">
      <v-card>
        <v-card-title>Añadir enlace</v-card-title>
        <v-card-text class="programming-link-fields">
          <v-text-field v-model="linkForm.title" label="Título" variant="outlined" density="compact" hide-details />
          <v-text-field v-model="linkForm.url" label="Dirección" variant="outlined" density="compact" hide-details @keyup.enter="saveLink" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="linkDialog = false">Cancelar</v-btn><v-btn color="primary" variant="flat" :disabled="!linkForm.url.trim()" @click="saveLink">Añadir</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-if="deleteDialog && deleteTarget"
      :model-value="true"
      width="520"
      @update:model-value="(value) => { if (!value) closeInstrumentRemovalDialog() }"
    >
      <v-card>
        <v-card-title>Retirar elemento</v-card-title>
        <v-card-text>
          <template v-if="removalDeletesAssessment()">Se retirará «{{ removalTitle() }}» de este día y del cuaderno de evaluación. Las calificaciones que ya tuviera asociadas también se eliminarán.</template>
          <template v-else>Se retirará «{{ removalTitle() }}» de este día. El documento original seguirá disponible en Documentos.</template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeInstrumentRemovalDialog">Cancelar</v-btn>
          <v-btn color="error" variant="flat" @click="confirmInstrumentRemoval">Retirar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.group-programming { height: 100%; overflow: auto; background: #f4f7fb; }
.programming-days { width: min(1080px, 100%); margin: 0 auto; padding: 12px; display: grid; gap: 10px; }
.programming-day { background: #fff; border: 1px solid #d6e0ed; border-radius: 7px; overflow: hidden; box-shadow: 0 2px 7px rgb(28 66 111 / 5%); content-visibility: auto; contain-intrinsic-size: 150px; }
.programming-day-header { min-height: 42px; padding: 4px 8px 4px 14px; display: flex; align-items: center; justify-content: space-between; color: #294f7d; background: #e8f0fa; border-bottom: 1px solid rgb(23 52 82 / 18%); }
.programming-day-heading { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.programming-day-heading span { font-size: .76rem; font-weight: 700; opacity: .82; text-transform: uppercase; letter-spacing: .055em; }
.programming-day-editing .programming-day-header { box-shadow: inset 0 0 0 2px currentColor; }
.programming-day-body { padding: 12px; display: grid; gap: 10px; }
.programming-notes { margin: 0; white-space: pre-wrap; color: #344e6e; line-height: 1.5; }
.programming-contents { display: grid; gap: 10px; }
.programming-instruments, .programming-resources { display: flex; flex-wrap: wrap; gap: 7px; padding-top: 9px; border-top: 1px solid #e3e9f1; }
.programming-chip { min-height: 34px; padding: 3px 5px 3px 10px; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; text-decoration: none; color: #315f96; background: #edf3fb; border: 1px solid #d5e1f0; }
.programming-chip > a { display: inline-flex; align-items: center; gap: 7px; color: inherit; text-decoration: none; }
.programming-chip small { color: #7186a0; }
.programming-rubric { color: #6b4b18; background: #fff5dd; border-color: #ead9ab; }
.programming-resource { display: inline-flex; align-items: center; gap: 2px; border: 1px solid #dce4ee; border-radius: 6px; padding-left: 8px; }
.programming-resource a { display: inline-flex; align-items: center; gap: 5px; color: #3d5f86; text-decoration: none; }
.programming-resource code { padding: 1px 4px; border-radius: 3px; background: #e7eef7; color: #315f96; font-size: .7rem; }
.programming-tools { margin: 0 -12px -12px; padding: 5px 8px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px; background: #f7f9fc; border-top: 1px solid #dfe6ef; }
.programming-state { height: 100%; display: grid; place-content: center; justify-items: center; gap: 10px; color: #617793; text-align: center; padding: 24px; }
.programming-rubric-list { display: grid; gap: 8px; }
.programming-rubric-list button { padding: 12px; display: grid; gap: 3px; text-align: left; border: 1px solid #d5e1ef; border-radius: 7px; color: #315f96; background: #f5f8fc; }
.programming-rubric-list button:hover { background: #e9f1fb; }
.programming-rubric-list span { color: #71839a; font-size: .82rem; }
.programming-link-fields { display: grid; gap: 12px; }
@media (max-width: 700px) { .programming-days { padding: 5px; } .programming-day { border-radius: 3px; } .programming-tools { justify-content: flex-start; } }
</style>
