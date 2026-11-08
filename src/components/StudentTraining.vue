<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { useDisplay } from 'vuetify'
import { functions } from '../services/firebase'
import { conceptAncestors } from '../../functions/studentTrainingLogic'
import MathConceptMap from './MathConceptMap.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import StudentTrainingTimer from './StudentTrainingTimer.vue'
import MathText from './MathText.vue'
import { unlockTrainingAudio } from '../utils/studentTrainingAudio'
import { calculateConceptProgress } from '../utils/conceptProgressLabel'

const props = defineProps({ group: { type: Object, required: true }, active: { type: Boolean, default: true } })
const emit = defineEmits(['assessment-change'])
const display = useDisplay()
const assessmentWidth = computed(() => Math.min(400, Math.floor(display.width.value * 0.88)))
const nodes = ref([])
const selected = ref([])
const progress = ref({})
const session = ref(null)
const pdfUrl = ref('')
const selectedCriteria = ref([])
const assessmentOpen = ref(false)
const busy = ref(false)
const error = ref('')
const exhausted = ref(false)
let requestNumber = 0
let pendingAlert = false
const displayedSelection = computed(() => [...new Set(selected.value.flatMap((id) => [id, ...conceptAncestors(id, nodes.value)]))])
const assessmentScore = computed(() => {
  const chosen = new Set(selectedCriteria.value)
  return (session.value?.segments || []).reduce((total, segment) => {
    total.maximum += Number(segment.maximum) || 0
    for (const criterion of segment.criteria || []) {
      if (chosen.has(`${segment.id}:${criterion.id}`)) total.obtained += Number(criterion.points) || 0
    }
    return total
  }, { obtained: 0, maximum: 0 })
})
const scoreFormatter = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4 })
const callable = async (name, data) => (await httpsCallable(functions, name, { timeout: 130000 })({ groupId: props.group.id, ...data })).data
function clearPdf() { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = '' }
function toggleCriterion(id) { selectedCriteria.value = selectedCriteria.value.includes(id) ? selectedCriteria.value.filter((value) => value !== id) : [...selectedCriteria.value, id] }
function toggleAssessment() { if (session.value?.status === 'review') assessmentOpen.value = !assessmentOpen.value }
function closeAssessment() { assessmentOpen.value = false }
defineExpose({ toggleAssessment, closeAssessment })
watch([() => session.value?.status, assessmentOpen], ([status, open]) => emit('assessment-change', { available: status === 'review', open: status === 'review' && open }), { immediate: true })
function finishBusy() {
  busy.value = false
  if (pendingAlert && session.value?.status === 'active') { pendingAlert = false; void action('alerted') }
}
function toggleConcept(id) {
  if (!nodes.value.some((node) => node.id === id)) return
  if (displayedSelection.value.includes(id)) selected.value = selected.value.filter((item) => item !== id && !conceptAncestors(item, nodes.value).includes(id))
  else selected.value = [...selected.value, id]
  exhausted.value = false
}
async function loadPdf(kind) {
  const id = session.value?.id
  const response = await callable('getStudentTrainingPdf', { sessionId: id, kind })
  if (session.value?.id !== id) return
  const binary = atob(response.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  clearPdf(); pdfUrl.value = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}
async function load() {
  const request = ++requestNumber
  pendingAlert = false
  selected.value = []; selectedCriteria.value = []; session.value = null; assessmentOpen.value = false; clearPdf(); error.value = ''; exhausted.value = false; busy.value = true
  try {
    const result = await callable('loadStudentTraining', {})
    if (request !== requestNumber) return
    nodes.value = result.nodes; progress.value = calculateConceptProgress(result.nodes, result.progress || {}); session.value = result.session
    if (session.value) { selected.value = session.value.selectedConceptIds || []; await loadPdf(session.value.status === 'review' ? 'solved' : 'statement'); if (session.value?.status === 'review') assessmentOpen.value = true }
  } catch (cause) { if (request === requestNumber) error.value = cause.message || 'No se ha podido cargar el entrenamiento.' }
  finally { if (request === requestNumber) finishBusy() }
}
async function start(repeat = false) {
  if (busy.value || !selected.value.length) return
  unlockTrainingAudio()
  busy.value = true; error.value = ''
  try { session.value = await callable('startStudentTraining', { selectedConceptIds: selected.value, repeat }); exhausted.value = false; await loadPdf('statement') }
  catch (cause) { error.value = cause.message || 'No se ha podido proponer un ejercicio.'; exhausted.value = cause.code?.endsWith('not-found') }
  finally { finishBusy() }
}
async function retryPdf() {
  if (busy.value || !session.value) return
  busy.value = true; error.value = ''
  try { await loadPdf(session.value.status === 'review' ? 'solved' : 'statement') }
  catch (cause) { error.value = cause.message || 'No se ha podido cargar el PDF.' }
  finally { finishBusy() }
}
async function action(name) {
  if (busy.value || !session.value) { if (name === 'alerted') pendingAlert = true; return }
  busy.value = true; error.value = ''
  try {
    const result = await callable('updateStudentTraining', { sessionId: session.value.id, action: name, criteriaIds: selectedCriteria.value })
    session.value = result.session
    if (name === 'reset' || name === 'reveal' || name === 'abandon' || name === 'complete') pendingAlert = false
    if (name === 'reveal') { assessmentOpen.value = true; await loadPdf('solved') }
    if (name === 'complete' || name === 'abandon') { assessmentOpen.value = false; clearPdf(); selectedCriteria.value = []; const data = await callable('loadStudentTraining', {}); progress.value = calculateConceptProgress(data.nodes, data.progress || {}) }
  } catch (cause) {
    error.value = cause.message || 'No se ha podido actualizar el intento.'
    if (name === 'alerted') { pendingAlert = true; busy.value = false; return }
  }
  finally { if (busy.value) finishBusy() }
}
watch(() => props.group.id, load, { immediate: true })
onBeforeUnmount(() => { requestNumber += 1; session.value = null; clearPdf(); emit('assessment-change', { available: false, open: false }) })
</script>

<template>
  <section class="student-training">
    <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="busy" indeterminate color="primary" />
    <template v-if="!session">
      <p>Elige los contenidos que quieras practicar.</p>
      <MathConceptMap v-if="nodes.length" class="training-map" :nodes="nodes" :active-subject-id="group.subjectId" :subject-node-ids="nodes.map(node => node.id)" selection-mode :selected-node-ids="displayedSelection" :concept-progress="progress" :show-curriculum="false" :show-hint="false" @select-concept="toggleConcept" />
      <p v-else-if="!busy">Esta asignatura todavía no tiene contenidos disponibles.</p>
      <div class="training-buttons"><v-btn color="primary" :disabled="busy || !selected.length" @click="start()">Proponer ejercicio</v-btn><v-btn v-if="exhausted" variant="tonal" :disabled="busy" @click="start(true)">Repetir un ejercicio</v-btn></div>
    </template>
    <template v-else>
      <div v-if="session.status === 'active'" class="training-toolbar"><StudentTrainingTimer :model-value="session.timer" :duration-minutes="session.durationMinutes" :disabled="busy" @action="action" /><v-spacer /><v-btn color="primary" variant="tonal" size="small" :disabled="busy" @click="action('reveal')">Mostrar solución</v-btn><v-btn icon="mdi-close" variant="text" size="small" :disabled="busy" aria-label="Abandonar ejercicio" title="Abandonar ejercicio" @click="action('abandon')" /></div>
      <DocumentPdfPreview v-if="pdfUrl" :key="pdfUrl" :src="pdfUrl" class="training-pdf" />
      <v-btn v-else-if="!busy" variant="tonal" @click="retryPdf">Reintentar PDF</v-btn>
      <v-navigation-drawer v-if="active && session.status === 'review'" v-model="assessmentOpen" location="right" temporary :scrim="false" :width="assessmentWidth" disable-resize-watcher class="training-assessment" aria-label="Matriz de autoevaluación">
        <div class="assessment-content">
        <header class="assessment-heading"><div><h2>Autoevaluación</h2><p>Marca los logros que has conseguido.</p><p class="assessment-total" aria-live="polite">Puntuación: <strong>{{ scoreFormatter.format(assessmentScore.obtained) }} / {{ scoreFormatter.format(assessmentScore.maximum) }}</strong></p></div><v-btn icon="mdi-close" variant="text" size="small" aria-label="Cerrar autoevaluación" @click="assessmentOpen = false" /></header>
        <div class="assessment-scroll"><article v-for="(segment, index) in session.segments" :key="segment.id" class="assessment-segment"><h3>{{ session.segments.length === 1 && segment.id === 'exercise' ? 'Ejercicio' : `Apartado ${String.fromCharCode(97 + index)}` }}</h3><div class="assessment-criteria"><button v-for="criterion in segment.criteria" :key="criterion.id" type="button" :class="{ selected: selectedCriteria.includes(`${segment.id}:${criterion.id}`) }" :aria-pressed="selectedCriteria.includes(`${segment.id}:${criterion.id}`)" @click="toggleCriterion(`${segment.id}:${criterion.id}`)"><MathText :text="criterion.description" /><b>{{ criterion.points }} pt</b></button></div></article></div>
        <footer class="assessment-footer"><v-btn variant="text" @click="assessmentOpen = false">Ver solución completa</v-btn><v-btn color="primary" :disabled="busy" @click="action('complete')">Guardar autoevaluación</v-btn></footer>
        </div>
      </v-navigation-drawer>
    </template>
  </section>
</template>

<style scoped>
.assessment-heading .assessment-total { margin-top: 4px; color: #315f96; font-size: .9rem; }
.assessment-total strong { font-weight: 700; }
.student-training { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }.student-training .training-map { height: 0; flex: 1 1 0; min-height: 220px; }.training-buttons,.training-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }.student-training .training-pdf { height: 0; flex: 1 1 0; min-height: 220px; }.student-training p { margin: 0; }
.training-assessment { background: #f3f6fa; }.training-assessment :deep(.v-navigation-drawer__content) { overflow: hidden; }.assessment-content { display: grid; height: 100%; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; }.assessment-heading,.assessment-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; background: #fff; }.assessment-heading h2 { font-size: 1rem; color: #315f96; }.assessment-heading p { font-size: .8rem; color: #71839a; }.assessment-scroll { overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }.assessment-segment { background: #fff; border-bottom: 5px solid #dce5ef; }.assessment-segment h3 { padding: 7px 12px; font-size: .8rem; color: #385d86; background: #f8fafc; }.assessment-criteria { display: grid; align-content: start; gap: 6px; padding: 8px; }.assessment-criteria button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; padding: 8px; border: 1px solid #d6e0eb; border-radius: 7px; background: #f8fafc; color: #506b87; text-align: left; }.assessment-criteria button.selected { background: #315f94; border-color: #315f94; color: #fff; }.assessment-criteria b { white-space: nowrap; font-size: .75rem; }.assessment-footer { flex-wrap: wrap; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
@media (max-width: 600px) { .training-toolbar { align-items: center; }.assessment-criteria button { font-size: .85rem; } }
</style>
