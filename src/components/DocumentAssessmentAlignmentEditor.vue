<script setup>
import { computed, ref, watch } from 'vue'
import lomloeMathLaw from '../data/lomloeMathLaw.json'

const props = defineProps({
  exercises: { type: Array, default: () => [] },
  subjectId: { type: String, default: '' },
})
const emit = defineEmits(['update-alignment'])

const selectedKey = ref('')
const achievements = computed(() => props.exercises.flatMap((exercise) => exercise.achievements || []))
watch(achievements, (items) => {
  if (!items.some((item) => item.key === selectedKey.value)) selectedKey.value = items[0]?.key || ''
}, { immediate: true })
const selected = computed(() => achievements.value.find((item) => item.key === selectedKey.value) || null)
const subjectLaw = computed(() => lomloeMathLaw.subjects?.[props.subjectId] || { specificCompetencies: [], evaluationCriteria: [] })
const competencies = computed(() => subjectLaw.value.specificCompetencies || [])
const competencyById = computed(() => new Map(competencies.value.map((item) => [item.id, item])))
const criteria = computed(() => {
  const nested = competencies.value.flatMap((competency) => (competency.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competency.id })))
  return [...new Map([...(subjectLaw.value.evaluationCriteria || []), ...nested].map((item) => [item.id, item])).values()]
})
const alignment = computed(() => selected.value?.alignment || { criterionIds: [], descriptorEvidence: [], source: 'manual' })
const selectedCriteria = computed({
  get: () => alignment.value.criterionIds || [],
  set: (criterionIds) => update({ ...alignment.value, criterionIds }),
})
const relevantDescriptors = computed(() => {
  const ids = new Set(criteria.value.filter((criterion) => selectedCriteria.value.includes(criterion.id)).flatMap((criterion) => [
    ...(criterion.descriptorIds || []),
    ...(competencyById.value.get(criterion.competenceId)?.descriptorIds || []),
  ]))
  const stage = String(subjectLaw.value.stage || '').toLowerCase().includes('bach') ? 'Bachillerato' : 'ESO'
  return (lomloeMathLaw.global?.operationalDescriptors || []).filter((descriptor) => (!descriptor.stage || descriptor.stage === stage) && (!ids.size || ids.has(descriptor.id)))
})

function update(next) {
  if (!selected.value) return
  emit('update-alignment', selected.value, {
    criterionIds: [...new Set(next.criterionIds || [])],
    descriptorEvidence: next.descriptorEvidence || [],
    source: 'manual',
  })
}

function strength(descriptorId) {
  return alignment.value.descriptorEvidence?.find((item) => item.descriptorId === descriptorId)?.strength || ''
}

function setStrength(descriptorId, value) {
  const descriptorEvidence = (alignment.value.descriptorEvidence || []).filter((item) => item.descriptorId !== descriptorId)
  if (value) descriptorEvidence.push({ descriptorId, strength: value })
  update({ ...alignment.value, descriptorEvidence })
}
</script>

<template>
  <div class="document-alignment-editor">
    <aside>
      <button v-for="achievement in achievements" :key="achievement.key" type="button" :class="{ active: achievement.key === selectedKey }" @click="selectedKey = achievement.key">
        <small>{{ achievement.section }}</small>
        <strong>{{ achievement.description }}</strong>
        <span>{{ Number(achievement.points) || 0 }} pt</span>
      </button>
    </aside>
    <section v-if="selected" class="document-alignment-fields">
      <header><small>{{ selected.section }}</small><strong>{{ selected.description }}</strong></header>
      <v-select
        v-model="selectedCriteria"
        :items="criteria"
        item-title="code"
        item-value="id"
        label="Criterios de evaluación"
        multiple
        chips
        closable-chips
        density="compact"
        variant="outlined"
        :disabled="!criteria.length"
      >
        <template #item="{ props: itemProps, item }"><v-list-item v-bind="itemProps" :subtitle="item.raw.description" /></template>
      </v-select>
      <div class="document-alignment-descriptors">
        <article v-for="descriptor in relevantDescriptors" :key="descriptor.id">
          <div><strong>{{ descriptor.code }}</strong><span>{{ descriptor.description }}</span></div>
          <v-btn-toggle :model-value="strength(descriptor.id)" mandatory="false" density="compact" @update:model-value="setStrength(descriptor.id, $event)">
            <v-btn value="weak" size="x-small">Débil</v-btn><v-btn value="medium" size="x-small">Media</v-btn><v-btn value="strong" size="x-small">Fuerte</v-btn>
          </v-btn-toggle>
        </article>
      </div>
      <p v-if="!criteria.length" class="document-alignment-empty">No hay datos LOMLOE disponibles para esta asignatura.</p>
    </section>
    <div v-else class="document-alignment-empty">El documento no contiene criterios de calificación.</div>
  </div>
</template>

<style scoped>
.document-alignment-editor { display: grid; grid-template-columns: minmax(220px, 30%) 1fr; min-height: 520px; max-height: 72dvh; overflow: hidden; }
aside { overflow-y: auto; border-right: 1px solid rgba(var(--v-border-color), .18); background: #f4f7fb; }
aside button { display: grid; width: 100%; gap: 3px; padding: 12px 14px; border: 0; border-bottom: 1px solid #dbe4ef; background: transparent; color: #36587f; text-align: left; }
aside button.active { background: #315e91; color: #fff; }
aside small, aside span { font-size: .66rem; } aside strong { font-size: .78rem; }
.document-alignment-fields { display: grid; align-content: start; gap: 16px; padding: 20px; overflow-y: auto; }
.document-alignment-fields header { display: grid; gap: 4px; color: #294f78; }
.document-alignment-descriptors { display: grid; gap: 8px; }
.document-alignment-descriptors article { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; padding: 10px; border: 1px solid #d9e3ee; }
.document-alignment-descriptors article > div { display: grid; gap: 2px; }.document-alignment-descriptors span { color: #687b91; font-size: .7rem; }
.document-alignment-empty { place-self: center; color: #73869a; }
@media (max-width: 760px) { .document-alignment-editor { grid-template-columns: 1fr; }.document-alignment-editor aside { max-height: 180px; border-right: 0; border-bottom: 1px solid #dbe4ef; } }
</style>
