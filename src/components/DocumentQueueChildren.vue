<script setup>
import { computed } from 'vue'

defineOptions({ name: 'DocumentQueueChildren' })

const props = defineProps({
  blocks: { type: Array, default: () => [] },
  tools: { type: Array, default: () => [] },
  exercises: { type: Array, default: () => [] },
  containerId: { type: String, required: true },
})

const emit = defineEmits(['drag-start', 'drop-block', 'remove', 'argument-change'])
const toolsById = computed(() => new Map(props.tools.map((tool) => [tool.id, tool])))
const exercisesById = computed(() => new Map(props.exercises.map((exercise) => [exercise.id, exercise])))

function toolFor(block) {
  return toolsById.value.get(block?.toolId) || null
}

function exerciseTitle(block) {
  const exercise = exercisesById.value.get(block?.exerciseId) || block?.snapshot
  return exercise?.titulo || exercise?.info || exercise?.curriculum?.subjectTitle || 'Ejercicio'
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
      @dragstart="emit('drag-start', $event, block)"
      @dragover.prevent
      @drop.stop="emit('drop-block', $event, block.blockId, containerId)"
    >
      <header>
        <v-icon :icon="block.type === 'tool' ? (toolFor(block)?.icon || 'mdi-tools') : 'mdi-file-document-outline'" size="15" />
        <strong>{{ block.type === 'tool' ? (toolFor(block)?.label || 'Herramienta') : exerciseTitle(block) }}</strong>
        <v-spacer />
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
      <DocumentQueueChildren
        v-if="block.type === 'tool' && toolFor(block)?.kind === 'environment'"
        :blocks="block.children || []"
        :tools="tools"
        :exercises="exercises"
        :container-id="block.blockId"
        @drag-start="(event, item) => emit('drag-start', event, item)"
        @drop-block="(event, target, container) => emit('drop-block', event, target, container)"
        @remove="(item) => emit('remove', item)"
        @argument-change="(item, key, value) => emit('argument-change', item, key, value)"
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

.document-tool-child-arguments {
  display: grid;
  gap: 6px;
  padding: 6px 8px 8px;
}
</style>
