<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import { conceptAncestors } from '../../functions/studentTrainingLogic'
import MathConceptMap from './MathConceptMap.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import StudentTrainingTimer from './StudentTrainingTimer.vue'
import { unlockTrainingAudio } from '../utils/studentTrainingAudio'

const props = defineProps({ group: { type: Object, required: true } })
const nodes = ref([])
const selected = ref([])
const progress = ref({})
const session = ref(null)
const pdfUrl = ref('')
const selectedCriteria = ref([])
const busy = ref(false)
const error = ref('')
const exhausted = ref(false)
let requestNumber = 0
let pendingAlert = false
const displayedSelection = computed(() => [...new Set(selected.value.flatMap((id) => [id, ...conceptAncestors(id, nodes.value)]))])
const callable = async (name, data) => (await httpsCallable(functions, name, { timeout: 130000 })({ groupId: props.group.id, ...data })).data
function clearPdf() { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = '' }
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
  selected.value = []; selectedCriteria.value = []; session.value = null; clearPdf(); error.value = ''; exhausted.value = false; busy.value = true
  try {
    const result = await callable('loadStudentTraining', {})
    if (request !== requestNumber) return
    nodes.value = result.nodes; progress.value = result.progress; session.value = result.session
    if (session.value) { selected.value = session.value.selectedConceptIds || []; await loadPdf(session.value.status === 'review' ? 'solved' : 'statement') }
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
    if (name === 'reveal') await loadPdf('solved')
    if (name === 'complete' || name === 'abandon') { clearPdf(); selectedCriteria.value = []; const data = await callable('loadStudentTraining', {}); progress.value = data.progress }
  } catch (cause) {
    error.value = cause.message || 'No se ha podido actualizar el intento.'
    if (name === 'alerted') { pendingAlert = true; busy.value = false; return }
  }
  finally { if (busy.value) finishBusy() }
}
watch(() => props.group.id, load, { immediate: true })
onBeforeUnmount(() => { requestNumber += 1; session.value = null; clearPdf() })
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
      <details v-if="Object.keys(progress).length"><summary>Mi progreso por contenido</summary><ul><li v-for="node in nodes.filter(item => progress[item.id])" :key="node.id">{{ node.title }}: {{ Math.round(progress[node.id].percentage) }} % · {{ progress[node.id].count }}/5 intentos{{ progress[node.id].provisional ? ' · provisional' : '' }}</li></ul></details>
    </template>
    <template v-else>
      <div class="training-toolbar"><StudentTrainingTimer v-if="session.status === 'active'" :model-value="session.timer" :duration-minutes="session.durationMinutes" :disabled="busy" @action="action" /><v-spacer /><v-btn v-if="session.status === 'active'" color="primary" variant="tonal" :disabled="busy" @click="action('reveal')">Mostrar solución</v-btn><v-btn v-if="session.status === 'active'" variant="text" :disabled="busy" @click="action('abandon')">Abandonar</v-btn></div>
      <DocumentPdfPreview v-if="pdfUrl" :key="pdfUrl" :src="pdfUrl" class="training-pdf" />
      <v-btn v-else-if="!busy" variant="tonal" @click="retryPdf">Reintentar PDF</v-btn>
      <section v-if="session.status === 'review'" class="training-assessment"><h2>Autoevaluación</h2><p>Marca los criterios que has conseguido.</p><fieldset v-for="(segment, index) in session.segments" :key="segment.id"><legend>{{ session.segments.length === 1 && segment.id === 'exercise' ? 'Ejercicio' : `Apartado ${String.fromCharCode(97 + index)}` }}</legend><v-checkbox v-for="criterion in segment.criteria" :key="criterion.id" v-model="selectedCriteria" :value="`${segment.id}:${criterion.id}`" :label="`${criterion.description} · ${criterion.points} puntos`" density="comfortable" hide-details /></fieldset><v-btn color="primary" :disabled="busy" @click="action('complete')">Guardar autoevaluación</v-btn></section>
    </template>
  </section>
</template>

<style scoped>
.student-training { display: grid; gap: 14px; min-width: 0; }.training-map { height: min(70vh, 620px); min-height: 330px; }.training-buttons,.training-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }.training-pdf { height: min(72vh, 750px); min-height: 350px; }.training-assessment { display: grid; gap: 12px; }.training-assessment fieldset { border: 1px solid #d6e1ed; border-radius: 8px; padding: 8px 12px; }.training-assessment h2 { font-size: 1rem; color: #315f96; }.student-training p { margin: 0; }.student-training details ul { padding-left: 20px; }
@media (max-width: 600px) { .training-map { height: 52vh; min-height: 300px; }.training-pdf { height: 60vh; min-height: 280px; }.training-toolbar { align-items: center; } }
</style>
