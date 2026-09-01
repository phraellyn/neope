<script setup>
import { computed, onMounted, ref } from 'vue'
import { signOut } from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const dashboard = ref(null)
const loading = ref(true)

const resultEntries = computed(() => Object.entries(dashboard.value?.results || {}))

async function loadDashboard() {
  try {
    dashboard.value = (await httpsCallable(functions, 'getStudentDashboard')()).data
  } catch (error) {
    showAppErrorToast(error?.message || 'No se han podido cargar tus resultados.')
  } finally { loading.value = false }
}

onMounted(loadDashboard)
</script>

<template>
  <div class="student-portal">
    <v-app-bar flat border color="white"><img src="/brand/neope-logo.png" alt="Neope" class="student-logo"><v-spacer /><span class="student-code">{{ dashboard?.code }}</span><v-btn icon="mdi-logout" variant="text" aria-label="Cerrar sesión" @click="signOut(auth)" /></v-app-bar>
    <v-main><div class="student-content"><v-progress-linear v-if="loading" indeterminate color="primary" /><template v-else-if="dashboard"><header><span>{{ dashboard.group.academicYear }}</span><h1>{{ dashboard.group.subject }}</h1><p>{{ dashboard.group.name }}</p></header><v-card variant="outlined" class="student-results"><v-card-title>Mis resultados</v-card-title><v-list v-if="resultEntries.length" lines="two"><v-list-item v-for="([key, value]) in resultEntries" :key="key" :title="key"><template #append><strong>{{ value }}</strong></template></v-list-item></v-list><v-card-text v-else class="empty">Todavía no hay resultados publicados.</v-card-text></v-card></template></div></v-main>
  </div>
</template>

<style scoped>.student-portal { min-height: 100dvh; background: #f4f7fb; }.student-logo { width: 112px; margin-left: 18px; }.student-code { margin-right: 8px; padding: 5px 10px; border-radius: 8px; color: #41668e; background: #edf3fa; font-family: monospace; }.student-content { width: min(760px, calc(100% - 28px)); margin: 38px auto; }.student-content header span { color: #6b88a8; font-weight: 700; }.student-content h1 { margin: 3px 0; color: #274f7d; }.student-content header p { margin: 0 0 24px; color: #76889c; }.student-results { border-color: #d6e1ed; }.student-results .empty { padding: 42px; color: #8393a5; text-align: center; }</style>
