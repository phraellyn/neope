<script setup>
import { computed, ref } from 'vue'
import DocumentCodeEditor from './DocumentCodeEditor.vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'

const props = defineProps({
  content: { type: Object, required: true },
  templates: { type: Array, default: () => [] },
  resources: { type: Array, default: () => [] },
  editing: { type: Boolean, default: false },
  compiling: { type: Boolean, default: false },
})

const emit = defineEmits(['update-code', 'update-template', 'update-code-visible', 'compile', 'remove'])
const editor = ref(null)
const imageResources = computed(() => props.resources.filter((resource) => (
  resource.type === 'file' && String(resource.contentType || '').startsWith('image/') && resource.url
)))
const selectedTemplate = computed(() => props.templates.find((template) => template.archivo === props.content.templateFile))
const codeVisible = computed(() => props.editing && props.content.codeVisible !== false)

function formatCode() {
  editor.value?.format?.()
}

function imageReferenceName(resource, index) {
  if (resource.compilerName) return resource.compilerName
  const extension = String(resource.title || '').match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase() || '.png'
  return `imagen${index + 1}${extension}`
}
</script>

<template>
  <section class="programming-latex-content" :class="{ 'programming-latex-content-preview-only': !codeVisible }">
    <header class="programming-latex-toolbar">
      <div class="programming-latex-title">
        <v-icon icon="mdi-language-latex" size="20" />
        <strong>Contenido</strong>
      </div>
      <template v-if="editing">
        <v-select
          :model-value="content.templateFile"
          :items="templates"
          item-title="nombre"
          item-value="archivo"
          label="Plantilla"
          density="compact"
          variant="outlined"
          hide-details
          class="programming-template-select"
          @update:model-value="emit('update-template', $event)"
        />
        <v-spacer />
        <v-tooltip text="Embellecer código (Ctrl/Cmd + F)" location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn v-bind="tooltipProps" icon="mdi-format-align-left" size="small" rounded="circle" variant="text" aria-label="Embellecer código" @click="formatCode" />
          </template>
        </v-tooltip>
        <v-tooltip text="Recompilar (Ctrl/Cmd + S)" location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn v-bind="tooltipProps" icon="mdi-refresh" size="small" rounded="circle" color="primary" variant="tonal" :loading="compiling" :disabled="!content.code?.trim() || !content.templateFile" aria-label="Recompilar contenido" @click="emit('compile')" />
          </template>
        </v-tooltip>
        <v-tooltip :text="codeVisible ? 'Ocultar código' : 'Mostrar código'" location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn v-bind="tooltipProps" :icon="codeVisible ? 'mdi-code-tags-check' : 'mdi-code-tags'" size="small" rounded="circle" variant="text" :aria-label="codeVisible ? 'Ocultar código' : 'Mostrar código'" @click="emit('update-code-visible', !codeVisible)" />
          </template>
        </v-tooltip>
        <v-btn icon="mdi-close" size="small" rounded="circle" variant="text" color="error" aria-label="Eliminar contenido" @click="emit('remove')" />
      </template>
      <span v-else class="programming-template-name">{{ selectedTemplate?.nombre || 'Plantilla no disponible' }}</span>
    </header>

    <div v-if="editing && imageResources.length" class="programming-latex-assets">
      <span>Imágenes disponibles:</span>
      <code v-for="(resource, index) in imageResources" :key="resource.id">{{ imageReferenceName(resource, index) }}</code>
    </div>

    <div class="programming-latex-workspace">
      <DocumentCodeEditor
        v-if="codeVisible"
        ref="editor"
        :model-value="content.code || ''"
        :compiling="compiling"
        :show-header="false"
        @update:model-value="emit('update-code', $event)"
        @compile="emit('compile')"
      />
      <DocumentPdfPreview
        class="programming-latex-preview"
        :src="content.pdf?.url || ''"
        title="Vista previa del contenido"
      />
    </div>
  </section>
</template>

<style scoped>
.programming-latex-content { min-width: 0; overflow: hidden; border: 1px solid #cbd9e9; border-radius: 6px; background: #fff; }
.programming-latex-toolbar { min-height: 46px; padding: 5px 7px 5px 11px; display: flex; align-items: center; gap: 5px; border-bottom: 1px solid #d7e1ed; background: #f1f5fa; color: #315f96; }
.programming-latex-title { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.programming-latex-title strong { font-size: .76rem; letter-spacing: .04em; text-transform: uppercase; }
.programming-template-select { flex: 0 1 260px; min-width: 150px; margin-left: 8px; }
.programming-template-name { margin-left: auto; color: #71839a; font-size: .78rem; }
.programming-latex-assets { min-height: 34px; padding: 5px 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border-bottom: 1px solid #dde5ef; color: #667c96; font-size: .75rem; }
.programming-latex-assets code { padding: 2px 6px; border-radius: 4px; background: #e7eef7; color: #234e7d; }
.programming-latex-workspace { height: min(560px, 66vh); min-height: 360px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .82fr); }
.programming-latex-preview { border-left: 1px solid #cbd7e6; }
.programming-latex-content-preview-only .programming-latex-workspace { grid-template-columns: minmax(0, 1fr); }
.programming-latex-content-preview-only .programming-latex-preview { border-left: 0; }
@media (max-width: 760px) {
  .programming-latex-toolbar { flex-wrap: wrap; }
  .programming-template-select { flex: 1 1 190px; }
  .programming-latex-workspace { height: auto; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: 340px 430px; }
  .programming-latex-content-preview-only .programming-latex-workspace { grid-template-rows: 480px; }
  .programming-latex-preview { border-top: 1px solid #cbd7e6; border-left: 0; }
}
</style>
