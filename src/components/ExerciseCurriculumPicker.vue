<script setup>
import { computed } from 'vue'
import MathConceptMap from './MathConceptMap.vue'
import { mathCurriculum, mathSubjects } from '../data/mathCurriculum'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({ course: null, subjectId: null, conceptIds: [] }),
  },
  nodes: { type: Array, required: true },
  subjectSelections: { type: Object, default: () => ({}) },
  exerciseCounts: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const courseItems = computed(() => mathCurriculum.map((row) => row.course))
const subjectItems = computed(() => mathSubjects.filter((subject) => subject.course === props.modelValue.course))
const selectedSubject = computed(() => mathSubjects.find((subject) => subject.id === props.modelValue.subjectId) || null)
const allowedNodeIds = computed(() => props.subjectSelections[props.modelValue.subjectId] || [])

function updateCourse(course) {
  if (course === props.modelValue.course) return
  emit('update:modelValue', { course: course || null, subjectId: null, conceptIds: [] })
}

function updateSubject(subjectId) {
  const subject = mathSubjects.find((item) => item.id === subjectId)
  emit('update:modelValue', {
    course: subject?.course || props.modelValue.course || null,
    subjectId: subject?.id || null,
    conceptIds: [],
  })
}

function updateConcepts(conceptIds) {
  const allowed = new Set(allowedNodeIds.value)
  emit('update:modelValue', {
    course: props.modelValue.course || null,
    subjectId: props.modelValue.subjectId || null,
    conceptIds: [...new Set(conceptIds.filter((id) => allowed.has(id) && id !== 'matematicas'))],
  })
}
</script>

<template>
  <div class="exercise-curriculum-picker">
    <div class="exercise-curriculum-fields">
      <v-select
        :model-value="modelValue.course"
        :items="courseItems"
        label="Curso"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        @update:model-value="updateCourse"
      />
      <v-select
        :model-value="modelValue.subjectId"
        :items="subjectItems"
        item-title="title"
        item-value="id"
        label="Asignatura"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        :disabled="!modelValue.course"
        @update:model-value="updateSubject"
      />
    </div>

    <MathConceptMap
      v-if="selectedSubject"
      class="exercise-curriculum-map"
      :nodes="nodes"
      :active-subject-id="selectedSubject.id"
      :subject-node-ids="allowedNodeIds"
      selection-mode
      :selected-node-ids="modelValue.conceptIds || []"
      :exercise-counts="exerciseCounts"
      :center-title="selectedSubject.title"
      :show-curriculum="false"
      @update-selected-node-ids="updateConcepts"
    />
    <div v-else class="exercise-curriculum-empty">
      <v-icon icon="mdi-chart-donut-variant" size="44" color="primary" />
      <p>Selecciona un curso y una asignatura para mostrar su mapa de contenidos.</p>
    </div>
  </div>
</template>

<style scoped>
.exercise-curriculum-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f7f9fd;
}

.exercise-curriculum-fields {
  display: grid;
  grid-template-columns: minmax(120px, .7fr) minmax(190px, 1.3fr);
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #dce5f1;
  background: #fff;
}

.exercise-curriculum-map {
  flex: 1;
  min-height: 0;
}

.exercise-curriculum-empty {
  display: grid;
  place-content: center;
  justify-items: center;
  flex: 1;
  padding: 28px;
  color: #61728b;
  text-align: center;
}

.exercise-curriculum-empty p {
  max-width: 360px;
  margin: 12px 0 0;
}

@media (max-width: 620px) {
  .exercise-curriculum-fields { grid-template-columns: 1fr; }
}
</style>
