<script setup>
import { computed, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import { normalizeExerciseGradingCriteria } from '../utils/exerciseStructure'

const props = defineProps({
  modelValue: { type: Object, required: true },
  target: { type: [String, Number], default: null },
  curriculum: { type: Object, default: () => ({}) },
  subjects: { type: Array, default: () => [] },
  aiModel: { type: String, default: 'google/gemini-3-flash-preview' },
  latex: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'update:target', 'generated'])
const generating = ref(false)

const clone = (value) => JSON.parse(JSON.stringify(value))
const roundedPoints = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
const uniqueId = () => `criterion-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
const formatPoints = (value) => roundedPoints(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const segments = computed(() => {
  const parts = Array.isArray(props.modelValue?.apartados) ? props.modelValue.apartados : []
  if (parts.length) return parts.map((part, index) => ({
    target: index,
    id: part.id,
    label: `Apartado ${String.fromCharCode(97 + index)}`,
    shortLabel: String.fromCharCode(97 + index),
    points: Number(part.puntuacion) || 0,
    segment: part,
  }))
  return [{ target: 'exercise', id: 'exercise', label: 'Ejercicio', shortLabel: 'Ejercicio', points: Number(props.modelValue?.puntuacion) || 0, segment: props.modelValue }]
})
const activeDefinition = computed(() => segments.value.find((segment) => segment.target === props.target) || segments.value[0])
const criteria = computed(() => Array.isArray(activeDefinition.value?.segment?.gradingCriteria) ? activeDefinition.value.segment.gradingCriteria : [])
const assignedPoints = computed(() => criteria.value.reduce((total, criterion) => total + roundedPoints(criterion.points), 0))
const targetPoints = computed(() => Number(activeDefinition.value?.points) || 0)
const pointsMatch = computed(() => Math.abs(assignedPoints.value - targetPoints.value) < 0.001)
const subject = computed(() => props.subjects.find((item) => item.id === props.curriculum?.subjectId))

function selectTarget(target) { emit('update:target', target) }

function updateStructure(mutator) {
  const structure = clone(props.modelValue || {})
  const definition = activeDefinition.value
  const segment = typeof definition?.target === 'number' ? structure.apartados?.[definition.target] : structure
  if (!segment) return
  segment.gradingCriteria = Array.isArray(segment.gradingCriteria) ? segment.gradingCriteria : []
  mutator(segment)
  emit('update:modelValue', structure)
}

function addCriterion() {
  const remaining = Math.max(0, roundedPoints(targetPoints.value - assignedPoints.value))
  updateStructure((segment) => segment.gradingCriteria.push({ id: uniqueId(), description: '', points: remaining, source: 'manual' }))
}

function updateCriterion(id, patch) {
  updateStructure((segment) => {
    const criterion = segment.gradingCriteria.find((item) => item.id === id)
    if (!criterion) return
    Object.assign(criterion, patch, { source: 'manual' })
    delete criterion.model
    if (Object.hasOwn(patch, 'points')) criterion.points = roundedPoints(patch.points)
  })
}

function removeCriterion(id) {
  updateStructure((segment) => { segment.gradingCriteria = segment.gradingCriteria.filter((criterion) => criterion.id !== id) })
}

async function generateWithAi() {
  if (generating.value) return
  const assessableSegments = segments.value.filter((segment) => segment.points > 0 && String(segment.segment?.enunciado || '').trim())
  if (!assessableSegments.length) {
    showAppErrorToast('Asigna una puntuación al ejercicio o a sus apartados antes de generar los criterios de calificación.')
    return
  }
  generating.value = true
  try {
    const callable = httpsCallable(functions, 'suggestExerciseGradingCriteria', { timeout: 120_000 })
    const response = await callable({
      model: props.aiModel,
      course: props.curriculum.course,
      subjectId: props.curriculum.subjectId,
      subjectTitle: subject.value?.title || '',
      curriculum: props.curriculum,
      latex: props.latex,
      conceptIds: props.curriculum.conceptIds || [],
      segments: assessableSegments.map((segment) => ({
        id: segment.id,
        label: segment.label,
        points: segment.points,
        statement: segment.segment.enunciado || '',
        answer: segment.segment.respuesta || '',
        workedSolution: segment.segment.solucion || '',
        contentIds: segment.segment.contenidos || [],
      })),
    })
    const suggestions = new Map((response.data?.segments || []).map((segment) => [segment.segmentId, segment.gradingCriteria]))
    const structure = clone(props.modelValue || {})
    if (Array.isArray(structure.apartados) && structure.apartados.length) {
      structure.apartados.forEach((part) => {
        if (suggestions.has(part.id)) part.gradingCriteria = normalizeExerciseGradingCriteria(suggestions.get(part.id))
      })
    } else if (suggestions.has('exercise')) structure.gradingCriteria = normalizeExerciseGradingCriteria(suggestions.get('exercise'))
    emit('update:modelValue', structure)
    emit('generated')
  } catch (error) {
    console.error('No se han podido generar los criterios de calificación:', error)
    showAppErrorToast(error?.message || 'No se han podido generar los criterios de calificación con IA.')
  } finally {
    generating.value = false
  }
}

watch(segments, (next) => {
  if (!next.some((segment) => segment.target === props.target)) emit('update:target', next[0]?.target ?? 'exercise')
}, { immediate: true })
</script>

<template>
  <div class="exercise-grading-editor">
    <header class="exercise-grading-header">
      <div class="exercise-grading-segments" role="tablist" aria-label="Segmento evaluable">
        <button v-for="segment in segments" :key="segment.id" type="button" :class="{ active: segment.target === activeDefinition.target }" @click="selectTarget(segment.target)">{{ segment.shortLabel }}</button>
      </div>
      <div class="exercise-grading-score" :class="{ valid: pointsMatch, invalid: !pointsMatch }"><span>{{ formatPoints(assignedPoints) }} / {{ formatPoints(targetPoints) }}</span><small>puntos</small></div>
      <v-spacer />
      <v-btn size="small" variant="tonal" color="secondary" prepend-icon="mdi-auto-fix" :loading="generating" @click="generateWithAi">Completar con IA</v-btn>
      <v-btn size="small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addCriterion">Añadir logro</v-btn>
    </header>

    <div v-if="criteria.length" class="exercise-grading-list">
      <article v-for="(criterion, index) in criteria" :key="criterion.id" class="exercise-grading-card">
        <span class="exercise-grading-number">{{ index + 1 }}</span>
        <v-textarea :model-value="criterion.description" label="Criterio de calificación" placeholder="Acción observable y evaluable" variant="outlined" density="compact" rows="2" auto-grow hide-details @update:model-value="updateCriterion(criterion.id, { description: $event })" />
        <v-text-field :model-value="criterion.points" type="number" min="0" step="0.25" label="Puntos" variant="outlined" density="compact" hide-details @update:model-value="updateCriterion(criterion.id, { points: $event })" />
        <v-btn icon="mdi-delete-outline" size="x-small" rounded="circle" variant="text" color="error" aria-label="Eliminar criterio" @click="removeCriterion(criterion.id)" />
      </article>
    </div>
    <div v-else class="exercise-grading-empty"><v-icon icon="mdi-format-list-checks" size="46" /><strong>Sin criterios de calificación</strong><span>Divide los {{ formatPoints(targetPoints) }} puntos de {{ activeDefinition.label.toLocaleLowerCase('es-ES') }} en logros observables.</span></div>
  </div>
</template>

<style scoped>
.exercise-grading-editor { display:grid; height:100%; min-height:0; grid-template-rows:auto minmax(0,1fr); overflow:hidden; background:#f5f8fc; }
.exercise-grading-header { display:flex; min-height:52px; align-items:center; gap:12px; padding:7px 14px; border-bottom:1px solid #d7e1ec; background:#fff; }
.exercise-grading-segments { display:flex; gap:5px; }
.exercise-grading-segments button { min-width:34px; height:34px; padding:0 10px; border:1px solid #bfd0e2; border-radius:18px; background:#f2f6fb; color:#58708d; font-weight:800; cursor:pointer; }
.exercise-grading-segments button.active { border-color:#3f78b5; background:#3f78b5; color:#fff; }
.exercise-grading-score { display:flex; align-items:baseline; gap:5px; padding:7px 10px; border-radius:10px; background:#edf2f7; color:#657a91; }
.exercise-grading-score.valid { background:#e2f2e8; color:#2f7653; }.exercise-grading-score.invalid { background:#fae9e8; color:#9b443f; }
.exercise-grading-score span { font-weight:850; }.exercise-grading-score small { font-size:.64rem; }
.exercise-grading-list { min-height:0; overflow:auto; padding:12px; }
.exercise-grading-card { display:grid; align-items:center; grid-template-columns:44px minmax(260px,1fr) 155px 36px; gap:12px; margin-bottom:10px; padding:12px; border:1px solid #d5e0ec; border-radius:10px; background:#fff; }
.exercise-grading-number { display:grid; width:36px; height:36px; place-items:center; border-radius:50%; background:#447fb9; color:#fff; font-weight:850; }
.exercise-grading-empty { display:grid; min-height:260px; place-content:center; justify-items:center; gap:8px; padding:24px; color:#7c8da2; text-align:center; }.exercise-grading-empty strong { color:#365d86; }
@media (max-width:900px) { .exercise-grading-header { flex-wrap:wrap; }.exercise-grading-card { grid-template-columns:38px minmax(0,1fr) 110px 32px; } }
</style>
