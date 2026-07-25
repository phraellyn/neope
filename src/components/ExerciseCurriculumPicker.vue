<script setup>
import { computed } from 'vue'
import MathConceptMap from './MathConceptMap.vue'
import { mathSubjects } from '../data/mathCurriculum'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({ course: null, subjectId: null, conceptIds: [], competencial: false }),
  },
  nodes: { type: Array, required: true },
  subjectSelections: { type: Object, default: () => ({}) },
  exerciseCounts: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['update:modelValue'])

const selectedSubject = computed(() => mathSubjects.find((subject) => subject.id === props.modelValue.subjectId) || null)
const allowedNodeIds = computed(() => props.subjectSelections[props.modelValue.subjectId] || [])

function updateSubject(subjectId) {
  const subject = mathSubjects.find((item) => item.id === subjectId)
  emit('update:modelValue', {
    course: subject?.course || null,
    subjectId: subject?.id || null,
    conceptIds: [],
    competencial: Boolean(props.modelValue.competencial),
  })
}

function updateConcepts(conceptIds) {
  const allowed = new Set(allowedNodeIds.value)
  emit('update:modelValue', {
    course: props.modelValue.course || null,
    subjectId: props.modelValue.subjectId || null,
    conceptIds: [...new Set(conceptIds.filter((id) => allowed.has(id) && id !== 'matematicas'))],
    competencial: Boolean(props.modelValue.competencial),
  })
}

function updateCompetencial(competencial) {
  emit('update:modelValue', {
    course: props.modelValue.course || null,
    subjectId: props.modelValue.subjectId || null,
    conceptIds: [...(props.modelValue.conceptIds || [])],
    competencial: Boolean(competencial),
  })
}
</script>

<template>
  <div class="exercise-curriculum-picker">
    <MathConceptMap
      class="exercise-curriculum-map"
      :nodes="nodes"
      :active-subject-id="selectedSubject?.id || null"
      :subject-node-ids="allowedNodeIds"
      selection-mode
      :selected-node-ids="modelValue.conceptIds || []"
      :exercise-counts="exerciseCounts"
      :center-title="selectedSubject?.title || 'Matemáticas'"
      :show-hint="false"
      @select-subject="updateSubject"
      @update-selected-node-ids="updateConcepts"
    />
    <div class="exercise-competency-control">
      <span>Competencial</span>
      <v-switch
        :model-value="Boolean(modelValue.competencial)"
        color="secondary"
        density="compact"
        hide-details
        aria-label="Ejercicio competencial"
        @update:model-value="updateCompetencial"
      />
    </div>
  </div>
</template>

<style scoped>
.exercise-curriculum-picker {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f7f9fd;
}

.exercise-curriculum-map {
  flex: 1;
  min-height: 0;
}

.exercise-competency-control {
  position: absolute;
  z-index: 5;
  right: 16px;
  bottom: 14px;
  display: flex;
  height: 36px;
  align-items: center;
  gap: 9px;
  padding: 3px 5px 3px 13px;
  border: 1px solid #d8e2f0;
  border-radius: 999px;
  background: rgba(255,255,255,.94);
  box-shadow: 0 5px 16px rgba(25,55,95,.12);
  color: #526783;
  font-size: .72rem;
  font-weight: 700;
  backdrop-filter: blur(8px);
}

.exercise-competency-control :deep(.v-switch) {
  flex: 0 0 auto;
}

.exercise-competency-control :deep(.v-selection-control) {
  min-height: 28px;
}
</style>
