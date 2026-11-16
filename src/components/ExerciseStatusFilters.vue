<script setup>
import { computed } from 'vue'
import { nextExerciseFilterState } from '../utils/exerciseSearchFilters'

const props = defineProps({ completeness: { type: String, default: 'all' }, publication: { type: String, default: 'all' }, solution: { type: String, default: 'all' } })
const emit = defineEmits(['update:completeness', 'update:publication', 'update:solution'])
const groups = computed(() => [
  { key: 'completeness', value: props.completeness, states: { all: ['mdi-check-all', 'Integridad: todos'], complete: ['mdi-check-circle-outline', 'Solo completos'], incomplete: ['mdi-alert-circle-outline', 'Solo incompletos'] } },
  { key: 'publication', value: props.publication, states: { all: ['mdi-eye-settings-outline', 'Publicación: todos'], published: ['mdi-eye-check-outline', 'Solo publicados'], unpublished: ['mdi-eye-off-outline', 'Solo sin publicar'] } },
  { key: 'solution', value: props.solution, states: { all: ['mdi-account-switch-outline', 'Autoría de la solución: todas'], ai: ['mdi-robot-outline', 'Solo soluciones de IA'], human: ['mdi-account-outline', 'Solo soluciones humanas'] } },
])
</script>

<template>
  <div class="exercise-map-status-controls" role="group" aria-label="Filtros de ejercicios">
    <v-tooltip v-for="group in groups" :key="group.key" :text="`${group.states[group.value][1]}. Pulsar para cambiar`" location="start">
      <template #activator="{ props: tooltipProps }"><v-btn v-bind="tooltipProps" :icon="group.states[group.value][0]" :class="`status-${group.value}`" class="exercise-map-status-button" variant="text" :aria-label="`${group.states[group.value][1]}. Pulsar para cambiar`" @click="emit(`update:${group.key}`, nextExerciseFilterState(group.key, group.value))" /></template>
    </v-tooltip>
  </div>
</template>
