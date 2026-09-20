<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  identityRecoveryMessage,
  loadStudentIdentitiesForGroup,
  studentIdentityDiagnostics,
} from '../services/localStudentIdentity'
import {
  loadAndSynchronizeProgrammingDays,
  loadProgrammingDocuments,
  programmingDayForDate,
  programmingDocumentDate,
} from '../services/programmingRepository'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import StudentAssessmentDialog from './StudentAssessmentDialog.vue'

const props = defineProps({
  group: { type: Object, required: true },
  date: { type: String, default: '' },
  calendar: { type: Object, default: () => ({}) },
  teacherId: { type: String, default: '' },
  configurationMode: { type: Boolean, default: false },
})
const emit = defineEmits(['dirty-change', 'validity-change', 'autosave-request', 'student-selected'])

const localGroup = ref(JSON.parse(JSON.stringify(props.group)))
const localIdentities = ref(new Map())
const dragSource = ref(null)
const layoutDialog = ref(false)
const layoutDraft = ref({ rows: 4, cols: 5, aisles: [] })
const roomRef = ref(null)
const seatSize = ref(96)
const todayAssessments = ref([])
const assessmentsLoading = ref(false)
const selectedAssessmentId = ref(null)
const assessmentDialog = ref(false)
const assessmentStudent = ref(null)
let roomObserver
let assessmentLoadRequest = 0
let revision = 0
let persistedRevision = 0

const ATTENDANCE_MODE_ID = '__attendance__'

const students = computed(() => Array.isArray(localGroup.value.alumnos) ? localGroup.value.alumnos : [])
const layout = computed(() => ({ rows: 4, cols: 5, aisles: [], ...(localGroup.value.disposicion || {}) }))
const seatCount = computed(() => Number(layout.value.rows) * Number(layout.value.cols))
const seats = computed(() => Array.from({ length: seatCount.value }, (_, index) => layout.value.asientos?.[index] || null))
const assigned = computed(() => new Set(seats.value.filter(Boolean)))
const wellStudents = computed(() => students.value.filter((student) => !assigned.value.has(student.id)))
const aisleWidth = 48
const gridColumnsStyle = computed(() => Array.from({ length: Math.max(1, Number(layout.value.cols) || 1) }, (_, col) => {
  const extra = layout.value.aisles.includes(col) ? aisleWidth : 0
  return `${seatSize.value + extra}px`
}).join(' '))
const selectedAssessment = computed(() => todayAssessments.value.find((item) => item.id === selectedAssessmentId.value)
  || (meritsItem.value?.id === selectedAssessmentId.value ? meritsItem.value : null))
const meritsItem = computed(() => evaluationItems(localGroup.value.evaluaciones?.estructura || []).find((item) => item.merits) || null)
const attendanceMode = computed(() => selectedAssessmentId.value === ATTENDANCE_MODE_ID)
const hasAttendanceForSelectedDate = computed(() => Boolean(attendanceRecordForDate()))
const activeAssessmentResult = computed(() => {
  const studentId = assessmentStudent.value?.id
  const itemId = selectedAssessment.value?.id
  return studentId && itemId ? localGroup.value.evaluaciones?.resultados?.[studentId]?.[itemId] || null : null
})

function todayIso() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function evaluationItems(nodes = []) {
  return nodes.flatMap((node) => node?.type === 'group' ? evaluationItems(node.children || []) : (node?.type === 'item' ? [node] : []))
}

function documentTitle(documentData) {
  return documentData.campos?.title
    || documentData.campos?.titulo
    || documentData.assessment?.shortName
    || documentData.plantilla?.nombre
    || 'Documento evaluable'
}

function pendingRubricItem(instrument, date) {
  if (!instrument?.gradebookItemId || !instrument?.rubric) return null
  return {
    type: 'item',
    id: instrument.gradebookItemId,
    nombre: instrument.title || instrument.rubric.title || 'Rúbrica',
    nombreCorto: instrument.shortName || instrument.rubric.shortName || instrument.title || 'Rúbrica',
    rubric: instrument.rubric,
    programming: { date, instrumentId: instrument.id },
  }
}

function pendingDocumentItem(documentData, date) {
  const assessment = documentData?.assessment || {}
  if (!assessment.evaluable || !assessment.gradebookItemId) return null
  return {
    type: 'item',
    id: assessment.gradebookItemId,
    nombre: documentTitle(documentData),
    nombreCorto: assessment.shortName || documentTitle(documentData),
    programming: { groupId: props.group.id, date },
    documentAssessment: {
      documentId: documentData.id,
      maxPoints: Number(assessment.maxPoints) || 0,
      exercises: (documentData.ejercicios || [])
        .filter((entry) => entry?.exerciseId)
        .map((entry, order) => ({
          exerciseId: entry.exerciseId,
          version: Number(entry.version) || 0,
          order,
          ...(entry.blockId ? { blockId: entry.blockId } : {}),
        })),
    },
  }
}

async function loadTodayAssessments() {
  if (!localGroup.value.id) return
  const request = ++assessmentLoadRequest
  assessmentsLoading.value = true
  try {
    const date = props.date || todayIso()
    if (!date) {
      todayAssessments.value = []
      selectedAssessmentId.value = null
      return
    }
    const [programmingDays, groupDocuments] = await Promise.all([
      loadAndSynchronizeProgrammingDays({ group: localGroup.value, calendar: props.calendar, teacherId: props.teacherId }),
      loadProgrammingDocuments(localGroup.value.id),
    ])
    const day = programmingDayForDate(programmingDays, date)
    const programmingDayIds = new Set(day?.sessionIds || (day?.id ? [day.id] : []))
    const items = evaluationItems(localGroup.value.evaluaciones?.estructura || [])
    const itemsById = new Map(items.map((item) => [item.id, item]))
    const candidates = []
    ;(day?.rubricInstruments || []).forEach((instrument) => {
      const item = itemsById.get(instrument.gradebookItemId) || pendingRubricItem(instrument, date)
      if (item) candidates.push(item)
    })
    groupDocuments
      .filter((documentData) => {
        if (!documentData.assessment?.evaluable) return false
        const programmingDayId = documentData.programming?.programmingDayId
        return programmingDayId
          ? programmingDayIds.has(programmingDayId)
          : programmingDocumentDate(documentData) === date
      })
      .forEach((documentData) => {
        const item = itemsById.get(documentData.assessment?.gradebookItemId) || pendingDocumentItem(documentData, date)
        if (item) candidates.push(item)
      })
    items.forEach((item) => {
      if (item.programming?.date === date && !candidates.some((candidate) => candidate.id === item.id)) candidates.push(item)
    })
    if (request !== assessmentLoadRequest) return
    todayAssessments.value = candidates.filter((item, index) => (
      (item.rubric || item.documentAssessment)
      && candidates.findIndex((candidate) => candidate.id === item.id) === index
    ))
    if (selectedAssessmentId.value !== ATTENDANCE_MODE_ID
      && selectedAssessmentId.value !== meritsItem.value?.id
      && !todayAssessments.value.some((item) => item.id === selectedAssessmentId.value)) selectedAssessmentId.value = null
  } catch (error) {
    if (request !== assessmentLoadRequest) return
    console.error('No se han podido cargar las tareas del día:', error)
    showAppErrorToast(error.message || 'No se han podido cargar las tareas evaluables de hoy.')
  } finally {
    if (request === assessmentLoadRequest) assessmentsLoading.value = false
  }
}

function toggleAssessment(item) {
  selectedAssessmentId.value = selectedAssessmentId.value === item.id ? null : item.id
}

function toggleAttendance() {
  assessmentDialog.value = false
  assessmentStudent.value = null
  selectedAssessmentId.value = attendanceMode.value ? null : ATTENDANCE_MODE_ID
}

function attendanceDate() {
  return props.date || todayIso()
}

function attendanceRecordForDate(date = attendanceDate()) {
  return localGroup.value.attendance?.[date] || null
}

function ensureAttendanceRecord(date) {
  localGroup.value.attendance ||= {}
  localGroup.value.attendance[date] ||= { records: {} }
  localGroup.value.attendance[date].records ||= {}
  return localGroup.value.attendance[date]
}

function attendanceStatus(studentId) {
  const result = attendanceRecordForDate()?.records?.[studentId] || ''
  if (result === 'F') return 'absent'
  if (result === 'FJ') return 'excused-absence'
  if (result === 'R') return 'late'
  if (result === 'RJ') return 'excused-late'
  return 'normal'
}

function attendanceStyle(studentId) {
  const colors = {
    absent: '#d64545',
    'excused-absence': '#36a66a',
    late: '#e0b323',
    'excused-late': '#e58a24',
    normal: '#aeb7c2',
  }
  return { '--attendance-color': colors[attendanceStatus(studentId)] }
}

function studentCanBeAssessed(studentId) {
  const status = attendanceStatus(studentId)
  return Boolean(selectedAssessment.value) && status !== 'absent' && status !== 'excused-absence'
}

function studentIsInteractive(studentId) {
  if (props.configurationMode) return false
  if (attendanceMode.value) return true
  if (selectedAssessment.value) return studentCanBeAssessed(studentId)
  return true
}

function studentHasBeenAssessed(studentId) {
  const itemId = selectedAssessment.value?.id
  if (!studentId || !itemId) return false
  const result = localGroup.value.evaluaciones?.resultados?.[studentId]?.[itemId]
  return Boolean(result && typeof result === 'object' && result.evaluatedAt)
}

function cycleAttendance(studentId) {
  const date = attendanceDate()
  if (!date || !studentId) return
  const attendance = ensureAttendanceRecord(date)
  const current = attendance.records[studentId]
  if (current === 'F') attendance.records[studentId] = 'FJ'
  else if (current === 'FJ') attendance.records[studentId] = 'R'
  else if (current === 'R') attendance.records[studentId] = 'RJ'
  else if (current === 'RJ') delete attendance.records[studentId]
  else attendance.records[studentId] = 'F'
  attendance.updatedAt = new Date().toISOString()
  markDirty()
  emit('autosave-request', { includeIdentities: false })
}

function studentData(id) {
  return { ...(students.value.find((student) => student.id === id) || { id }), ...(localIdentities.value.get(id) || {}) }
}

function openStudentAssessment(studentId) {
  if (props.configurationMode || !studentId) return
  if (attendanceMode.value) {
    cycleAttendance(studentId)
    return
  }
  if (!selectedAssessment.value) {
    emit('student-selected', studentData(studentId))
    return
  }
  if (!studentCanBeAssessed(studentId)) return
  assessmentStudent.value = studentData(studentId)
  assessmentDialog.value = true
}

function saveStudentAssessment(result) {
  const studentId = assessmentStudent.value?.id
  const itemId = selectedAssessment.value?.id
  if (!studentId || !itemId) return
  localGroup.value.evaluaciones ||= { estructura: [], resultados: {}, pesos: {} }
  localGroup.value.evaluaciones.estructura ||= []
  localGroup.value.evaluaciones.resultados ||= {}
  localGroup.value.evaluaciones.resultados[studentId] ||= {}
  if (!evaluationItems(localGroup.value.evaluaciones.estructura).some((item) => item.id === itemId)) {
    localGroup.value.evaluaciones.estructura.push(JSON.parse(JSON.stringify(selectedAssessment.value)))
  }
  const savedAt = new Date().toISOString()
  localGroup.value.evaluaciones.resultados[studentId][itemId] = {
    ...result,
    evaluatedAt: savedAt,
    updatedAt: savedAt,
  }
  markDirty()
  emit('autosave-request', { includeIdentities: false })
}

function fitRoom() {
  const room = roomRef.value
  if (!room) return
  const rows = Math.max(1, Number(layout.value.rows) || 1)
  const cols = Math.max(1, Number(layout.value.cols) || 1)
  const width = Math.max(0, room.clientWidth - 48)
  const height = Math.max(0, room.clientHeight - 48)
  const aisleExtra = (layout.value.aisles || []).length * 48
  const sizeByWidth = (width - (cols - 1) * 12 - aisleExtra) / cols
  const sizeByHeight = (height - (rows - 1) * 12) / rows
  seatSize.value = Math.max(42, Math.floor(Math.min(sizeByWidth, sizeByHeight)))
}

function studentLabel(id) {
  const student = localIdentities.value.get(id) || students.value.find((item) => item.id === id)
  return student?.nombreCorto || student?.id || id || 'Alumno'
}
function studentPhoto(id) {
  return localIdentities.value.get(id)?.foto || students.value.find((item) => item.id === id)?.foto || ''
}
function studentFlagStyle(id) {
  const student = localIdentities.value.get(id) || students.value.find((item) => item.id === id)
  const colors = []
  if (student?.repetidor) colors.push('#d64545')
  if (student?.pendiente) colors.push('#d7a62a')
  if (student?.nuevo) colors.push('#2e9d62')
  const values = colors.length ? colors : ['#b4bdc9']
  const step = 100 / values.length
  const stops = values.flatMap((color, index) => [`${color} ${index * step}%`, `${color} ${(index + 1) * step}%`])
  return { '--student-flag-gradient': `linear-gradient(to right, ${stops.join(', ')})` }
}
async function loadLocalIdentities() {
  try {
    localIdentities.value = await loadStudentIdentitiesForGroup(localGroup.value)
    const diagnostics = studentIdentityDiagnostics(localIdentities.value)
    if (diagnostics.failed) {
      showAppErrorToast(identityRecoveryMessage(diagnostics), { color: 'warning', copy: false })
    }
  } catch (error) {
    localIdentities.value = new Map()
    console.error('Error al cargar las identidades locales del aula:', error)
    showAppErrorToast(error?.message || 'No se han podido abrir los datos identificativos guardados en este dispositivo.')
  }
}
function markDirty() { revision += 1; emit('dirty-change', true) }
function openLayoutDialog() {
  layoutDraft.value = { rows: layout.value.rows, cols: layout.value.cols, aisles: [...(layout.value.aisles || [])] }
  layoutDialog.value = true
}
function applyLayout() {
  const rows = Math.max(1, Math.min(12, Number(layoutDraft.value.rows) || 1))
  const cols = Math.max(1, Math.min(12, Number(layoutDraft.value.cols) || 1))
  const old = seats.value
  localGroup.value.disposicion = { rows, cols, aisles: [...layoutDraft.value.aisles], asientos: old.slice(0, rows * cols) }
  layoutDialog.value = false
  markDirty()
}
function seatIndex(row, col) { return row * layout.value.cols + col }
function assign(studentId, index) {
  const next = [...seats.value]
  const previous = next.indexOf(studentId)
  const displaced = next[index]
  if (previous >= 0) next[previous] = displaced || null
  next[index] = studentId
  localGroup.value.disposicion = { ...layout.value, asientos: next }
  markDirty()
}
function onDrop(index) {
  if (!dragSource.value) return
  assign(dragSource.value, index)
  dragSource.value = null
}
function onDropWell() {
  if (!dragSource.value) return
  const next = seats.value.map((id) => id === dragSource.value ? null : id)
  if (next.some((id, index) => id !== seats.value[index])) {
    localGroup.value.disposicion = { ...layout.value, asientos: next }
    markDirty()
  }
  dragSource.value = null
}
function getGroup() { return JSON.parse(JSON.stringify(localGroup.value)) }
function getRevision() { return revision }
function markSaved(savedRevision = revision) {
  persistedRevision = Math.max(persistedRevision, Number(savedRevision) || 0)
  if (savedRevision === revision) emit('dirty-change', false)
}
watch(() => props.group, async (value) => {
  // El padre actualiza `group` cuando termina cada guardado. Si entretanto el
  // usuario ha pasado lista otra vez, esa respuesta pertenece a una revisión
  // anterior y no debe sustituir el estado optimista que todavía está
  // pendiente de guardar. El siguiente guardado recogerá la revisión actual.
  if (revision > persistedRevision) return
  localGroup.value = JSON.parse(JSON.stringify(value))
  await loadLocalIdentities()
  await loadTodayAssessments()
}, { deep: true })
watch(() => props.date, () => { void loadTodayAssessments() })
watch(layout, () => requestAnimationFrame(fitRoom), { deep: true })
onMounted(() => {
  roomObserver = new ResizeObserver(fitRoom)
  if (roomRef.value) roomObserver.observe(roomRef.value)
  requestAnimationFrame(fitRoom)
  void loadLocalIdentities()
  void loadTodayAssessments()
})
onBeforeUnmount(() => roomObserver?.disconnect())
defineExpose({ getGroup, getRevision, markSaved, openLayoutDialog, fitRoom })
</script>

<template>
  <div class="classroom-view" :class="{ 'configuration-mode': configurationMode }">
    <div v-if="!configurationMode" class="classroom-assessment-tools" aria-label="Asistencia y tareas evaluables del día">
      <v-tooltip text="Pasar lista" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <button
            v-bind="tooltipProps"
            type="button"
            class="classroom-assessment-button classroom-attendance-button"
            :class="{ selected: attendanceMode }"
            :aria-pressed="attendanceMode"
            aria-label="Pasar lista"
            @click="toggleAttendance"
          ><v-icon icon="mdi-account-check-outline" size="21" /></button>
        </template>
      </v-tooltip>
      <v-tooltip v-for="item in todayAssessments" :key="item.id" :text="item.nombre" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <button
            v-bind="tooltipProps"
            type="button"
            class="classroom-assessment-button"
            :class="{ selected: selectedAssessmentId === item.id }"
            :aria-pressed="selectedAssessmentId === item.id"
            @click="toggleAssessment(item)"
          >{{ item.nombreCorto || item.nombre }}</button>
        </template>
      </v-tooltip>
      <v-tooltip v-if="meritsItem" text="Registrar méritos" location="bottom">
        <template #activator="{ props: tooltipProps }">
          <button
            v-bind="tooltipProps"
            type="button"
            class="classroom-assessment-button classroom-merits-button"
            :class="{ selected: selectedAssessmentId === meritsItem.id }"
            :aria-pressed="selectedAssessmentId === meritsItem.id"
            aria-label="Registrar méritos"
            @click="toggleAssessment(meritsItem)"
          ><v-icon icon="mdi-star-outline" size="21" /></button>
        </template>
      </v-tooltip>
    </div>
    <div class="classroom-workspace">
      <section ref="roomRef" class="classroom-room" aria-label="Disposición del aula">
        <div class="classroom-grid" :style="{ '--classroom-cols': layout.cols, '--classroom-rows': layout.rows, '--classroom-seat-size': `${seatSize}px`, gridTemplateColumns: gridColumnsStyle }">
          <div
            v-for="(studentId, index) in seats"
            :key="`seat-${index}`"
            class="classroom-seat"
            :class="{ 'classroom-seat-aisle': layout.aisles.includes(index % layout.cols), 'classroom-seat-empty-slot': !studentId }"
            @dragover.prevent
            @drop.prevent="onDrop(index)"
          >
            <div
              v-if="studentId"
              class="classroom-student"
              :class="{
                'classroom-student-with-photo': studentPhoto(studentId),
                'classroom-student-assessable': studentIsInteractive(studentId),
                'classroom-student-attendance': !configurationMode && hasAttendanceForSelectedDate,
              }"
              :style="!configurationMode && hasAttendanceForSelectedDate ? attendanceStyle(studentId) : undefined"
              :draggable="configurationMode"
              @dragstart="dragSource = studentId"
              @dragend="dragSource = null"
              @click="openStudentAssessment(studentId)"
            >
              <img v-if="studentPhoto(studentId)" :src="studentPhoto(studentId)" :alt="studentLabel(studentId)">
              <span :style="studentFlagStyle(studentId)">
                <i v-if="!configurationMode && studentHasBeenAssessed(studentId)" class="classroom-assessment-complete" aria-label="Evaluado" />
                {{ studentLabel(studentId) }}
              </span>
            </div>
            <span v-else-if="configurationMode" class="classroom-seat-empty">Pupitre {{ index + 1 }}</span>
          </div>
        </div>
      </section>
      <aside v-if="configurationMode || wellStudents.length" class="classroom-well" aria-label="Alumnos sin pupitre" @dragover.prevent @drop.prevent="onDropWell">
        <div class="classroom-well-title">Sin asignar <span>{{ wellStudents.length }}</span></div>
        <div class="classroom-well-stack">
          <div
            v-for="student in wellStudents"
            :key="student.id"
            class="classroom-student classroom-student-well"
            :class="{ 'classroom-student-assessable': studentIsInteractive(student.id), 'classroom-student-attendance': !configurationMode && hasAttendanceForSelectedDate }"
            :style="!configurationMode && hasAttendanceForSelectedDate ? attendanceStyle(student.id) : undefined"
            :draggable="configurationMode"
            @dragstart="dragSource = student.id"
            @dragend="dragSource = null"
            @click="openStudentAssessment(student.id)"
          >
            <img v-if="studentPhoto(student.id)" :src="studentPhoto(student.id)" :alt="studentLabel(student.id)">
            <span>
              <i v-if="!configurationMode && studentHasBeenAssessed(student.id)" class="classroom-assessment-complete" aria-label="Evaluado" />
              {{ studentLabel(student.id) }}
            </span>
          </div>
          <div v-if="!wellStudents.length" class="classroom-well-empty">Todos tienen pupitre</div>
        </div>
      </aside>
    </div>

    <v-dialog v-model="layoutDialog" max-width="520">
      <v-card>
        <v-card-title>Disposición de pupitres</v-card-title>
        <v-card-text>
          <div class="classroom-layout-preview" :style="{ '--classroom-cols': layoutDraft.cols }">
            <div v-for="n in (layoutDraft.rows * layoutDraft.cols)" :key="n" class="classroom-layout-preview-seat">{{ n }}</div>
          </div>
          <v-text-field v-model.number="layoutDraft.rows" type="number" min="1" max="12" label="Filas" variant="outlined" density="compact" />
          <v-text-field v-model.number="layoutDraft.cols" type="number" min="1" max="12" label="Columnas" variant="outlined" density="compact" />
          <v-select v-model="layoutDraft.aisles" :items="Array.from({ length: layoutDraft.cols || 1 }, (_, i) => i)" label="Pasillos antes de las columnas" multiple chips variant="outlined" density="compact" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="layoutDialog = false">Cancelar</v-btn><v-btn color="primary" variant="flat" @click="applyLayout">Aplicar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <StudentAssessmentDialog
      v-model="assessmentDialog"
      :item="selectedAssessment"
      :student="assessmentStudent"
      :result="activeAssessmentResult"
      @save="saveStudentAssessment"
    />
  </div>
</template>
