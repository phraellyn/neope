<script setup>
import MathText from './MathText.vue'
import { computed, ref } from 'vue'
import ExercisePdfPreview from './ExercisePdfPreview.vue'
import lomloeMathLaw from '../data/lomloeMathLaw.json'
import { criterionStrength } from '../utils/criterionEvidence'

const props = defineProps({
  exercises: { type: Array, default: () => [] },
  selectable: { type: Boolean, default: false },
  selectedAchievementIds: { type: [Array, Set], default: () => [] },
  title: { type: String, default: 'Matriz de evaluación' },
  subtitle: { type: String, default: '' },
  badge: { type: String, default: '' },
  feedback: { type: Object, default: () => ({}) },
  feedbackEditable: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle-achievement', 'update-feedback'])
const scrollContainer = ref(null)

function scrollToExercise(exerciseIndex, rowKey = null) {
  const container = scrollContainer.value
  const exercise = container?.querySelector(`[data-matrix-exercise="${Number(exerciseIndex)}"]`)
  if (!container || !exercise) return
  const row = rowKey === null ? null : [...exercise.querySelectorAll('[data-matrix-row]')].find((element) => element.dataset.matrixRow === String(rowKey))
  if (rowKey !== null && !row) return
  const target = row || exercise
  const stickyHeight = row ? exercise.querySelector('header')?.offsetHeight || 0 : 0
  const top = container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top - stickyHeight
  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

defineExpose({ scrollToExercise })

function sectionFeedback(key) {
  return (props.feedback?.sections || []).find((entry) => entry.key === key)?.text || ''
}

const strengthLabel = Object.freeze({ weak: 'Evidencia débil', medium: 'Evidencia media', strong: 'Evidencia fuerte' })
const subjectLaws = Object.values(lomloeMathLaw.subjects || {})
const competencyById = new Map(subjectLaws
  .flatMap((subject) => subject.specificCompetencies || [])
  .filter((competency) => competency?.id)
  .map((competency) => [competency.id, competency]))
const criterionById = new Map(subjectLaws
  .flatMap((subject) => [
    ...(subject.evaluationCriteria || []),
    ...(subject.specificCompetencies || []).flatMap((competency) => (
      (competency.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competency.id }))
    )),
  ])
  .filter((criterion) => criterion?.id)
  .map((criterion) => [criterion.id, criterion]))
const descriptorById = new Map((lomloeMathLaw.global?.operationalDescriptors || [])
  .filter((descriptor) => descriptor?.id)
  .map((descriptor) => [descriptor.id, descriptor]))
const alignmentCache = new WeakMap()

const selectedIds = computed(() => props.selectedAchievementIds instanceof Set
  ? props.selectedAchievementIds
  : new Set(props.selectedAchievementIds || []))
const hasHeading = computed(() => Boolean(props.title || props.subtitle || props.badge))

function isSelected(achievement) {
  return selectedIds.value.has(achievement.key)
}

function fallbackReferenceCode(id, type) {
  const value = String(id || '')
  if (type === 'criterion') {
    const match = value.match(/-cr-(\d+)-(\d+)$/i)
    if (match) return `${match[1]}.${match[2]}`
  }
  return value.split('-').at(-1)?.toUpperCase() || value
}

function achievementAlignment(achievement) {
  if (achievement && alignmentCache.has(achievement)) return alignmentCache.get(achievement)
  const alignment = achievement?.alignment || {}
  const evidence = (alignment.descriptorEvidence || []).map((item) => {
    const descriptor = descriptorById.get(item.descriptorId)
    return {
      id: item.descriptorId,
      code: descriptor?.code || fallbackReferenceCode(item.descriptorId, 'descriptor'),
      description: descriptor?.description || '',
      strength: item.strength || '',
    }
  })
  const criteria = (alignment.criterionIds || []).map((criterionId) => {
    const criterion = criterionById.get(criterionId)
    const competency = competencyById.get(criterion?.competenceId)
    const descriptorIds = [...new Set([...(criterion?.descriptorIds || []), ...(competency?.descriptorIds || [])])]
    return {
      id: criterionId,
      code: criterion?.code || fallbackReferenceCode(criterionId, 'criterion'),
      description: criterion?.description || '',
      strength: criterionStrength(alignment, criterionId, descriptorIds) || 'medium',
    }
  })
  const result = { criteria, evidence }
  if (achievement && typeof achievement === 'object') alignmentCache.set(achievement, result)
  return result
}
</script>

<template>
  <section class="assessment-matrix" :class="{ 'without-heading': !hasHeading }">
    <header v-if="hasHeading" class="assessment-matrix-heading">
      <div>
        <v-icon icon="mdi-table-check" size="21" />
        <span>
          <strong>{{ title }}</strong>
          <small v-if="subtitle">{{ subtitle }}</small>
        </span>
      </div>
      <strong v-if="badge">{{ badge }}</strong>
    </header>
    <div class="assessment-matrix-grid assessment-matrix-columns">
      <strong>Resolución</strong><strong>Logros</strong>
    </div>
    <div ref="scrollContainer" class="assessment-matrix-scroll">
      <div v-if="feedbackEditable" class="assessment-matrix-general-feedback">
        <v-textarea :model-value="feedback?.general || ''" label="Comentario general del examen" placeholder="Escribe aquí tus observaciones para el alumno" variant="outlined" density="compact" rows="2" auto-grow maxlength="4000" hide-details @update:model-value="value => emit('update-feedback', { text: value })" />
      </div>
      <article v-for="(exercise, exerciseIndex) in exercises" :key="`${exerciseIndex}:${exercise.key || exercise.exerciseId}`" :data-matrix-exercise="exerciseIndex" class="assessment-matrix-exercise">
        <header>{{ exercise.label }}</header>
        <div v-for="(row, rowIndex) in exercise.rows" :key="row.key" :data-matrix-row="row.key" class="assessment-matrix-grid assessment-matrix-row">
          <section class="assessment-matrix-pdf">
            <small class="assessment-matrix-row-label"><span>{{ exercise.label }}</span><span aria-hidden="true">|</span><span>{{ row.label }}</span></small>
            <ExercisePdfPreview v-if="row.pdf" :src="row.pdf" :title="`${exercise.label}, ${row.label}`" thumbnail />
            <span v-else class="assessment-matrix-empty">Sin PDF disponible</span>
          </section>
          <section class="assessment-matrix-achievements" :class="{ blank: row.kind === 'statement' }">
            <template v-if="row.kind !== 'statement'">
              <template v-if="selectable">
                <button
                  v-for="achievement in row.achievements"
                  :key="achievement.key"
                  type="button"
                  :class="{ selected: isSelected(achievement) }"
                  :aria-pressed="isSelected(achievement)"
                  @click="emit('toggle-achievement', achievement)"
                >
                  <span class="assessment-matrix-achievement-copy">
                    <strong><MathText :text="achievement.description" /></strong>
                    <span v-if="achievementAlignment(achievement).criteria.length || achievementAlignment(achievement).evidence.length" class="assessment-matrix-alignment">
                      <span v-if="achievementAlignment(achievement).criteria.length" class="assessment-matrix-reference-group">
                        <small>Criterios</small>
                        <em
                          v-for="criterion in achievementAlignment(achievement).criteria"
                          :key="criterion.id"
                          class="assessment-matrix-reference"
                          :class="criterion.strength ? `strength-${criterion.strength}` : 'strength-neutral'"
                          :title="[criterion.description, criterion.strength ? strengthLabel[criterion.strength] : 'Sin fuerza definida'].filter(Boolean).join(' · ')"
                        >{{ criterion.code }}</em>
                      </span>
                      <span v-if="achievementAlignment(achievement).evidence.length" class="assessment-matrix-reference-group">
                        <small>Descriptores</small>
                        <em
                          v-for="descriptor in achievementAlignment(achievement).evidence"
                          :key="descriptor.id"
                          class="assessment-matrix-reference"
                          :class="`strength-${descriptor.strength}`"
                          :title="[descriptor.description, strengthLabel[descriptor.strength]].filter(Boolean).join(' · ')"
                        >{{ descriptor.code }}</em>
                      </span>
                    </span>
                  </span>
                  <b>{{ achievement.points }} pt</b>
                </button>
              </template>
              <template v-else>
                <div v-for="achievement in row.achievements" :key="achievement.key" class="assessment-matrix-achievement">
                  <span class="assessment-matrix-achievement-copy">
                    <strong><MathText :text="achievement.description" /></strong>
                    <span v-if="achievementAlignment(achievement).criteria.length || achievementAlignment(achievement).evidence.length" class="assessment-matrix-alignment">
                      <span v-if="achievementAlignment(achievement).criteria.length" class="assessment-matrix-reference-group">
                        <small>Criterios</small>
                        <em
                          v-for="criterion in achievementAlignment(achievement).criteria"
                          :key="criterion.id"
                          class="assessment-matrix-reference"
                          :class="criterion.strength ? `strength-${criterion.strength}` : 'strength-neutral'"
                          :title="[criterion.description, criterion.strength ? strengthLabel[criterion.strength] : 'Sin fuerza definida'].filter(Boolean).join(' · ')"
                        >{{ criterion.code }}</em>
                      </span>
                      <span v-if="achievementAlignment(achievement).evidence.length" class="assessment-matrix-reference-group">
                        <small>Descriptores</small>
                        <em
                          v-for="descriptor in achievementAlignment(achievement).evidence"
                          :key="descriptor.id"
                          class="assessment-matrix-reference"
                          :class="`strength-${descriptor.strength}`"
                          :title="[descriptor.description, strengthLabel[descriptor.strength]].filter(Boolean).join(' · ')"
                        >{{ descriptor.code }}</em>
                      </span>
                    </span>
                  </span>
                  <b>{{ achievement.points }} pt</b>
                </div>
              </template>
              <span v-if="!row.achievements.length" class="assessment-matrix-empty">No hay logros definidos.</span>
              <v-textarea v-if="feedbackEditable" :model-value="sectionFeedback(row.feedbackKey)" :label="`Comentario · ${exercise.label} | ${row.label}`" placeholder="Observaciones para el alumno" variant="outlined" density="compact" rows="1" auto-grow maxlength="4000" hide-details class="assessment-matrix-feedback" @update:model-value="value => emit('update-feedback', { key: row.feedbackKey, exerciseLabel: exercise.label, sectionLabel: row.label, exerciseOrder: exercise.order, sectionOrder: rowIndex, text: value })" />
            </template>
          </section>
        </div>
      </article>
      <div v-if="!exercises.length" class="assessment-matrix-empty standalone">El documento no contiene ejercicios disponibles.</div>
    </div>
  </section>
</template>

<style scoped>
.assessment-matrix { display: grid; width: 100%; height: 100%; min-height: 0; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; background: #f3f6fa; }
.assessment-matrix.without-heading { grid-template-rows: auto minmax(0, 1fr); }
.assessment-matrix-heading { display: flex; min-width: 0; min-height: 50px; align-items: center; justify-content: space-between; gap: 16px; padding: 7px 14px; border-bottom: 1px solid #d3deea; background: #fff; color: #315981; }
.assessment-matrix-heading > div { display: flex; min-width: 0; align-items: center; gap: 9px; }
.assessment-matrix-heading span { display: grid; min-width: 0; gap: 1px; }
.assessment-matrix-heading strong { font-size: .76rem; }
.assessment-matrix-heading small { color: #7d8ea3; font-size: .62rem; }
.assessment-matrix-grid { display: grid; min-width: 720px; grid-template-columns: minmax(300px, 1fr) minmax(340px, 1fr); }
.assessment-matrix-columns { border-bottom: 1px solid #cbd8e7; background: #e7eef7; color: #365b84; }
.assessment-matrix-columns > strong { padding: 8px 12px; border-left: 1px solid #d3deeb; font-size: .66rem; letter-spacing: .045em; text-align: center; text-transform: uppercase; }
.assessment-matrix-columns > strong:first-child { border-left: 0; }
.assessment-matrix-scroll { min-height: 0; overflow: auto; }
.assessment-matrix-general-feedback { min-width: 720px; padding: 12px; background: #fff; border-bottom: 5px solid #dce5ef; }
.assessment-matrix-feedback { margin-top: 4px; }
.assessment-matrix-exercise { min-width: 720px; border-bottom: 5px solid #dce5ef; background: #fff; }
.assessment-matrix-exercise > header { position: sticky; z-index: 1; top: 0; padding: 6px 12px; border-bottom: 1px solid #dce5ef; background: #f8fafc; color: #385d86; font-size: .69rem; font-weight: 800; }
.assessment-matrix-row { border-bottom: 1px solid #dce5ef; }
.assessment-matrix-row:last-child { border-bottom: 0; }
.assessment-matrix-row > section { min-width: 0; padding: 8px; border-left: 1px solid #dce5ef; }
.assessment-matrix-row > section:first-child { border-left: 0; }
.assessment-matrix-pdf { display: grid; align-content: start; gap: 6px; background: #eef2f7; }
.assessment-matrix-row-label { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; color: #607c9b; font-size: .57rem; font-weight: 800; letter-spacing: .035em; text-transform: uppercase; }
.assessment-matrix-row-label > span:first-child { font-weight: 400; }
.assessment-matrix-pdf :deep(.exercise-pdf-preview) { min-height: 110px; border-radius: 5px; background: #fff; }
.assessment-matrix-achievements { display: grid; align-content: start; gap: 6px; background: #fff; }
.assessment-matrix-achievements:not(.blank) { padding-top: calc(8px + .7rem + 6px); }
.assessment-matrix-achievements.blank { min-height: 90px; background: #fbfcfe; }
.assessment-matrix-achievement,
.assessment-matrix-achievements button { display: flex; width: 100%; min-height: 45px; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 9px; border: 1px solid #d6e0eb; border-radius: 7px; background: #f8fafc; color: #506b87; font: inherit; text-align: left; }
.assessment-matrix-achievements button { outline: 0; cursor: pointer; }
.assessment-matrix-achievements button:hover { border-color: #85a4c6; background: #f1f6fb; }
.assessment-matrix-achievements button.selected { border-color: #315f94; background: #315f94; color: #fff; }
.assessment-matrix-achievements button:focus-visible { box-shadow: 0 0 0 3px rgba(49,95,148,.18); }
.assessment-matrix-achievement > span,
.assessment-matrix-achievements button > span { display: grid; min-width: 0; gap: 2px; }
.assessment-matrix-achievement-copy { gap: 5px !important; }
.assessment-matrix-achievement strong,
.assessment-matrix-achievements button strong { font-size: .68rem; line-height: 1.3; }
.assessment-matrix-achievement b,
.assessment-matrix-achievements button b { flex: 0 0 auto; padding: 4px 6px; border-radius: 5px; background: #e3ecf6; color: #315f94; font-size: .61rem; }
.assessment-matrix-achievements button.selected b { background: #fff; }
.assessment-matrix-alignment { display: flex !important; min-width: 0; flex-wrap: wrap; align-items: center; gap: 4px 7px !important; }
.assessment-matrix-reference-group { display: inline-flex !important; min-width: 0; flex-wrap: wrap; align-items: center; gap: 3px !important; }
.assessment-matrix-reference-group small { margin-right: 1px; color: #75889d; font-size: .53rem; font-weight: 750; letter-spacing: .025em; text-transform: uppercase; }
.assessment-matrix-reference { display: inline-flex; min-height: 18px; align-items: center; padding: 1px 5px; border-radius: 9px; font-size: .54rem; font-style: normal; font-weight: 850; line-height: 1; }
.assessment-matrix-reference.strength-neutral { background: #e4eaf1; color: #61738a; }
.assessment-matrix-reference.strength-weak { background: #d9efdf; color: #356346; }
.assessment-matrix-reference.strength-medium { background: #78b98d; color: #153f25; }
.assessment-matrix-reference.strength-strong { background: #286a42; color: #fff; }
.assessment-matrix-achievements button.selected .assessment-matrix-reference-group small { color: rgba(255,255,255,.74); }
.assessment-matrix-achievements button.selected .assessment-matrix-reference.strength-neutral { background: rgba(255,255,255,.2); color: #fff; }
.assessment-matrix-empty { display: grid; min-height: 80px; place-items: center; color: #8796a9; font-size: .68rem; text-align: center; }
.assessment-matrix-empty.standalone { min-height: 220px; }

@media (max-width: 800px) {
  .assessment-matrix-grid,
  .assessment-matrix-exercise { min-width: 620px; }
  .assessment-matrix-grid { grid-template-columns: minmax(260px, .9fr) minmax(320px, 1.1fr); }
}
</style>
