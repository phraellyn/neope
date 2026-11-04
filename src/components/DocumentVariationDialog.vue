<script setup>
import { computed } from 'vue'
import DocumentPdfPreview from './DocumentPdfPreview.vue'
import { mathSubjects } from '../data/mathCurriculum'

const props = defineProps({ controller: { type: Object, required: true }, models: { type: Array, default: () => [] }, model: { type: String, default: '' } })
const emit = defineEmits(['update:model'])
const state = computed(() => props.controller.state)
const selectedRow = computed(() => state.value.rows.find((row) => row.original.slotId === state.value.selected))
const selectedPdf = computed(() => state.value.previews.find((entry) => entry.templateKey === state.value.selectedPreview))
const conceptsLabel = (ids) => ids.map((id) => state.value.context?.concepts.find((node) => node.id === id)?.title || id).join(' · ')
const subjectOptions = computed(() => mathSubjects.filter((subject) => !state.value.course || subject.course === state.value.course).map((subject) => ({ title: `${subject.course} · ${subject.title}`, value: subject.id })))
const courses = [...new Set(mathSubjects.map((subject) => subject.course))]
</script>

<template>
  <v-dialog :model-value="state.visible" persistent max-width="1380" @update:model-value="value => { if (!value) controller.close() }">
    <v-card class="document-variation-dialog">
      <v-card-title class="d-flex align-center ga-2"><v-icon icon="mdi-auto-fix" /> Crear una copia con IA<v-spacer /><v-btn icon="mdi-close" variant="text" aria-label="Cancelar copia con IA" @click="controller.close()" /></v-card-title>
      <div v-if="state.busy" class="variation-progress px-6 pb-2" role="status" aria-live="polite"><v-progress-circular indeterminate size="22" width="2" color="primary" />{{ state.progress }}</div>
      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3 variation-error">{{ state.error }}</v-alert>
        <div v-if="state.phase === 'configure'" class="variation-configuration">
          <v-radio-group v-model="state.mode" :disabled="state.busy" label="Modo de generación">
            <v-radio label="Clonado: una variante nueva de cada ejercicio original" value="cloned" />
            <v-radio label="Variante: otros ejercicios del banco que cubran el mismo mapa de conceptos" value="variant" />
          </v-radio-group>
          <p v-if="state.mode === 'variant'">Se buscará en toda la asignatura. Cuando no haya un ejercicio adecuado, se creará uno nuevo para cubrir los conceptos pendientes.</p>
          <p v-else>Se cambiarán los datos y el contexto de cada ejercicio, manteniendo sus destrezas, dificultad y estructura.</p>
          <v-select :model-value="model" :items="models" label="Modelo de IA" variant="outlined" density="compact" :disabled="state.busy" @update:model-value="emit('update:model', $event)"><template #item="{ props: itemProps, item }"><v-list-item v-bind="itemProps" :subtitle="item.raw.subtitle" /></template></v-select>
          <div class="variation-context"><v-select v-model="state.course" :items="courses" label="Nivel" variant="outlined" density="compact" :disabled="state.busy" /><v-select v-model="state.subjectId" :items="subjectOptions" label="Asignatura" variant="outlined" density="compact" :disabled="state.busy" /></div>
          <v-textarea v-model="state.instructions" label="Indicaciones opcionales" placeholder="Por ejemplo: conserva la dificultad y utiliza contextos diferentes." rows="2" maxlength="2000" variant="outlined" :disabled="state.busy" />
          <p v-if="state.context"><strong>{{ state.context.slots.length }} ejercicios.</strong> Se conservarán las plantillas, instrucciones, bloques, apartados, puntuaciones y ejercicios optativos. Los ejercicios nuevos se guardarán únicamente dentro de la copia del documento.</p>
          <p v-if="state.context && !state.context.curriculum.conceptIds.length">Si es necesario, la IA identificará los conceptos a partir de los ejercicios originales.</p>
        </div>
        <template v-else>
          <div class="variation-review-summary"><strong>{{ state.mode === 'cloned' ? 'Clonado' : 'Variante' }}</strong><span>{{ state.rows.length }} ejercicios</span><span v-if="state.mode === 'variant'">{{ state.rows.filter(row => row.choice.origin === 'bank').length }} del banco · {{ state.rows.filter(row => row.choice.origin === 'new').length }} nuevos</span><span>{{ state.plan?.conceptIds.length || 0 }} conceptos</span></div>
          <v-select :model-value="model" :items="models" label="Modelo para regenerar ejercicios" density="compact" variant="outlined" :disabled="state.busy" @update:model-value="emit('update:model', $event)"><template #item="{ props: itemProps, item }"><v-list-item v-bind="itemProps" :subtitle="item.raw.subtitle" /></template></v-select>
          <div class="variation-review-layout">
            <nav class="variation-exercise-list" aria-label="Ejercicios de la copia">
              <v-btn v-for="row in state.rows" :key="row.original.slotId" :variant="state.selected === row.original.slotId ? 'tonal' : 'text'" :color="row.error ? 'error' : 'primary'" block class="justify-start mb-1" :prepend-icon="row.busy ? 'mdi-progress-clock' : row.error ? 'mdi-alert-circle-outline' : row.snapshot ? 'mdi-check-circle-outline' : 'mdi-clock-outline'" @click="state.selected = row.original.slotId">{{ row.label }}</v-btn>
            </nav>
            <section v-if="selectedRow" class="variation-exercise-review">
              <header><strong>{{ selectedRow.label }}</strong><v-chip size="small" variant="tonal">{{ selectedRow.choice.origin === 'bank' ? 'Variante del banco' : selectedRow.choice.origin === 'new' ? 'Ejercicio nuevo' : 'Clonado' }}</v-chip></header>
              <p class="variation-concepts">{{ conceptsLabel(selectedRow.choice.requiredConceptIds) }}</p>
              <p v-if="selectedRow.choice.origin === 'bank'" class="variation-reference">Referencia: {{ selectedRow.choice.label }}</p>
              <v-alert v-if="selectedRow.error" type="error" variant="tonal" density="compact">{{ selectedRow.error }}</v-alert>
              <v-textarea v-model="selectedRow.instructions" label="Indicaciones para regenerar este ejercicio" rows="2" maxlength="1000" variant="outlined" density="compact" :disabled="state.busy" hide-details />
              <div class="d-flex flex-wrap ga-2"><v-btn prepend-icon="mdi-refresh" variant="tonal" color="primary" :disabled="state.busy" @click="controller.regenerate(selectedRow)">Regenerar ejercicio</v-btn><v-btn v-if="state.mode === 'variant'" prepend-icon="mdi-swap-horizontal" variant="text" :disabled="state.busy" @click="controller.regenerate(selectedRow, true)">Buscar otro ejercicio</v-btn></div>
              <DocumentPdfPreview v-if="selectedRow.preview" :key="selectedRow.preview.url" :src="selectedRow.preview.url" :title="selectedRow.label" class="variation-exercise-pdf" />
              <div v-else class="variation-preview-empty"><v-progress-circular v-if="selectedRow.busy" indeterminate color="primary" /><span>{{ selectedRow.busy ? 'Generando y compilando…' : 'Todavía no hay una propuesta válida para este ejercicio.' }}</span></div>
              <details v-if="selectedRow.snapshot || selectedRow.pendingResponse"><summary>Ver código del ejercicio</summary><pre>{{ selectedRow.snapshot?.enunciado || selectedRow.pendingResponse?.enunciado }}</pre></details>
            </section>
            <section class="variation-complete-review">
              <header><strong>Documento completo</strong><v-btn icon="mdi-refresh" variant="text" size="small" aria-label="Recompilar vista previa de la copia" :disabled="state.busy || state.rows.some(row => !row.snapshot || row.error)" @click="controller.retryDocumentPreview()" /></header>
              <v-select v-if="state.previews.length > 1" v-model="state.selectedPreview" :items="state.previews.map(entry => ({title: entry.name, value: entry.templateKey}))" label="Documento" density="compact" variant="outlined" hide-details />
              <DocumentPdfPreview v-if="selectedPdf" :key="selectedPdf.url" :src="selectedPdf.url" class="variation-complete-pdf" />
              <div v-else class="variation-preview-empty">La copia completa aparecerá cuando todos sus ejercicios estén generados y compilados.</div>
            </section>
          </div>
          <v-alert v-if="controller.missingConcepts.length" type="info" variant="tonal" density="compact" class="mt-3">Conceptos pendientes: {{ conceptsLabel(controller.missingConcepts) }}</v-alert>
        </template>
      </v-card-text>
      <v-card-actions><v-btn variant="text" @click="controller.close()">Descartar copia</v-btn><v-spacer /><v-btn v-if="state.phase === 'configure'" color="primary" variant="flat" :disabled="state.busy || !state.context || !model || (state.mode === 'variant' && !state.subjectId)" @click="controller.generate()">Generar vista previa</v-btn><v-btn v-else color="primary" variant="flat" :disabled="!controller.canAccept" @click="controller.acceptCopy()">Aceptar copia y editar</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.document-variation-dialog { max-height: 94vh; }
.variation-configuration { display: grid; gap: 16px; max-width: 800px; margin: auto; }
.variation-configuration p { margin: 0; color: #52677e; }
.variation-context { display: grid; grid-template-columns: 1fr 2fr; gap: 12px; }
.variation-review-summary { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin-bottom: 16px; color: #47617b; }
.variation-review-layout { display: grid; grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
.variation-exercise-list { max-height: 65vh; overflow-y: auto; }
.variation-exercise-review, .variation-complete-review { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.variation-exercise-review header, .variation-complete-review header { display: flex; align-items: center; gap: 12px; min-height: 34px; }
.variation-concepts, .variation-reference { margin: 0; font-size: .8rem; color: #647994; }
.variation-exercise-pdf { height: 390px; }
.variation-complete-pdf { height: 620px; }
.variation-preview-empty { min-height: 210px; display: grid; place-content: center; text-align: center; gap: 14px; color: #647994; padding: 20px; background: #f3f7fc; border-radius: 10px; }
.variation-progress { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.variation-error { white-space: pre-wrap; overflow-wrap: anywhere; }
details pre { white-space: pre-wrap; word-break: break-word; font-size: .75rem; max-height: 280px; overflow: auto; padding: 12px; background: #f3f7fc; }
@media (max-width: 1000px) { .variation-review-layout { grid-template-columns: 120px minmax(0, 1fr); } .variation-complete-review { grid-column: 1 / -1; } }
@media (max-width: 600px) { .variation-review-layout, .variation-context { grid-template-columns: 1fr; } .variation-exercise-list { display: flex; max-height: 100px; overflow: auto; } }
</style>
