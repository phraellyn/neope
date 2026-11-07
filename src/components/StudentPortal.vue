<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import StudentTraining from './StudentTraining.vue'
import StudentMessages from './StudentMessages.vue'

const dashboard = ref(null)
const loading = ref(true)
const drawer = ref(false)
const tab = ref('training')
let refreshTimer
const selectedGroupId = ref('')
const groups = computed(() => dashboard.value?.groups || (dashboard.value?.group ? [{ group: dashboard.value.group, results: dashboard.value.results }] : []))
const selectedGroup = computed(() => groups.value.find((entry) => entry.group.id === selectedGroupId.value) || groups.value[0] || null)

const resultEntries = computed(() => Object.entries(selectedGroup.value?.results || {}))
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
    <v-main><div class="student-content"><v-progress-linear v-if="loading" indeterminate color="primary" /><template v-else-if="selectedGroup"><header><span>{{ selectedGroup.group.academicYear }}</span><h1>{{ selectedGroup.group.subject }}</h1><p>{{ selectedGroup.group.name }}</p></header><v-tabs v-model="tab" color="primary" grow><v-tab value="training">Entrenamiento</v-tab><v-tab value="results">Resultados</v-tab><v-tab value="messages">Sugerencias <v-badge v-if="selectedGroup.unreadMessages" :content="selectedGroup.unreadMessages" color="error" inline /></v-tab></v-tabs><StudentTraining v-if="tab === 'training'" :key="selectedGroup.group.id" :group="selectedGroup.group" class="student-tab" /><StudentMessages v-else-if="tab === 'messages'" :key="selectedGroup.group.id" :group="selectedGroup.group" class="student-tab" @read="selectedGroup.unreadMessages = 0" /><div v-else class="student-tab"><v-card variant="outlined" class="student-results mb-4"><v-card-title>Próximas fechas</v-card-title><v-list v-if="upcoming.length"><v-list-item v-for="item in upcoming" :key="item.id" :title="item.title" :subtitle="item.date.split('-').reverse().join('/')" /></v-list><v-card-text v-else class="empty">No hay fechas publicadas.</v-card-text></v-card><v-card variant="outlined" class="student-results"><v-card-title>Mis resultados</v-card-title><v-list v-if="resultEntries.length" lines="two"><v-list-item v-for="([key, value]) in resultEntries" :key="key" :title="selectedGroup.resultLabels?.[key] || 'Resultado'"><template #append><strong>{{ displayResult(value) }}</strong></template></v-list-item></v-list><v-card-text v-else class="empty">Todavía no hay resultados publicados.</v-card-text></v-card></div></template></div></v-main>
  </div>
</template>

<style scoped>.student-portal { min-height: 100dvh; background: #f4f7fb; }.student-logo-button { display: flex; align-items: center; min-height: 48px; padding: 0 12px; }.student-logo { width: 100px; max-width: 25vw; }.student-current-subject { flex: 1; min-width: 0; overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; color: #315f96; }.student-content { width: min(900px, calc(100% - 28px)); margin: 28px auto; }.student-content header span { color: #6b88a8; font-weight: 700; }.student-content h1 { margin: 3px 0; color: #274f7d; }.student-content header p { margin: 0 0 24px; color: #76889c; }.student-tab { margin-top: 16px; }.student-results { border-color: #d6e1ed; }.student-results .empty { padding: 42px; color: #8393a5; text-align: center; }</style>
