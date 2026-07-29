<script setup>
defineProps({
  modelValue: { type: Number, default: 0 },
  variations: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <div
    v-if="variations.length"
    class="exercise-variant-bar"
    :class="{ 'exercise-variant-bar-compact': compact }"
    aria-label="Versión del ejercicio"
  >
    <span class="exercise-variant-label">Versión</span>
    <button
      v-for="version in variations.length + 1"
      :key="version - 1"
      type="button"
      class="exercise-variant-option"
      :class="{ 'exercise-variant-option-active': modelValue === version - 1 }"
      :aria-label="version === 1 ? 'Ejercicio original' : `Variación ${version - 1}`"
      :aria-pressed="modelValue === version - 1"
      @click.stop="emit('update:modelValue', version - 1)"
    >{{ version - 1 }}</button>
  </div>
</template>

<style scoped>
.exercise-variant-bar {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-top: 1px solid rgba(48, 82, 124, .12);
  border-bottom: 1px solid rgba(48, 82, 124, .12);
  background: #f3f7fc;
}

.exercise-variant-label {
  margin-right: 2px;
  color: #647994;
  font-size: .66rem;
  font-weight: 700;
  letter-spacing: .055em;
  text-transform: uppercase;
}

.exercise-variant-option {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid #aebed2;
  border-radius: 50%;
  outline: 0;
  background: #fff;
  color: #4d6482;
  font-size: .7rem;
  font-weight: 800;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
}

.exercise-variant-option:hover,
.exercise-variant-option:focus-visible {
  border-color: #3f72b7;
  transform: translateY(-1px);
}

.exercise-variant-option:focus-visible {
  box-shadow: 0 0 0 3px rgba(63, 114, 183, .18);
}

.exercise-variant-option-active {
  border-color: #3268ad;
  background: #3f72b7;
  color: #fff;
}

.exercise-variant-bar-compact {
  min-height: 30px;
  gap: 5px;
  padding: 3px 8px;
}

.exercise-variant-bar-compact .exercise-variant-option {
  width: 21px;
  height: 21px;
  font-size: .64rem;
}
</style>
