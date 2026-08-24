<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadStudentIdentitiesForGroup } from '../services/localStudentIdentity'

const props = defineProps({
  group: { type: Object, required: true },
  configurationMode: { type: Boolean, default: false },
})
const emit = defineEmits(['dirty-change', 'validity-change', 'autosave-request'])

const localGroup = ref(JSON.parse(JSON.stringify(props.group)))
const localIdentities = ref(new Map())
const dragSource = ref(null)
const layoutDialog = ref(false)
const layoutDraft = ref({ rows: 4, cols: 5, aisles: [] })
const roomRef = ref(null)
const seatSize = ref(96)
let roomObserver
let revision = 0

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
  } catch (error) {
    localIdentities.value = new Map()
    console.error('Error al cargar las identidades locales del aula:', error)
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
function markSaved(savedRevision = revision) { if (savedRevision === revision) emit('dirty-change', false) }
watch(() => props.group, async (value) => {
  localGroup.value = JSON.parse(JSON.stringify(value))
  await loadLocalIdentities()
}, { deep: true })
watch(layout, () => requestAnimationFrame(fitRoom), { deep: true })
onMounted(() => {
  roomObserver = new ResizeObserver(fitRoom)
  if (roomRef.value) roomObserver.observe(roomRef.value)
  requestAnimationFrame(fitRoom)
  void loadLocalIdentities()
})
onBeforeUnmount(() => roomObserver?.disconnect())
defineExpose({ getGroup, getRevision, markSaved, openLayoutDialog, fitRoom })
</script>

<template>
  <div class="classroom-view" :class="{ 'configuration-mode': configurationMode }">
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
            <div v-if="studentId" class="classroom-student" :class="{ 'classroom-student-with-photo': studentPhoto(studentId) }" draggable="true" @dragstart="dragSource = studentId" @dragend="dragSource = null">
              <img v-if="studentPhoto(studentId)" :src="studentPhoto(studentId)" :alt="studentLabel(studentId)">
              <span :style="studentFlagStyle(studentId)">{{ studentLabel(studentId) }}</span>
            </div>
            <span v-else-if="configurationMode" class="classroom-seat-empty">Pupitre {{ index + 1 }}</span>
          </div>
        </div>
      </section>
      <aside v-if="configurationMode || wellStudents.length" class="classroom-well" aria-label="Alumnos sin pupitre" @dragover.prevent @drop.prevent="onDropWell">
        <div class="classroom-well-title">Sin asignar <span>{{ wellStudents.length }}</span></div>
        <div class="classroom-well-stack">
          <div v-for="student in wellStudents" :key="student.id" class="classroom-student classroom-student-well" draggable="true" @dragstart="dragSource = student.id" @dragend="dragSource = null">
            <img v-if="studentPhoto(student.id)" :src="studentPhoto(student.id)" :alt="studentLabel(student.id)">
            <span>{{ studentLabel(student.id) }}</span>
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
  </div>
</template>
