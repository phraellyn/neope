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
    <button
      type="button"
      class="exercise-competency-control"
      :class="{ 'exercise-competency-control-active': Boolean(modelValue.competencial) }"
      :aria-pressed="Boolean(modelValue.competencial)"
      @click="updateCompetencial(!modelValue.competencial)"
    >Competencial</button>
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
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0 15px;
  border: 1px solid #d8e2f0;
  border-radius: 999px;
  outline: 0;
  background: rgba(240,244,250,.9);
  box-shadow: 0 4px 12px rgba(25,55,95,.08);
  color: #6f7e92;
  opacity: .56;
  font-size: .72rem;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: opacity .16s ease, color .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
}

.exercise-competency-control:hover,
.exercise-competency-control:focus-visible {
  opacity: .82;
}

.exercise-competency-control:focus-visible {
  box-shadow: 0 0 0 3px rgba(180,63,134,.2), 0 5px 16px rgba(25,55,95,.12);
}

.exercise-competency-control-active {
  border-color: #983373;
  background: #b43f86;
  box-shadow: 0 6px 17px rgba(152,51,115,.25);
  color: #fff;
  opacity: 1;
}
</style>
