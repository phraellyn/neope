<script setup>
import { computed } from 'vue'
import ExercisePdfPreview from './ExercisePdfPreview.vue'
import ExerciseFullPdfPreview from './ExerciseFullPdfPreview.vue'
import ExerciseVariantSelector from './ExerciseVariantSelector.vue'

defineOptions({ name: 'DocumentQueueChildren' })

const props = defineProps({
  blocks: { type: Array, default: () => [] },
  tools: { type: Array, default: () => [] },
  exercises: { type: Array, default: () => [] },
  mainPdf: { type: Function, required: true },
  fullPdf: { type: Function, required: true },
  segmented: { type: Function, required: true },
  apartados: { type: Function, required: true },
  apartadoPdf: { type: Function, required: true },
  metrics: { type: Function, required: true },
  containerId: { type: String, required: true },
})

const emit = defineEmits(['drag-start', 'drop-block', 'remove', 'argument-change', 'metric-change', 'version-change', 'toggle-view'])
const toolsById = computed(() => new Map(props.tools.map((tool) => [tool.id, tool])))
const exercisesById = computed(() => new Map(props.exercises.map((exercise) => [exercise.id, exercise])))

function toolFor(block) {
  return toolsById.value.get(block?.toolId) || null
}

function exerciseTitle(block) {
  const exercise = exerciseFor(block)
  return exercise?.titulo || exercise?.info || exercise?.curriculum?.subjectTitle || 'Ejercicio'
}

function exerciseFor(block) {
  return block?.snapshot || exercisesById.value.get(block?.exerciseId) || null
}

</script>

<template>
  <div
    class="document-tool-children"
    @dragover.prevent
    @drop.stop="emit('drop-block', $event, null, containerId)"
  >
    <div v-if="!blocks.length" class="document-tool-children-empty">Arrastra aquí ejercicios u otras herramientas.</div>
    <article
      v-for="block in blocks"
      :key="block.blockId"
      class="document-tool-child"
      draggable="true"
      @dragstart.stop="emit('drag-start', $event, block)"
      @dragover.prevent
      @drop.stop="emit('drop-block', $event, block.blockId, containerId)"
    >
      <header :class="{ 'document-tool-child-header--variants': block.type !== 'tool' && exerciseFor(block)?.variaciones?.length }">
        <ExerciseVariantSelector v-if="block.type !== 'tool'" :model-value="block.version || 0" :variations="exerciseFor(block)?.variaciones || []" compact class="document-child-variants" @update:model-value="emit('version-change', block, $event)" />
        <v-icon :icon="block.type === 'tool' ? (toolFor(block)?.icon || 'mdi-tools') : 'mdi-file-document-outline'" size="15" />
        <strong>{{ block.type === 'tool' ? (toolFor(block)?.label || 'Herramienta') : exerciseTitle(block) }}</strong>
        <v-spacer />
        <v-btn v-if="block.type !== 'tool'" :icon="segmented(block) ? 'mdi-file-document-outline' : 'mdi-view-split-horizontal'" size="x-small" density="compact" variant="text" :aria-label="segmented(block) ? 'Mostrar enunciado completo' : 'Mostrar apartados y puntuaciones'" :title="segmented(block) ? 'Mostrar enunciado completo' : 'Mostrar apartados y puntuaciones'" :aria-pressed="segmented(block)" @click.stop="emit('toggle-view', block)" />
        <v-btn icon="mdi-close" size="x-small" density="compact" rounded="circle" variant="text" color="error" aria-label="Quitar bloque" @click.stop="emit('remove', block)" />
      </header>
      <div v-if="block.type === 'tool' && (toolFor(block)?.arguments || []).length" class="document-tool-child-arguments">
        <v-text-field
          v-for="argument in toolFor(block).arguments"
          :key="argument.key"
          :model-value="block.args?.[argument.key] ?? argument.default ?? ''"
          :type="argument.type === 'number' ? 'number' : 'text'"
          :label="argument.label"
          :min="argument.min"
          :max="argument.max"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="emit('argument-change', block, argument.key, $event)"
        />
      </div>
      <div v-if="block.type !== 'tool'" class="document-tool-child-exercise">
        <template v-if="!segmented(block)"><ExerciseFullPdfPreview v-if="fullPdf(block)" :src="fullPdf(block)" title="Enunciado completo del ejercicio" /><div v-else class="document-tool-child-no-pdf">PDF completo no disponible</div></template>
        <section v-for="(part, partIndex) in segmented(block) ? [null, ...apartados(block)] : []" :key="part?.id || partIndex" class="document-tool-child-part">
          <div class="document-tool-child-metrics">
            <strong>{{ partIndex ? `${String.fromCharCode(96 + partIndex)}.` : (apartados(block).length ? 'Total' : 'Ejercicio') }}</strong>
            <label>Puntos<input :value="partIndex ? (metrics(block).apartados?.[partIndex - 1]?.puntuacion || 0) : metrics(block).puntuacion" type="number" min="0" step="0.25" :disabled="!partIndex && apartados(block).length > 0" @change="emit('metric-change', block, 'puntuacion', $event.target.value, partIndex ? partIndex - 1 : null)" /></label>
            <label>Minutos<input :value="partIndex ? (metrics(block).apartados?.[partIndex - 1]?.tiempo || 0) : metrics(block).tiempo" type="number" min="0" step="1" :disabled="!partIndex && apartados(block).length > 0" @change="emit('metric-change', block, 'tiempo', $event.target.value, partIndex ? partIndex - 1 : null)" /></label>
          </div>
          <ExercisePdfPreview v-if="partIndex ? apartadoPdf(block, partIndex - 1) : mainPdf(block)" :src="partIndex ? apartadoPdf(block, partIndex - 1) : mainPdf(block)" :title="partIndex ? `Apartado ${String.fromCharCode(96 + partIndex)}` : 'Enunciado del ejercicio'" crop-bottom thumbnail />
          <div v-else class="document-tool-child-no-pdf">PDF pendiente</div>
        </section>
      </div>
      <DocumentQueueChildren
        v-if="block.type === 'tool' && toolFor(block)?.kind === 'environment'"
        :blocks="block.children || []"
        :tools="tools"
        :exercises="exercises"
        :main-pdf="mainPdf"
        :full-pdf="fullPdf"
        :segmented="segmented"
        :apartados="apartados"
        :apartado-pdf="apartadoPdf"
        :metrics="metrics"
        :container-id="block.blockId"
        @drag-start="(event, item) => emit('drag-start', event, item)"
        @drop-block="(event, target, container) => emit('drop-block', event, target, container)"
        @remove="(item) => emit('remove', item)"
        @argument-change="(item, key, value) => emit('argument-change', item, key, value)"
        @metric-change="(item, field, value, index) => emit('metric-change', item, field, value, index)"
        @version-change="(item, version) => emit('version-change', item, version)"
        @toggle-view="(item) => emit('toggle-view', item)"
      />
    </article>
  </div>
</template>

<style scoped>
.document-tool-children {
  display: grid;
  gap: 8px;
  margin: 8px;
  min-height: 48px;
  padding: 8px;
  border: 1px dashed color-mix(in srgb, var(--v-theme-primary) 45%, transparent);
  background: rgba(var(--v-theme-surface), .72);
}

.document-tool-children-empty {
  align-self: center;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: .72rem;
  text-align: center;
}

.document-tool-child {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), .22);
  background: rgb(var(--v-theme-surface));
}

.document-tool-child > header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 2px 5px 2px 8px;
}

.document-tool-child > header strong {
  overflow: hidden;
  font-size: .72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-tool-child > header.document-tool-child-header--variants { padding-left:4px; }
.document-child-variants { flex:0 1 auto; min-width:0; max-width:55%; overflow-x:auto; border:0; background:transparent; padding:0; }
.document-child-variants :deep(.exercise-variant-label) { display:none; }
.document-child-variants :deep(.exercise-variant-option) { flex:0 0 19px; }

.document-tool-child-arguments {
  display: grid;
  gap: 6px;
  padding: 6px 8px 8px;
}

.document-tool-child-part { border-top: 1px solid #dfe7f0; }
.document-tool-child-metrics { display: grid; grid-template-columns: 32px 1fr 1fr; align-items: center; gap: 5px; min-height: 29px; padding: 3px 7px; color: #416185; font-size: .62rem; }
.document-tool-child-metrics label { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 3px; color: #77899f; font-size: .49rem; font-weight: 750; text-transform: uppercase; }
.document-tool-child-metrics input { width: 58px; height: 23px; padding: 0 5px; border: 1px solid #c9d6e5; border-radius: 5px; color: #31557e; font: inherit; font-size: .64rem; text-align: center; }
.document-tool-child-metrics input:disabled { border-color: transparent; background: #e9eff6; color: #60758f; }
.document-tool-child-no-pdf { display: grid; min-height: 75px; place-items: center; color: #7d8da2; font-size: .7rem; }
</style>
