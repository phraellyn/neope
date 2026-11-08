<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import StudentTraining from './StudentTraining.vue'
import StudentMessages from './StudentMessages.vue'
import StudentExamResult from './StudentExamResult.vue'
import { formatStudentResultDate, orderedStudentResults } from '../utils/studentResultDates'

const dashboard = ref(null)
const loading = ref(true)
const drawer = ref(false)
const tab = ref('training')
const trainingRef = ref(null)
const assessment = ref({ available: false, open: false })
watch(drawer, (open) => { if (open) trainingRef.value?.closeAssessment() })
function updateAssessment(value) { assessment.value = value; if (value.open) drawer.value = false }
let refreshTimer
const selectedGroupId = ref('')
const groups = computed(() => dashboard.value?.groups || (dashboard.value?.group ? [{ group: dashboard.value.group, results: dashboard.value.results }] : []))
const selectedGroup = computed(() => groups.value.find((entry) => entry.group.id === selectedGroupId.value) || groups.value[0] || null)

const resultEntries = computed(() => orderedStudentResults(selectedGroup.value?.results, selectedGroup.value?.resultDates))
const upcoming = computed(() => {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return (selectedGroup.value?.upcoming || []).filter((item) => item.date >= today)
})

function displayResult(value) {
  if (!value || typeof value !== 'object') return value
  const total = Number(value.total)
  return Number.isFinite(total)
    ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(total)
    : '—'
}

async function loadDashboard() {
  try {
    dashboard.value = (await httpsCallable(functions, 'getStudentDashboardV2')()).data
    if (!groups.value.some((entry) => entry.group.id === selectedGroupId.value)) selectedGroupId.value = groups.value[0]?.group.id || ''
  } catch (error) {
    showAppErrorToast(error?.message || 'No se han podido cargar tus resultados.')
  } finally { loading.value = false }
}

onMounted(() => { void loadDashboard(); refreshTimer = window.setInterval(loadDashboard, 60000) })
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <div class="student-portal">
    <v-app-bar flat border color="white"><button type="button" class="student-logo-button" aria-label="Mostrar asignaturas" @click="drawer = !drawer"><img src="/brand/neope-logo.png" alt="Neope" class="student-logo"></button><div class="student-current-subject">{{ selectedGroup?.group.subject || 'Mis asignaturas' }}</div><v-btn icon="mdi-logout" variant="text" aria-label="Cerrar sesión" @click="signOut(auth)" /></v-app-bar>
    <v-navigation-drawer v-model="drawer" temporary><v-list nav><v-list-subheader>Asignaturas</v-list-subheader><v-list-item v-for="entry in groups" :key="entry.group.id" :active="selectedGroupId === entry.group.id" :title="entry.group.subject || 'Asignatura'" :subtitle="`${entry.group.name} · ${entry.group.academicYear}`" @click="selectedGroupId = entry.group.id; drawer = false" /></v-list></v-navigation-drawer>
    <v-main><div class="student-content"><v-progress-linear v-if="loading" indeterminate color="primary" /><template v-else-if="selectedGroup">
      <div class="student-navigation">
        <v-tabs v-model="tab" color="primary" class="student-tabs" :show-arrows="false">
          <v-tab value="training" aria-label="Entrenamiento" title="Entrenamiento"><span class="tab-icon"><v-icon icon="mdi-school-outline" /></span><span class="tab-label">Entrenamiento</span></v-tab>
          <v-tab value="results" aria-label="Resultados" title="Resultados"><span class="tab-icon"><v-icon icon="mdi-chart-bar" /></span><span class="tab-label">Resultados</span></v-tab>
          <v-tab value="messages" aria-label="Sugerencias" title="Sugerencias"><v-badge :model-value="Boolean(selectedGroup.unreadMessages)" :content="selectedGroup.unreadMessages" color="error" floating><span class="tab-icon"><v-icon icon="mdi-message-text-outline" /></span><span class="tab-label">Sugerencias</span></v-badge></v-tab>
        </v-tabs>
        <v-btn class="assessment-toggle" icon="mdi-format-list-checks" :color="assessment.open && tab === 'training' ? 'primary' : undefined" variant="text" rounded="circle" :disabled="tab !== 'training' || !assessment.available" :aria-label="assessment.open && tab === 'training' ? 'Cerrar autoevaluación' : 'Abrir autoevaluación'" :aria-pressed="tab === 'training' && assessment.open" :title="assessment.available ? 'Autoevaluación' : 'Disponible al mostrar la solución'" @click="trainingRef?.toggleAssessment()" />
      </div>
      <StudentTraining v-show="tab === 'training'" :key="selectedGroup.group.id" ref="trainingRef" :active="tab === 'training'" :group="selectedGroup.group" class="student-tab" @assessment-change="updateAssessment" />
      <StudentMessages v-if="tab === 'messages'" :key="selectedGroup.group.id" :group="selectedGroup.group" class="student-tab student-other-tab" @read="selectedGroup.unreadMessages = 0" />
      <div v-else-if="tab === 'results'" class="student-tab student-other-tab student-results-view"><section v-if="upcoming.length" class="student-results-section"><h2>Próximas fechas</h2><v-list bg-color="transparent"><v-list-item v-for="item in upcoming" :key="item.id" :title="item.title" :subtitle="formatStudentResultDate(item.date)" /></v-list></section><section class="student-results-section"><h2>Mis resultados</h2><div v-if="resultEntries.length" class="student-result-cards"><template v-for="entry in resultEntries" :key="entry.id"><StudentExamResult v-if="selectedGroup.resultDocuments?.[entry.id]" :group-id="selectedGroup.group.id" :item-id="entry.id" :title="selectedGroup.resultLabels?.[entry.id] || 'Resultado'" :grade="String(displayResult(entry.value))" :date="entry.date" :result="entry.value" /><div v-else class="student-plain-result"><div><small v-if="entry.date">{{ formatStudentResultDate(entry.date) }}</small><strong>{{ selectedGroup.resultLabels?.[entry.id] || 'Resultado' }}</strong></div><b>{{ displayResult(entry.value) }}</b></div></template></div><p v-else class="student-results-empty">Todavía no hay resultados publicados.</p></section></div>
    </template></div></v-main>
  </div>
</template>

<style scoped>
.student-portal { min-height: 100dvh; background: #f4f7fb; }.student-logo-button { display: flex; align-items: center; min-height: 48px; padding: 0 12px; }.student-logo { width: 100px; max-width: 25vw; }.student-current-subject { flex: 1; min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; color: #315f96; }
.student-content { width: min(900px, calc(100% - 28px)); height: calc(100dvh - var(--v-layout-top, 64px)); min-height: 0; margin: 0 auto; display: flex; flex-direction: column; }.student-navigation { display: flex; align-items: center; flex: 0 0 48px; min-width: 0; }.student-tabs { flex: 1 1 auto; min-width: 0; }.assessment-toggle { flex: 0 0 auto; }.tab-icon { display: inline-flex; margin-right: 6px; }.student-tab { flex: 1 1 auto; min-height: 0; margin: 8px 0 max(8px, env(safe-area-inset-bottom)); }.student-other-tab { overflow: auto; }
.student-results-view { padding: 4px 3px 16px; }.student-results-section + .student-results-section { margin-top: 20px; }.student-results-section h2 { margin: 0 0 10px; color: #315f94; font-size: 1rem; }.student-results-section :deep(.v-list) { padding: 0; }.student-results-empty { padding: 20px 0; color: #8393a5; text-align: center; }.student-result-cards { display: grid; gap: 12px; }.student-plain-result { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 12px; border-radius: 2px; background: #fff; box-shadow: 0 2px 8px rgba(29, 55, 84, .1); color: #315f94; }.student-plain-result > div { display: grid; gap: 3px; }.student-plain-result small { color: #71839a; }.student-plain-result strong { font-size: .86rem; }.student-plain-result b { font-size: 1.35rem; }
@media (min-width: 700px) { .student-result-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }
@media (max-width: 600px) { .student-content { width: calc(100% - 16px); }.student-tabs :deep(.v-tab) { min-width: 48px; padding: 0 12px; }.tab-label { display: none; }.tab-icon { margin-right: 0; } }
</style>
