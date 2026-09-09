<script setup>
import { computed, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import { loadGlobalLaw, loadSubjectLaw } from '../services/rubricRepository'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import { normalizeExerciseAchievements } from '../utils/exerciseStructure'

const props = defineProps({
  modelValue: { type: Object, required: true },
  target: { type: [String, Number], default: null },
  curriculum: { type: Object, default: () => ({}) },
  subjects: { type: Array, default: () => [] },
  aiModel: { type: String, default: 'google/gemini-3-flash-preview' },
  latex: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'update:target', 'generated'])

const alignmentDialog = ref(false)
const alignmentAchievementId = ref(null)
const loadingLaw = ref(false)
const generating = ref(false)
const globalLaw = ref({ operationalDescriptors: [] })
const subjectLaw = ref({ specificCompetencies: [], evaluationCriteria: [] })
let loadedSubjectId = ''

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueId(prefix = 'achievement') {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

function roundedPoints(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
}

function formatPoints(value) {
  return roundedPoints(value).toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const segments = computed(() => {
  const parts = Array.isArray(props.modelValue?.apartados) ? props.modelValue.apartados : []
  if (parts.length) {
    return parts.map((part, index) => ({
      target: index,
      id: part.id,
      label: `Apartado ${String.fromCharCode(97 + index)}`,
      shortLabel: String.fromCharCode(97 + index),
      points: Number(part.puntuacion) || 0,
      segment: part,
    }))
  }
  return [{
    target: 'exercise',
    id: 'exercise',
    label: 'Ejercicio',
    shortLabel: 'Ejercicio',
    points: Number(props.modelValue?.puntuacion) || 0,
    segment: props.modelValue,
  }]
})

const activeSegmentDefinition = computed(() => (
  segments.value.find((segment) => segment.target === props.target) || segments.value[0]
))
const activeSegment = computed(() => activeSegmentDefinition.value?.segment || props.modelValue)
const achievements = computed(() => Array.isArray(activeSegment.value?.achievements) ? activeSegment.value.achievements : [])
const assignedPoints = computed(() => achievements.value.reduce((total, achievement) => total + roundedPoints(achievement.points), 0))
const targetPoints = computed(() => Number(activeSegmentDefinition.value?.points) || 0)
const pointsMatch = computed(() => Math.abs(assignedPoints.value - targetPoints.value) < 0.001)
const subject = computed(() => props.subjects.find((item) => item.id === props.curriculum?.subjectId))
const specificCompetencies = computed(() => Array.isArray(subjectLaw.value.specificCompetencies) ? subjectLaw.value.specificCompetencies : [])
const competencyById = computed(() => new Map(specificCompetencies.value.map((competency) => [competency.id, competency])))
const evaluationCriteria = computed(() => {
  const topLevel = Array.isArray(subjectLaw.value.evaluationCriteria) ? subjectLaw.value.evaluationCriteria : []
  const nested = specificCompetencies.value.flatMap((competency) => (
    (Array.isArray(competency.criteria) ? competency.criteria : []).map((criterion) => ({
      ...criterion,
      competenceId: criterion.competenceId || competency.id,
      competenceCode: criterion.competenceCode || competency.code,
    }))
  ))
  return [...new Map([...topLevel, ...nested].filter((criterion) => criterion?.id).map((criterion) => [criterion.id, criterion])).values()]
})
const activeAchievement = computed(() => achievements.value.find((achievement) => achievement.id === alignmentAchievementId.value) || null)
const selectedCriterionIds = computed(() => activeAchievement.value?.alignment?.criterionIds || [])
const relevantDescriptors = computed(() => {
  const selectedCriteria = evaluationCriteria.value.filter((criterion) => selectedCriterionIds.value.includes(criterion.id))
  const descriptorIds = new Set(selectedCriteria.flatMap((criterion) => [
    ...(criterion.descriptorIds || []),
    ...(competencyById.value.get(criterion.competenceId)?.descriptorIds || []),
  ]))
  const stage = String(props.curriculum?.course || '').includes('BTO') ? 'Bachillerato' : 'ESO'
  const descriptors = (globalLaw.value.operationalDescriptors || []).filter((descriptor) => !descriptor.stage || descriptor.stage === stage)
  return descriptors.filter((descriptor) => descriptorIds.has(descriptor.id))
})

function selectTarget(target) {
  emit('update:target', target)
}

function updateStructure(mutator) {
  const structure = clone(props.modelValue || {})
  const definition = activeSegmentDefinition.value
  const segment = typeof definition?.target === 'number'
    ? structure.apartados?.[definition.target]
    : structure
  if (!segment) return
  segment.achievements = Array.isArray(segment.achievements) ? segment.achievements : []
  mutator(segment, structure)
  emit('update:modelValue', structure)
}

function addAchievement() {
  const remaining = Math.max(0, roundedPoints(targetPoints.value - assignedPoints.value))
  updateStructure((segment) => {
    segment.achievements.push({
      id: uniqueId(),
      description: '',
      points: remaining,
      alignment: { criterionIds: [], descriptorEvidence: [], source: 'manual' },
    })
  })
}

function updateAchievement(achievementId, patch) {
  updateStructure((segment) => {
    const achievement = segment.achievements.find((item) => item.id === achievementId)
    if (!achievement) return
    Object.assign(achievement, patch)
    if (Object.hasOwn(patch, 'points')) achievement.points = roundedPoints(patch.points)
  })
}

function removeAchievement(achievementId) {
  updateStructure((segment) => {
    segment.achievements = segment.achievements.filter((achievement) => achievement.id !== achievementId)
  })
}

function alignmentSummary(achievement) {
  const criteria = achievement.alignment?.criterionIds?.length || 0
  const evidence = achievement.alignment?.descriptorEvidence?.length || 0
  if (!criteria && !evidence) return 'Vincular'
  return `${criteria} criterio${criteria === 1 ? '' : 's'} · ${evidence} evidencia${evidence === 1 ? '' : 's'}`
}

async function loadLawCatalogs() {
  const subjectId = props.curriculum?.subjectId
  if (!subjectId || (loadedSubjectId === subjectId && evaluationCriteria.value.length)) return
  loadingLaw.value = true
  try {
    const [globalCatalog, subjectCatalog] = await Promise.all([loadGlobalLaw(), loadSubjectLaw(subjectId)])
    globalLaw.value = globalCatalog
    subjectLaw.value = subjectCatalog
    loadedSubjectId = subjectId
  } catch (error) {
    console.error('No se ha podido cargar el catálogo LOMLOE del ejercicio:', error)
    showAppErrorToast('No se ha podido cargar el catálogo LOMLOE.')
  } finally {
    loadingLaw.value = false
  }
}

async function openAlignment(achievementId) {
  if (!props.curriculum?.subjectId) {
    showAppErrorToast('Selecciona primero el curso y la asignatura en la pestaña Contenidos.')
    return
  }
  alignmentAchievementId.value = achievementId
  alignmentDialog.value = true
  await loadLawCatalogs()
}

function updateAlignment(mutator) {
  const achievementId = alignmentAchievementId.value
  updateStructure((segment) => {
    const achievement = segment.achievements.find((item) => item.id === achievementId)
    if (!achievement) return
    achievement.alignment ||= { criterionIds: [], descriptorEvidence: [], source: 'manual' }
    achievement.alignment.criterionIds ||= []
    achievement.alignment.descriptorEvidence ||= []
    mutator(achievement.alignment)
    achievement.alignment.source = 'manual'
    delete achievement.alignment.model
  })
}

function toggleCriterion(criterionId, selected) {
  updateAlignment((alignment) => {
    alignment.criterionIds = selected
      ? [...new Set([...alignment.criterionIds, criterionId])]
      : alignment.criterionIds.filter((id) => id !== criterionId)
    if (!selected) {
      const remainingCriteria = evaluationCriteria.value.filter((criterion) => alignment.criterionIds.includes(criterion.id))
      const allowedDescriptors = new Set(remainingCriteria.flatMap((criterion) => [
        ...(criterion.descriptorIds || []),
        ...(competencyById.value.get(criterion.competenceId)?.descriptorIds || []),
      ]))
      alignment.descriptorEvidence = alignment.descriptorEvidence.filter((evidence) => allowedDescriptors.has(evidence.descriptorId))
    }
  })
}

function evidenceStrength(descriptorId) {
  return activeAchievement.value?.alignment?.descriptorEvidence?.find((item) => item.descriptorId === descriptorId)?.strength || ''
}

function setEvidenceStrength(descriptorId, strength) {
  updateAlignment((alignment) => {
    alignment.descriptorEvidence = alignment.descriptorEvidence.filter((item) => item.descriptorId !== descriptorId)
    if (strength) alignment.descriptorEvidence.push({ descriptorId, strength })
  })
}

async function generateWithAi() {
  if (generating.value) return
  if (!props.curriculum?.subjectId) {
    showAppErrorToast('Selecciona primero el curso y la asignatura en la pestaña Contenidos.')
    return
  }
  const assessableSegments = segments.value.filter((segment) => segment.points > 0 && String(segment.segment?.enunciado || '').trim())
  if (!assessableSegments.length) {
    showAppErrorToast('Asigna una puntuación al ejercicio o a sus apartados antes de desglosar los logros.')
    return
  }
  generating.value = true
  try {
    const callable = httpsCallable(functions, 'suggestExerciseCompetencies', { timeout: 120_000 })
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
    const suggestions = new Map((response.data?.segments || []).map((segment) => [segment.segmentId, segment.achievements]))
    const structure = clone(props.modelValue || {})
    if (Array.isArray(structure.apartados) && structure.apartados.length) {
      structure.apartados.forEach((part) => {
        if (suggestions.has(part.id)) part.achievements = normalizeExerciseAchievements(suggestions.get(part.id))
      })
    } else if (suggestions.has('exercise')) {
      structure.achievements = normalizeExerciseAchievements(suggestions.get('exercise'))
    }
    emit('update:modelValue', structure)
    emit('generated')
  } catch (error) {
    console.error('No se ha podido generar el desglose competencial:', error)
    showAppErrorToast(error?.message || 'No se ha podido generar el desglose competencial con IA.')
  } finally {
    generating.value = false
  }
}

watch(segments, (nextSegments) => {
  if (!nextSegments.some((segment) => segment.target === props.target)) {
    emit('update:target', nextSegments[0]?.target ?? 'exercise')
  }
}, { immediate: true })

watch(() => props.curriculum?.subjectId, () => {
  loadedSubjectId = ''
  subjectLaw.value = { specificCompetencies: [], evaluationCriteria: [] }
})
</script>

<template>
  <div class="exercise-competency-editor">
    <header class="exercise-competency-header">
      <div class="exercise-competency-segments" role="tablist" aria-label="Segmento evaluable">
        <button
          v-for="segment in segments"
          :key="segment.id"
          type="button"
          :class="{ active: segment.target === activeSegmentDefinition.target }"
          @click="selectTarget(segment.target)"
        >
          {{ segment.shortLabel }}
        </button>
      </div>
      <div class="exercise-competency-score" :class="{ valid: pointsMatch, invalid: !pointsMatch }">
        <span>{{ formatPoints(assignedPoints) }} / {{ formatPoints(targetPoints) }}</span>
        <small>puntos</small>
      </div>
      <v-spacer />
      <v-btn size="small" variant="tonal" color="secondary" prepend-icon="mdi-auto-fix" :loading="generating" @click="generateWithAi">
        Completar con IA
      </v-btn>
      <v-btn size="small" variant="text" color="primary" prepend-icon="mdi-plus" @click="addAchievement">Añadir logro</v-btn>
    </header>

    <div v-if="achievements.length" class="exercise-achievement-list">
      <article v-for="(achievement, index) in achievements" :key="achievement.id" class="exercise-achievement-card">
        <span class="exercise-achievement-number">{{ index + 1 }}</span>
        <v-textarea
          :model-value="achievement.description"
          label="Logro atómico"
          placeholder="Acción observable y evaluable"
          variant="outlined"
          density="compact"
          rows="2"
          auto-grow
          hide-details
          @update:model-value="updateAchievement(achievement.id, { description: $event })"
        />
        <v-text-field
          :model-value="achievement.points"
          type="number"
          min="0"
          step="0.25"
          label="Puntos"
          variant="outlined"
          density="compact"
          hide-details
          @update:model-value="updateAchievement(achievement.id, { points: $event })"
        />
        <v-btn class="exercise-achievement-link" size="small" variant="text" prepend-icon="mdi-link-variant" @click="openAlignment(achievement.id)">
          {{ alignmentSummary(achievement) }}
        </v-btn>
        <v-btn icon="mdi-delete-outline" size="x-small" rounded="circle" variant="text" color="error" aria-label="Eliminar logro" @click="removeAchievement(achievement.id)" />
      </article>
    </div>
    <div v-else class="exercise-competency-empty">
      <v-icon icon="mdi-shield-star-outline" size="46" />
      <strong>Sin desglose competencial</strong>
      <span>Divide los {{ targetPoints }} puntos de {{ activeSegmentDefinition.label.toLocaleLowerCase('es-ES') }} en logros observables.</span>
    </div>

    <v-dialog v-model="alignmentDialog" max-width="980" height="min(820px, 90vh)">
      <v-card class="exercise-achievement-dialog">
        <v-card-title>
          <div><small>Vinculación curricular</small><strong>{{ activeAchievement?.description || 'Logro atómico' }}</strong></div>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" aria-label="Cerrar" @click="alignmentDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <div v-if="loadingLaw" class="exercise-competency-loading"><v-progress-circular indeterminate color="primary" /><span>Cargando normativa…</span></div>
          <div v-else-if="!evaluationCriteria.length" class="exercise-competency-loading"><v-icon icon="mdi-bookshelf" size="42" /><span>No hay datos LOMLOE para esta asignatura.</span></div>
          <template v-else>
            <div class="exercise-achievement-law-heading">
              <strong>Criterios de evaluación</strong>
              <span>Selecciona los criterios que este logro permite observar directamente.</span>
            </div>
            <v-expansion-panels variant="accordion" multiple>
              <v-expansion-panel v-for="competency in specificCompetencies" :key="competency.id">
                <v-expansion-panel-title><b>{{ competency.code }}</b>{{ competency.description }}</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-checkbox
                    v-for="criterion in evaluationCriteria.filter((item) => item.competenceId === competency.id)"
                    :key="criterion.id"
                    :model-value="selectedCriterionIds.includes(criterion.id)"
                    color="primary"
                    hide-details
                    @update:model-value="toggleCriterion(criterion.id, $event)"
                  >
                    <template #label><span class="exercise-achievement-criterion"><strong>{{ criterion.code }}</strong>{{ criterion.description }}</span></template>
                  </v-checkbox>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div v-if="selectedCriterionIds.length" class="exercise-achievement-descriptors">
              <div class="exercise-achievement-law-heading"><strong>Descriptores operativos</strong><span>Indica la intensidad de la evidencia producida por este logro.</span></div>
              <div v-for="descriptor in relevantDescriptors" :key="descriptor.id" class="exercise-achievement-descriptor">
                <div><strong>{{ descriptor.code }}</strong><span>{{ descriptor.description }}</span></div>
                <v-btn-toggle :model-value="evidenceStrength(descriptor.id)" density="compact" color="primary" variant="outlined" @update:model-value="setEvidenceStrength(descriptor.id, $event)">
                  <v-btn value="weak">Débil</v-btn><v-btn value="medium">Media</v-btn><v-btn value="strong">Fuerte</v-btn>
                </v-btn-toggle>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-divider />
        <v-card-actions><v-spacer /><v-btn color="primary" variant="flat" @click="alignmentDialog = false">Aceptar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.exercise-competency-editor { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: #f4f7fb; color: #294f7d; }
.exercise-competency-header { display: flex; flex: 0 0 auto; min-height: 46px; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #d8e2ed; background: #fff; }
.exercise-competency-segments { display: flex; align-items: center; gap: 4px; }
.exercise-competency-segments button { min-width: 29px; height: 29px; padding: 0 9px; border: 1px solid #cbd8e7; border-radius: 999px; background: #f3f6fa; color: #617895; font-size: .7rem; font-weight: 800; cursor: pointer; }
.exercise-competency-segments button.active { border-color: #3f70a8; background: #3f70a8; color: #fff; }
.exercise-competency-score { display: flex; align-items: baseline; gap: 3px; padding: 4px 8px; border-radius: 7px; background: #eef2f7; color: #6d7f94; }
.exercise-competency-score span { font-size: .74rem; font-weight: 850; }
.exercise-competency-score small { font-size: .58rem; }
.exercise-competency-score.valid { background: #e5f3eb; color: #327150; }
.exercise-competency-score.invalid { background: #faedf0; color: #a74659; }
.exercise-achievement-list { display: grid; min-height: 0; align-content: start; gap: 8px; overflow: auto; padding: 10px; }
.exercise-achievement-card { display: grid; grid-template-columns: 27px minmax(0, 1fr) 86px minmax(112px, auto) 28px; align-items: center; gap: 8px; padding: 9px; border: 1px solid #d5e0ec; border-radius: 8px; background: #fff; }
.exercise-achievement-number { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 50%; background: #497aad; color: #fff; font-size: .68rem; font-weight: 850; }
.exercise-achievement-link { max-width: 190px; color: #4b6e95; font-size: .65rem; letter-spacing: 0; }
.exercise-competency-empty, .exercise-competency-loading { display: grid; flex: 1; place-content: center; justify-items: center; gap: 7px; padding: 28px; color: #7a8da3; text-align: center; }
.exercise-competency-empty strong { color: #496b91; font-size: .88rem; }
.exercise-competency-empty span { max-width: 340px; font-size: .74rem; }
.exercise-achievement-dialog { height: 100%; }
.exercise-achievement-dialog :deep(.v-card-title) { display: flex; align-items: center; padding: 13px 18px; }
.exercise-achievement-dialog :deep(.v-card-title > div) { display: grid; min-width: 0; gap: 1px; }
.exercise-achievement-dialog :deep(.v-card-title small) { color: #7a8da3; font-size: .65rem; font-weight: 750; text-transform: uppercase; letter-spacing: .07em; }
.exercise-achievement-dialog :deep(.v-card-title strong) { overflow: hidden; color: #294f7d; font-size: .9rem; text-overflow: ellipsis; white-space: nowrap; }
.exercise-achievement-dialog :deep(.v-card-text) { overflow: auto; }
.exercise-achievement-dialog :deep(.v-expansion-panel-title) { gap: 9px; font-size: .78rem; line-height: 1.35; }
.exercise-achievement-dialog :deep(.v-expansion-panel-title b) { flex: 0 0 auto; color: #3f70a8; }
.exercise-achievement-law-heading { display: grid; gap: 2px; margin: 3px 0 11px; }
.exercise-achievement-law-heading strong { color: #315f92; }
.exercise-achievement-law-heading span { color: #7b8da1; font-size: .77rem; }
.exercise-achievement-criterion { display: grid; gap: 2px; padding: 4px 0; color: #526b87; font-size: .8rem; line-height: 1.35; }
.exercise-achievement-descriptors { margin-top: 20px; }
.exercise-achievement-descriptor { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid #e0e7ef; }
.exercise-achievement-descriptor > div { display: grid; gap: 2px; }
.exercise-achievement-descriptor strong { color: #315f92; }
.exercise-achievement-descriptor span { color: #647a92; font-size: .75rem; }
.exercise-achievement-descriptor :deep(.v-btn) { padding-inline: 9px; font-size: .66rem; }
@media (max-width: 760px) {
  .exercise-competency-header { flex-wrap: wrap; }
  .exercise-achievement-card { grid-template-columns: 27px minmax(0, 1fr) 74px 28px; }
  .exercise-achievement-link { grid-column: 2 / 4; justify-self: start; }
  .exercise-achievement-descriptor { grid-template-columns: 1fr; }
}
</style>
