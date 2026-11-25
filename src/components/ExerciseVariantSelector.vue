<script setup>
defineProps({
  modelValue: { type: Number, default: 0 },
  variations: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  showPublication: { type: Boolean, default: false },
  publicationRoot: { type: Boolean, default: false },
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
    <button
      v-for="version in variations.length + 1"
      :key="version - 1"
      type="button"
      class="exercise-variant-option"
      :class="{ 'exercise-variant-option-active': modelValue === version - 1, 'exercise-variant-option-published': showPublication && (version === 1 ? publicationRoot : (variations[version - 2].studentTrainingPublished === true)), 'exercise-variant-option-unpublished': showPublication && !(version === 1 ? publicationRoot : (variations[version - 2].studentTrainingPublished === true)), 'exercise-variant-option-publication-selected': showPublication && modelValue === version - 1 }"
      :title="showPublication ? ((version === 1 ? publicationRoot : (variations[version - 2].studentTrainingPublished === true)) ? 'Publicada para alumnos' : 'Sin publicar') : undefined"
      :aria-label="`${version === 1 ? 'Ejercicio original' : `Variación ${version - 1}`}${showPublication ? ((version === 1 ? publicationRoot : (variations[version - 2].studentTrainingPublished === true)) ? ', publicada' : ', sin publicar') : ''}`"
      :aria-pressed="modelValue === version - 1"
      @click.stop="emit('update:modelValue', version - 1)"
    >{{ version - 1 }}</button>
  </div>
</template>

<style scoped>
.exercise-variant-bar {
  display: flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  padding: 5px 9px;
  border-top: 1px solid rgba(48, 82, 124, .12);
  border-bottom: 1px solid rgba(48, 82, 124, .12);
  background: #f3f7fc;
}

.exercise-variant-option {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
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

.exercise-variant-option-published {
  border-color: transparent;
  background: #7296c4;
  color: #fff;
}
.exercise-variant-option-unpublished {
  border-color: transparent;
  background: #e7ebf0;
  color: #67798b;
}
.exercise-variant-option-published:hover,
.exercise-variant-option-published:focus-visible,
.exercise-variant-option-unpublished:hover,
.exercise-variant-option-unpublished:focus-visible {
  border-color: transparent;
}
.exercise-variant-option-publication-selected.exercise-variant-option-published {
  background: #315f9e;
}
.exercise-variant-option-publication-selected.exercise-variant-option-unpublished {
  background: #c4ceda;
  color: #354c66;
}

.exercise-variant-bar-compact {
  min-height: 27px;
  gap: 3px;
  padding: 2px 8px;
}

.exercise-variant-bar-compact .exercise-variant-option {
  width: 18px;
  height: 18px;
  flex-basis: 18px;
  font-size: .6rem;
}

.exercise-variant-bar-compact .exercise-variant-option:hover,
.exercise-variant-bar-compact .exercise-variant-option:focus-visible {
  transform: none;
}
</style>
