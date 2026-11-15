<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import MathText from './MathText.vue'

const props = defineProps({ groupId: { type: String, required: true }, studentId: { type: String, required: true } })
const history = ref([]), active = ref(null), selected = ref([]), loading = ref(false), saving = ref(false), error = ref(''), pdf = ref(''), assessmentOpen = ref(false)
const format = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 })
const score = (segments) => (segments || []).reduce((sum, segment) => sum + (Number(segment.obtained) || 0), 0)
const maximum = (segments) => (segments || []).reduce((sum, segment) => sum + (Number(segment.maximum) || 0), 0)
const currentScore = computed(() => (active.value?.assessmentSegments || []).reduce((sum, segment) => sum + segment.criteria.reduce((total, criterion) => total + (selected.value.includes(`${segment.id}:${criterion.id}`) ? criterion.points : 0), 0), 0))
const callable = (data) => httpsCallable(functions, 'manageTeacherStudentMessages', { timeout: 130000 })({ groupId: props.groupId, studentId: props.studentId, ...data }).then((result) => result.data)
let request = 0
let swipeStart = null
function startSwipe(event) {
  if (event.touches.length !== 1) { swipeStart = null; return }
  const touch = event.touches[0]
  const bounds = event.currentTarget.getBoundingClientRect()
  swipeStart = { x: touch.clientX, y: touch.clientY, nearRight: bounds.right - touch.clientX < 32 }
}
function endSwipe(event) {
  if (!swipeStart || !event.changedTouches.length) return
  const touch = event.changedTouches[0], dx = touch.clientX - swipeStart.x, dy = touch.clientY - swipeStart.y
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0 && swipeStart.nearRight) assessmentOpen.value = true
    else if (dx > 0 && assessmentOpen.value) assessmentOpen.value = false
  }
  swipeStart = null
}
function clearPdf() { if (pdf.value) URL.revokeObjectURL(pdf.value); pdf.value = '' }
async function load() {
  const id = ++request; loading.value = true; error.value = ''
  try { const result = await callable({ trainingAction: 'list' }); if (id === request) history.value = result.history || [] }
  catch (cause) { if (id === request) error.value = cause.message || 'No se ha podido cargar el historial.' }
  finally { if (id === request) loading.value = false }
}
async function open(item) {
  active.value = item; clearPdf(); error.value = ''; loading.value = true
  const id = ++request
  try {
    const result = await callable({ trainingAction: 'pdf', attemptId: item.id, kind: 'solved' })
    if (id === request) pdf.value = URL.createObjectURL(new Blob([Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))], { type: 'application/pdf' }))
  } catch (cause) { if (id === request) error.value = cause.message || 'No se ha podido cargar el PDF.' }
  finally { if (id === request) loading.value = false }
}
function choose(item) { assessmentOpen.value = false; selected.value = [...(item.criteriaIds || [])]; void open(item) }
function back() { request++; assessmentOpen.value = false; active.value = null; clearPdf(); void load() }
function toggle(id) { selected.value = selected.value.includes(id) ? selected.value.filter((value) => value !== id) : [...selected.value, id] }
async function save() {
  saving.value = true; error.value = ''
  try {
    await callable({ trainingAction: 'save', attemptId: active.value.id, criteriaIds: selected.value, updatedAt: active.value.updatedAt })
    const id = active.value.id
    const result = await callable({ trainingAction: 'list' })
    history.value = result.history || []; active.value = history.value.find((item) => item.id === id) || null
  } catch (cause) { error.value = cause.message || 'No se ha podido guardar la evaluación.' }
  finally { saving.value = false }
}
watch(() => [props.groupId, props.studentId], () => { active.value = null; clearPdf(); void load() }, { immediate: true })
onBeforeUnmount(() => { request++; clearPdf() })
</script>

<template>
  <section class="training-panel" aria-label="Ejercicios del alumno">
    <header class="panel-heading"><v-btn v-if="active" icon="mdi-arrow-left" size="small" variant="text" aria-label="Volver al historial" @click="back" /><strong>{{ active ? 'Ejercicio resuelto' : 'Ejercicios realizados' }}</strong><v-spacer v-if="active" /><v-btn v-if="active" icon="mdi-clipboard-check-outline" size="small" variant="text" :aria-expanded="assessmentOpen" aria-label="Mostrar evaluación" title="Mostrar evaluación" @click="assessmentOpen = !assessmentOpen" /></header>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable @click:close="error = ''">{{ error }}</v-alert>
    <div v-if="!active" class="history">
      <p v-if="!loading && !history.length">Este alumno todavía no ha completado ejercicios.</p>
      <button v-for="item in history" :key="item.id" type="button" class="history-item" @click="choose(item)">
        <span class="history-row"><small>{{ item.completedAt ? new Date(item.completedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '' }}</small><strong>{{ format.format(score(item.segments)) }} / {{ format.format(maximum(item.segments)) }}</strong></span>
        <MathText class="history-title" :text="item.title" />
      </button>
    </div>
    <v-layout v-else class="detail" @touchstart.passive="startSwipe" @touchend.passive="endSwipe" @touchcancel="swipeStart = null">
      <DocumentPdfPreview v-if="pdf" :key="pdf" :src="pdf" :interactive-zoom="true" class="exercise-pdf" />
      <v-btn v-else-if="!loading" variant="text" size="small" @click="open(active)">Reintentar solución</v-btn>
      <v-navigation-drawer v-model="assessmentOpen" location="right" temporary absolute :scrim="false" :width="340" disable-resize-watcher class="assessment-drawer" aria-label="Evaluación del ejercicio">
      <div class="assessment">
        <div class="assessment-heading"><div><strong>Evaluación</strong><div>{{ format.format(active.assessmentSegments.length ? currentScore : score(active.segments)) }} / {{ format.format(maximum(active.assessmentSegments.length ? active.assessmentSegments : active.segments)) }}</div></div><v-btn icon="mdi-close" size="small" variant="text" aria-label="Cerrar evaluación" @click="assessmentOpen = false" /></div>
        <div class="assessment-scroll">
        <p v-if="!active.assessmentSegments.length">Este intento antiguo no conserva la matriz de evaluación.</p>
        <p v-else-if="active.criteriaIds === null">Este intento antiguo no conserva los logros seleccionados; vuelve a seleccionarlos antes de guardar.</p>
        <article v-for="(segment, index) in active.assessmentSegments" :key="segment.id" class="segment">
          <strong>{{ active.assessmentSegments.length === 1 && segment.id === 'exercise' ? 'Ejercicio' : `Apartado ${String.fromCharCode(97 + index)}` }}</strong>
          <button v-for="criterion in segment.criteria" :key="criterion.id" type="button" class="criterion" :class="{ selected: selected.includes(`${segment.id}:${criterion.id}`) }" :aria-pressed="selected.includes(`${segment.id}:${criterion.id}`)" @click="toggle(`${segment.id}:${criterion.id}`)"><MathText :text="criterion.description" /><b>{{ format.format(criterion.points) }} pt</b></button>
        </article>
        </div>
        <div class="assessment-footer">
        <v-btn v-if="active.assessmentSegments.length" color="primary" size="small" :loading="saving" @click="save">Guardar evaluación</v-btn>
        </div>
      </div>
      </v-navigation-drawer>
    </v-layout>
  </section>
</template>

<style scoped>
.training-panel { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; background:#f4f7fb; }
.panel-heading { display:flex; align-items:center; gap:8px; padding:10px 12px; min-height:50px; background:#fff; color:#315f96; }
.history { overflow-y:auto; padding:12px; display:grid; align-content:start; gap:10px; }
.history p,.assessment p { color:#71839a; font-size:.85rem; }
.history-item { display:grid; gap:5px; padding:10px 12px; border-radius:5px; background:#fff; box-shadow:0 2px 8px #1d375419; text-align:left; color:#315f94; }
.history-row { display:flex; justify-content:space-between; gap:12px; }.history-row small { color:#71839a; }.history-title { overflow:hidden; max-height:3.2em; font-size:.8rem; }
.detail { position:relative; display:flex; flex:1 1 0; min-height:0; overflow:hidden; }.exercise-pdf { flex:1 1 0; min-width:0; min-height:0; height:100%; }
.assessment-drawer { max-width:100%; background:#f4f7fb; }.assessment-drawer :deep(.v-navigation-drawer__content) { overflow:hidden; }.assessment { display:flex; flex-direction:column; height:100%; min-height:0; }.assessment-heading { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; padding:8px 12px; background:#fff; color:#315f96; }.assessment-scroll { flex:1 1 0; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 12px; }.assessment-footer { flex:0 0 auto; padding:10px 12px; background:#fff; }.segment { display:grid; gap:5px; margin:12px 0; color:#315f96; }.criterion { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px; border:1px solid #dce5ed; border-radius:4px; background:white; text-align:left; font-size:.85rem; }.criterion.selected { background:#dfefdc; border-color:#84b77d; }.criterion b { white-space:nowrap; }
</style>
