<script setup>
import DocumentPdfPreview from './DocumentPdfPreview.vue'
defineProps({ state: { type: Object, required: true }, textModels: { type: Array, default: () => [] }, textModel: { type: String, default: '' }, generatingVariation: { type: Boolean, default: false }, variationError: { type: String, default: '' }, pendingVariation: { type: Boolean, default: false } })
const emit = defineEmits(['generate-variation', 'update:textModel'])
</script>

<template>
  <v-dialog v-model="state.generationDialog" max-width="660" :persistent="generatingVariation">
    <v-card>
      <v-card-title>{{ state.form.experimental ? 'Variación experimental' : 'Generar variante' }}</v-card-title>
      <v-card-text class="visual-generation-form">
        <v-select :model-value="textModel" :items="textModels" label="Modelo para el ejercicio" variant="outlined" density="compact" :disabled="generatingVariation" @update:model-value="emit('update:textModel', $event)">
          <template #item="{ props, item }"><v-list-item v-bind="props" :subtitle="item.raw.subtitle" /></template>
        </v-select>
        <v-select v-model="state.form.imageMode" :items="[{ title: 'Automática: cuando ayude al ejercicio', value: 'auto' }, { title: 'Generar una figura nueva', value: 'required' }, { title: 'Sin imágenes externas', value: 'none' }]" label="Imagen" variant="outlined" density="compact" :disabled="generatingVariation || pendingVariation" />
        <v-select v-if="state.form.imageMode !== 'none' && state.imageModels.length" v-model="state.form.imageModel" :items="state.imageModels" label="Modelo configurado para generar la imagen" variant="outlined" density="compact" :loading="state.catalogLoading" :disabled="generatingVariation">
          <template #item="{ props, item }"><v-list-item v-bind="props" :subtitle="item.raw.subtitle" /></template>
        </v-select>
        <p v-if="!state.catalogLoading && !state.catalogError && !state.imageModels.length && state.form.imageMode !== 'none'" class="visual-generation-hint">Tus modelos configurados crean las figuras mediante código LaTeX/TikZ. Comprender imágenes y generar archivos de imagen son capacidades distintas.</p>
        <v-textarea v-if="state.form.imageMode !== 'none'" v-model="state.form.instructions" label="Indicaciones opcionales para la imagen" placeholder="Por ejemplo: blanco y negro, fondo blanco y etiquetas grandes." rows="3" maxlength="2000" variant="outlined" :disabled="generatingVariation" />
        <p class="visual-generation-hint">Se utilizarán el enunciado original y las imágenes que contiene. Las figuras y gráficas exactas pueden generarse en TikZ. Las imágenes nuevas se guardarán al guardar el ejercicio.</p>
        <v-alert v-if="state.catalogError" type="warning" variant="tonal" density="compact">{{ state.catalogError }}<v-btn variant="text" size="small" @click="state.loadCatalog">Actualizar modelos</v-btn></v-alert>
        <v-alert v-if="variationError" type="error" variant="tonal" density="compact">{{ variationError }}</v-alert>
        <p v-if="pendingVariation" class="visual-generation-hint">El enunciado ya está preparado. Al volver a intentarlo se generará únicamente su imagen.</p>
      </v-card-text>
      <v-card-actions><v-btn variant="text" :disabled="generatingVariation" @click="state.generationDialog = false">Cancelar</v-btn><v-spacer /><v-btn color="primary" variant="flat" :loading="generatingVariation" :disabled="state.catalogLoading || (state.form.imageMode === 'required' && state.imageModels.length > 0 && !state.form.imageModel)" @click="emit('generate-variation')">{{ pendingVariation ? 'Generar imagen pendiente' : 'Generar' }}</v-btn></v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="state.dialog" max-width="1180" :persistent="state.busy">
    <v-card>
      <v-card-title>Imagen de la variante</v-card-title>
      <v-card-text class="visual-generation-form">
        <v-select v-if="state.targets.length > 1" v-model="state.form.target" :items="state.targets" item-title="label" item-value="id" label="Imagen que quieres regenerar" variant="outlined" density="compact" :disabled="state.busy" />
        <v-select v-if="state.usesTikz" :model-value="textModel" :items="textModels" label="Modelo para crear la figura LaTeX" variant="outlined" density="compact" :disabled="state.busy" @update:model-value="emit('update:textModel', $event)">
          <template #item="{ props, item }"><v-list-item v-bind="props" :subtitle="item.raw.subtitle" /></template>
        </v-select>
        <v-select v-else v-model="state.form.imageModel" :items="state.regenerationModels" label="Modelo configurado para generar la imagen" variant="outlined" density="compact" :loading="state.catalogLoading" :disabled="state.busy">
          <template #item="{ props, item }"><v-list-item v-bind="props" :subtitle="item.raw.subtitle" /></template>
        </v-select>
        <p v-if="state.usesTikz" class="visual-generation-hint">Se utilizará uno de tus modelos configurados para crear la figura en LaTeX/TikZ.</p>
        <v-textarea v-model="state.form.instructions" label="Indicaciones opcionales sobre estilo y contenido" placeholder="Por ejemplo: elimina el fondo, aumenta el tamaño de las etiquetas y usa un estilo de libro de texto." rows="3" maxlength="2000" variant="outlined" :disabled="state.busy" />
        <p class="visual-generation-hint">El enunciado y las soluciones se conservan. La propuesta sustituirá la figura únicamente cuando pulses Aceptar; se guardará con el ejercicio.</p>
        <p v-if="state.candidateNeedsRegeneration" class="visual-generation-hint">Has cambiado el modelo o las indicaciones. Genera otra propuesta para aplicar esos cambios.</p>
        <v-alert v-if="state.error" type="error" variant="tonal" density="compact">{{ state.error }}</v-alert>
        <v-alert v-if="state.catalogError" type="warning" variant="tonal" density="compact">{{ state.catalogError }}<v-btn variant="text" size="small" @click="state.loadCatalog">Actualizar modelos</v-btn></v-alert>
        <div v-if="state.comparisonImage || state.candidate" class="visual-image-comparison">
          <section v-if="state.comparisonImage"><h3>Imagen actual</h3><DocumentPdfPreview v-if="state.selectedTarget?.file?.type === 'application/pdf'" :src="state.comparisonImage" title="Imagen PDF actual" /><img v-else :src="state.comparisonImage" alt="Imagen actual del ejercicio" /></section>
          <section v-if="state.candidate"><h3>Propuesta</h3><img v-if="state.candidate.file" :src="state.candidate.file.url" alt="Imagen propuesta" /><DocumentPdfPreview v-else :src="state.candidate.pdfUrl" title="Figura LaTeX propuesta" /></section>
        </div>
        <details v-if="state.candidate?.file"><summary>Ver el ejercicio con la imagen nueva</summary><DocumentPdfPreview class="visual-proposal-pdf" :src="state.candidate.pdfUrl" title="Ejercicio con la propuesta" /></details>
      </v-card-text>
      <v-card-actions><v-btn variant="text" :disabled="state.busy" @click="state.closeDialog">Cancelar</v-btn><v-spacer /><v-btn variant="tonal" color="primary" :loading="state.busy" @click="state.generateCandidate">{{ state.candidate ? 'Generar otra propuesta' : 'Generar propuesta' }}</v-btn><v-btn variant="flat" color="primary" :disabled="!state.candidate || state.busy || state.candidateNeedsRegeneration" @click="state.acceptCandidate">Aceptar imagen</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.visual-generation-form { display: grid; gap: 13px; padding-top: 12px !important; }
.visual-generation-hint { margin: 0; color: #63758b; font-size: .83rem; }
.visual-image-comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.visual-image-comparison section { min-width: 0; padding: 12px; border: 1px solid #dce5ee; border-radius: 8px; background: #f7f9fc; }
.visual-image-comparison h3 { margin-bottom: 9px; color: #365c85; font-size: .88rem; }
.visual-image-comparison img { width: 100%; max-height: 420px; object-fit: contain; background: white; }
.visual-image-comparison :deep(.document-pdf-preview) { height: 420px; }
.visual-proposal-pdf { height: 490px; margin-top: 10px; }
summary { cursor: pointer; color: #315e95; font-weight: 600; }
</style>
