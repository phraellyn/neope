<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { useDisplay } from 'vuetify'
import { functions } from '../services/firebase'
import { aggregateExerciseStructure, exerciseStructureFromDocument, mergeExerciseStructure, parseExerciseLatex } from '../utils/exerciseStructure'
import { assessmentExerciseModel } from '../utils/documentAssessmentMatrix'
import { formatStudentResultDate } from '../utils/studentResultDates'
import ExercisePdfPreview from './ExercisePdfPreview.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import MathText from './MathText.vue'

const props = defineProps({ groupId: { type: String, required: true }, itemId: { type: String, required: true }, title: { type: String, required: true }, grade: { type: String, required: true }, date: { type: String, default: '' }, result: { type: [String, Number, Object], default: null } })
const pdfUrl = ref('')
const matrix = ref(null)
const loading = ref(true)
const unavailable = ref(false)
const loadError = ref(false)
const dialog = ref(false)
const matrixOpen = ref(false)
const display = useDisplay()
const fullScreenViewer = computed(() => display.mobile.value || Math.min(display.width.value, display.height.value) <= 600)
const drawerWidth = computed(() => Math.min(400, Math.floor(display.width.value * 0.85)))
const card = ref(null)
let observer
let seen = false
let requestSequence = 0
const selected = computed(() => new Set(matrix.value?.selectedAchievementIds || []))
const exercises = computed(() => (matrix.value?.exercises || []).map((entry) => {
  const source = entry.source || {}
  const structure = Number(source.schemaVersion) >= 3 && source.statement
    ? aggregateExerciseStructure(exerciseStructureFromDocument(source))
    : mergeExerciseStructure(parseExerciseLatex(source.codigo || ''), source.structure || source)
  return assessmentExerciseModel({ exerciseId: entry.exerciseId, version: entry.version, order: entry.order, structure, assessment: entry.assessment })
}))
const hasMatrix = computed(() => exercises.value.some((exercise) => exercise.achievements.length > 0))
function clearPdf() { if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value); pdfUrl.value = '' }
async function load() {
  const request = ++requestSequence
  clearPdf(); matrix.value = null; unavailable.value = false; loadError.value = false; loading.value = true
  try {
    const response = (await httpsCallable(functions, 'getStudentExam', { timeout: 130000 })({ groupId: props.groupId, itemId: props.itemId })).data
    if (request !== requestSequence) return
    if (response.pdf?.data) {
      const bytes = Uint8Array.from(atob(response.pdf.data), (character) => character.charCodeAt(0))
      pdfUrl.value = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    }
    matrix.value = response.matrix
    unavailable.value = !pdfUrl.value && !matrix.value
  } catch { if (request === requestSequence) { unavailable.value = true; loadError.value = true } }
  finally { if (request === requestSequence) loading.value = false }
}
watch(() => [props.groupId, props.itemId, props.result], () => { if (seen) void load() }, { deep: true })
watch(dialog, (open) => { if (!open) matrixOpen.value = false })
onMounted(() => {
  const element = card.value?.$el
  if (!element || typeof IntersectionObserver === 'undefined') { seen = true; void load(); return }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer.disconnect(); seen = true; void load()
  }, { rootMargin: '250px' })
  observer.observe(element)
})
onBeforeUnmount(() => { requestSequence += 1; observer?.disconnect(); clearPdf() })
</script>

<template>
  <v-card ref="card" class="student-exam-card" variant="flat">
    <button type="button" class="student-exam-open" :disabled="loading || unavailable || (!pdfUrl && !hasMatrix)" :aria-label="`Ver ${title}`" @click="dialog = true">
      <div class="student-exam-heading"><div class="student-exam-heading-text"><strong>{{ title }}</strong></div><b class="student-exam-grade">{{ grade }}</b></div>
      <v-divider class="student-exam-divider" />
      <div class="student-exam-thumbnail"><ExercisePdfPreview v-if="pdfUrl" :src="pdfUrl" :title="title" thumbnail /><span v-else>{{ loading ? 'Cargando…' : loadError ? 'No se ha podido cargar' : 'Sin PDF disponible' }}</span></div>
      <v-divider v-if="date" class="student-exam-divider" />
      <div v-if="date" class="student-exam-date">{{ formatStudentResultDate(date) }}</div>
    </button>
    <v-btn v-if="loadError" size="small" variant="text" @click="load">Reintentar</v-btn>
    <v-dialog v-model="dialog" class="student-exam-viewer" :fullscreen="fullScreenViewer" max-width="1100" :width="fullScreenViewer ? '100%' : 'calc(100% - 20px)'" :height="fullScreenViewer ? '100dvh' : 'calc(100dvh - 20px)'">
      <v-card class="student-exam-dialog">
        <v-card-title class="student-exam-dialog-title"><span class="student-exam-dialog-name">{{ title }}</span><v-spacer /><span class="student-exam-dialog-grade" :aria-label="`Nota: ${grade}`"><small>Nota</small><strong>{{ grade }}</strong></span><v-btn v-if="matrix && hasMatrix" icon="mdi-format-list-checks" variant="text" :color="matrixOpen ? 'primary' : undefined" :aria-label="matrixOpen ? 'Cerrar matriz de evaluación' : 'Abrir matriz de evaluación'" :aria-pressed="matrixOpen" title="Matriz de evaluación" @click="matrixOpen = !matrixOpen" /><v-btn icon="mdi-close" variant="text" aria-label="Cerrar resultado" @click="dialog = false" /></v-card-title>
        <v-layout class="student-exam-layout">
          <v-navigation-drawer v-if="dialog && matrix && hasMatrix" v-model="matrixOpen" location="right" temporary absolute :scrim="false" :width="drawerWidth" disable-resize-watcher aria-label="Matriz de evaluación" class="student-exam-drawer">
            <div class="student-exam-drawer-content"><header><h2>Matriz de evaluación</h2><v-btn icon="mdi-close" variant="text" size="small" aria-label="Cerrar matriz de evaluación" @click="matrixOpen = false" /></header><div class="student-exam-matrix"><article v-for="exercise in exercises" :key="exercise.key"><h3>{{ exercise.label }}</h3><section v-for="row in exercise.rows.filter(item => item.achievements.length)" :key="row.key"><h4>{{ row.label }}</h4><div v-for="achievement in row.achievements" :key="achievement.key" class="student-exam-achievement" :class="{ achieved: selected.has(achievement.key) }"><v-icon :icon="selected.has(achievement.key) ? 'mdi-check-circle' : 'mdi-circle-outline'" size="18" :aria-label="selected.has(achievement.key) ? 'Conseguido' : 'No conseguido'" /><MathText :text="achievement.description" /><strong>{{ achievement.points }} pt</strong></div></section></article></div></div>
          </v-navigation-drawer>
          <v-main class="student-exam-main"><DocumentPdfPreview v-if="pdfUrl" :src="pdfUrl" :title="title" interactive-zoom class="student-exam-pdf" /><p v-else class="student-exam-empty">El PDF no está disponible.</p></v-main>
        </v-layout>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.student-exam-divider { border-color: #d6e0eb; opacity: 1; }
.student-exam-date { padding: 7px 14px; background: #f7f9fc; color: #71839a; font-size: .75rem; }
.student-exam-card { width: 100%; overflow: hidden; border: 0; border-radius: 2px !important; background: #fff; box-shadow: 0 2px 8px rgba(29, 55, 84, .1) !important; }.student-exam-open { display: grid; width: 100%; padding: 0; text-align: left; color: #315f94; }.student-exam-open:disabled { cursor: default; }.student-exam-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 10px 14px; }.student-exam-heading-text { display: grid; gap: 2px; min-width: 0; }.student-exam-heading-text span { color: #71839a; font-size: .75rem; }.student-exam-heading-text strong { overflow-wrap: anywhere; font-size: .86rem; }.student-exam-grade { flex: 0 0 auto; font-size: 1.5rem; line-height: 1.2; }.student-exam-thumbnail { width: 100%; height: 130px; overflow: hidden; background: #eef2f7; }.student-exam-thumbnail > span { display: grid; height: 100%; padding: 5px; place-items: center; color: #71839a; font-size: .75rem; text-align: center; }.student-exam-dialog { height: 100%; display: flex; flex-direction: column; }.student-exam-dialog-title { display: flex; align-items: center; gap: 8px; }.student-exam-dialog-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }.student-exam-dialog-grade { display: grid; flex: 0 0 auto; justify-items: center; color: #315f94; line-height: 1.15; }.student-exam-dialog-grade small { font-size: .6rem; color: #71839a; }.student-exam-dialog-grade strong { font-size: 1.1rem; }.student-exam-layout { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }.student-exam-main { min-width: 0; min-height: 0; height: 100%; }.student-exam-pdf { height: 100%; }.student-exam-empty { padding: 20px; }.student-exam-drawer :deep(.v-navigation-drawer__content) { overflow: hidden; }.student-exam-drawer-content { display: grid; height: 100%; min-height: 0; grid-template-rows: auto minmax(0, 1fr); }.student-exam-drawer-content > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #d6e0eb; }.student-exam-drawer-content h2 { font-size: 1rem; color: #315f94; }.student-exam-matrix { min-width: 0; overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 12px; }.student-exam-matrix h3 { margin-top: 12px; font-size: .9rem; }.student-exam-matrix h4 { margin: 6px 0; color: #71839a; font-size: .8rem; }.student-exam-achievement { display: flex; align-items: start; gap: 8px; margin: 5px 0; padding: 8px; border: 1px solid #d6e0eb; border-radius: 6px; }.student-exam-achievement.achieved { background: #e4f2e8; border-color: #78b98d; }.student-exam-achievement strong { margin-left: auto; white-space: nowrap; }
:global(.student-exam-viewer > .v-overlay__content), :global(.student-exam-viewer > .v-overlay__content > .v-card) { border-radius: 0 !important; }
:global(.student-exam-viewer.v-dialog--fullscreen > .v-overlay__content) { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100dvh !important; max-width: 100vw !important; max-height: 100dvh !important; margin: 0 !important; border-radius: 0 !important; }
</style>
