<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import MathConceptMap from './MathConceptMap.vue'
import { calculateConceptProgress, conceptProgressLabel } from '../utils/conceptProgressLabel'

const props = defineProps({ group: { type: Object, required: true }, studentId: { type: String, required: true } })
const loading = ref(false)
const error = ref('')
const nodes = ref([])
const progress = ref({})
let sequence = 0
const hasEvidence = computed(() => Object.values(progress.value).some((entry) => entry.worked))

async function load() {
  const current = ++sequence
  loading.value = true; error.value = ''; nodes.value = []; progress.value = {}
  try {
    const result = await httpsCallable(functions, 'getTeacherStudentTrainingProgress')({ groupId: props.group.id, studentId: props.studentId })
    if (current !== sequence) return
    nodes.value = result.data.nodes || []
    progress.value = calculateConceptProgress(nodes.value, result.data.progress || {})
  } catch (cause) {
    if (current === sequence) error.value = cause.message || 'No se ha podido cargar el progreso por conceptos.'
  } finally { if (current === sequence) loading.value = false }
}
watch(() => [props.group.id, props.studentId], load, { immediate: true })
onBeforeUnmount(() => { sequence += 1 })
</script>

<template>
  <section class="student-concepts">
    <div class="student-concepts-heading"><div><h2>Progreso por conceptos</h2><p>{{ group.asignatura || group.subject || 'Asignatura del grupo' }} · Autoevaluaciones del entrenamiento</p></div><v-btn icon="mdi-refresh" variant="text" size="small" aria-label="Actualizar progreso" :loading="loading" @click="load" /></div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-else-if="error" type="error" variant="tonal">{{ error }} <v-btn size="small" variant="text" @click="load">Reintentar</v-btn></v-alert>
    <template v-else-if="nodes.length">
      <p class="student-concepts-help">Los conceptos finales reflejan los últimos cinco intentos. Cada categoría es la media de sus contenidos inmediatos; los no trabajados cuentan como cero. Con menos de cinco intentos, el resultado es provisional.</p>
      <p v-if="!hasEvidence" class="student-concepts-help">El alumno todavía no tiene intentos completados en esta asignatura.</p>
      <MathConceptMap class="student-concepts-map" :nodes="nodes" :active-subject-id="group.subjectId" :subject-node-ids="nodes.map(node => node.id)" :concept-progress="progress" :show-curriculum="false" :show-hint="false" />
      <details class="student-concepts-list"><summary>Ver detalle por concepto</summary><ul><li v-for="node in nodes.filter(item => item.id !== 'matematicas')" :key="node.id"><span>{{ node.title }}</span><strong>{{ conceptProgressLabel(progress[node.id]) }}</strong></li></ul></details>
    </template>
    <p v-else>Esta asignatura todavía no tiene conceptos configurados.</p>
  </section>
</template>

<style scoped>
.student-concepts { display: grid; gap: 12px; padding: 20px; min-width: 0; }.student-concepts-heading { display: flex; align-items: start; justify-content: space-between; gap: 8px; }.student-concepts-heading h2 { color: #315f96; font-size: 1.1rem; }.student-concepts-heading p,.student-concepts-help { color: #667b91; font-size: .9rem; }.student-concepts-map { width: 100%; height: min(65vh, 600px); min-height: 300px; }.student-concepts-list summary { cursor: pointer; color: #315f96; }.student-concepts-list ul { list-style: none; padding: 8px 0; }.student-concepts-list li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 5px 0; border-bottom: 1px solid #edf1f5; font-size: .875rem; }.student-concepts-list strong { font-weight: 600; }
@media (max-width: 600px) { .student-concepts { padding: 12px; }.student-concepts-map { height: 52vh; min-height: 280px; } }
</style>
