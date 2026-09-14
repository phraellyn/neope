<script setup>
import { computed, ref, watch } from 'vue'
import DocumentAssessmentMatrix from './DocumentAssessmentMatrix.vue'
import { loadDocumentAssessmentExercises } from '../services/documentAssessmentLoader'
import {
  createRubricAssessment,
  rubricRangeValues,
  setRubricCategoryScore,
} from '../utils/rubricAssessment'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  item: { type: Object, default: null },
  student: { type: Object, default: null },
  result: { type: [Object, String, Number], default: null },
})

const emit = defineEmits(['update:modelValue', 'save'])
const localResult = ref(null)
const exercises = ref([])
const loading = ref(false)
const changed = ref(false)
// La matriz no depende del alumno, solo del documento evaluable. Mantener una
// única matriz activa evita reconstruirla y volver a montar sus PDF al pasar
// de un alumno a otro en el aula, sin retener recursos de documentos antiguos.
let activeDocumentMatrix = null
const dialog = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const isRubric = computed(() => Boolean(props.item?.rubric))
const isDocument = computed(() => Boolean(props.item?.documentAssessment))
const selectedAchievementIds = computed(() => new Set(localResult.value?.selectedAchievementIds || []))
const total = computed(() => Number(localResult.value?.total) || 0)

const clone = (value) => value === undefined || value === null ? null : JSON.parse(JSON.stringify(value))

function documentMatrixKey(item) {
  const assessment = item?.documentAssessment || {}
  return assessment.documentId ? `${assessment.documentId}:${item?.id || ''}` : ''
}

async function initialize() {
  changed.value = false
  if (isRubric.value) {
    exercises.value = []
    localResult.value = createRubricAssessment(
      props.item.rubric,
      props.result?.type === 'rubric' ? clone(props.result) : null,
    )
    return
  }
  if (isDocument.value) {
    localResult.value = props.result?.type === 'document'
      ? clone(props.result)
      : { type: 'document', total: 0, selectedAchievementIds: [], updatedAt: new Date().toISOString() }
    const matrixKey = documentMatrixKey(props.item)
    if (matrixKey && activeDocumentMatrix?.key === matrixKey) {
      // No vaciamos `exercises`: si Vuetify conserva el diálogo montado, los
      // visores PDF permanecen intactos; si no, al menos reutilizan la matriz.
      exercises.value = activeDocumentMatrix.exercises
      return
    }
    exercises.value = []
    loading.value = true
    try {
      const loadedExercises = await loadDocumentAssessmentExercises(props.item)
      activeDocumentMatrix = { key: matrixKey, exercises: loadedExercises }
      exercises.value = loadedExercises
    } catch (error) {
      showAppErrorToast(error?.message || 'No se ha podido abrir la matriz de evaluación.')
      dialog.value = false
    } finally {
      loading.value = false
    }
  }
}

function categoryScore(category) {
  return localResult.value?.categories?.[category.id] || null
}

function chooseCategoryScore(category, value) {
  if (!localResult.value) return
  setRubricCategoryScore(localResult.value, category, value)
  changed.value = true
}

function toggleAchievement(achievement) {
  if (!localResult.value) return
  const selected = new Set(localResult.value.selectedAchievementIds || [])
  if (selected.has(achievement.key)) selected.delete(achievement.key)
  else selected.add(achievement.key)
  localResult.value.selectedAchievementIds = [...selected]
  const allAchievements = exercises.value.flatMap((exercise) => exercise.achievements || [])
  localResult.value.total = allAchievements.reduce((sum, candidate) => (
    selected.has(candidate.key) ? sum + (Number(candidate.points) || 0) : sum
  ), 0)
  localResult.value.updatedAt = new Date().toISOString()
  changed.value = true
}

function close() {
  if (localResult.value && (changed.value || !props.result || typeof props.result !== 'object')) {
    emit('save', clone(localResult.value))
  }
  dialog.value = false
}

watch(() => props.modelValue, (open) => {
  if (open) void initialize()
})
</script>

<template>
  <v-dialog v-model="dialog" :max-width="isDocument ? 1500 : 1120" width="calc(100% - 24px)" height="calc(100dvh - 28px)" persistent>
    <v-card class="student-assessment-dialog">
      <v-card-title class="student-assessment-title">
        <div>
          <small>{{ item?.nombre }}</small>
          <strong>{{ isRubric ? item?.rubric?.title : student?.nombre || student?.nombreCorto || student?.id }}</strong>
          <span v-if="isRubric">{{ student?.nombre || student?.nombreCorto || student?.id }}</span>
        </div>
        <div class="student-assessment-total">
          <span>{{ isDocument ? 'Nota' : 'Total' }}</span>
          <strong>{{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(total) }}<template v-if="isDocument"> / {{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(Number(item?.documentAssessment?.maxPoints) || 0) }}</template></strong>
        </div>
        <v-btn icon="mdi-close" rounded="circle" variant="text" aria-label="Cerrar evaluación" @click="close" />
      </v-card-title>
      <v-divider />

      <v-card-text v-if="loading" class="student-assessment-loading">
        <v-progress-circular indeterminate color="primary" />
        <span>Cargando instrumento…</span>
      </v-card-text>

      <v-card-text v-else-if="isRubric && localResult" class="student-rubric-categories">
        <article v-for="(category, categoryIndex) in item.rubric.categories" :key="category.id" class="student-rubric-category">
          <header><span>{{ categoryIndex + 1 }}</span><div><strong>{{ category.title }}</strong><small>{{ categoryScore(category)?.points ?? 0 }} puntos</small></div></header>
          <div v-if="category.type === 'range'" class="student-rubric-range">
            <p>{{ category.range.description }}</p>
            <div class="student-rubric-buttons">
              <button v-for="points in rubricRangeValues(category)" :key="points" type="button" :class="{ selected: categoryScore(category)?.points === points }" @click="chooseCategoryScore(category, points)">{{ points }}</button>
            </div>
          </div>
          <div v-else class="student-rubric-levels">
            <button v-for="level in category.levels" :key="level.id" type="button" :class="{ selected: categoryScore(category)?.levelId === level.id }" @click="chooseCategoryScore(category, level.id)">
              <span>{{ level.points }} pt</span><strong>{{ level.description }}</strong>
            </button>
          </div>
        </article>
      </v-card-text>

      <v-card-text v-else-if="isDocument" class="student-document-matrix">
        <DocumentAssessmentMatrix
          :exercises="exercises"
          :selected-achievement-ids="selectedAchievementIds"
          :title="''"
          selectable
          @toggle-achievement="toggleAchievement"
        />
      </v-card-text>

      <v-divider />
      <v-card-actions class="px-6 py-3"><v-spacer /><v-btn color="primary" variant="flat" @click="close">Cerrar</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.student-assessment-dialog { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; }
.student-assessment-title { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 16px; color: #315f94; }
.student-assessment-title > div:first-child { display: grid; min-width: 0; gap: 1px; }
.student-assessment-title small, .student-assessment-title span { color: #7a8ea7; font-size: .73rem; }
.student-assessment-total { display: grid; justify-items: end; }
.student-assessment-total span { font-size: .66rem; text-transform: uppercase; }
.student-assessment-loading { display: grid; flex: 1; place-content: center; justify-items: center; gap: 10px; }
.student-rubric-categories { min-height: 0; flex: 1; overflow: auto; display: grid; align-content: start; gap: 10px; padding: 14px; }
.student-rubric-category { display: grid; gap: 10px; padding: 12px; border: 1px solid #d7e1ed; border-radius: 7px; }
.student-rubric-category > header { display: flex; align-items: center; gap: 10px; color: #315f94; }
.student-rubric-category > header > span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: #477bb4; }
.student-rubric-category > header div { display: grid; }
.student-rubric-category small { color: #7c8fa0; }
.student-rubric-range { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.student-rubric-range p { margin: 0; }
.student-rubric-buttons, .student-rubric-levels { display: flex; flex-wrap: wrap; gap: 7px; }
.student-rubric-buttons button { min-width: 34px; height: 34px; border: 1px solid #bdccdc; border-radius: 17px; color: #315f94; background: #f3f7fa; }
.student-rubric-levels button { flex: 1 1 180px; min-height: 62px; display: grid; gap: 4px; padding: 9px; border: 1px solid #cbd8e6; border-radius: 7px; color: #466688; background: #f7f9fc; text-align: left; }
.student-rubric-buttons button.selected, .student-rubric-levels button.selected { border-color: #315f94; color: #fff; background: #315f94; }
.student-rubric-levels button span { font-size: .7rem; font-weight: 800; }
.student-document-matrix { min-height: 0; flex: 1; padding: 0; overflow: hidden; }
@media (max-width: 700px) { .student-assessment-title { gap: 7px; padding-inline: 10px; } .student-rubric-range { grid-template-columns: 1fr; } }
</style>
