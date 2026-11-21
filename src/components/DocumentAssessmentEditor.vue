<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import lomloeMathLaw from '../data/lomloeMathLaw.json'
import { criterionStrength, criterionDescriptorIds } from '../utils/criterionEvidence'

const props = defineProps({ sections: { type: Array, required: true }, subjectId: { type: String, default: '' }, course: { type: String, default: '' }, model: { type: String, default: '' }, models: { type: Array, default: () => [] } })
const emit = defineEmits(['apply', 'cancel', 'update:model', 'update:sections', 'busy-change'])
const sections = reactive(JSON.parse(JSON.stringify(props.sections)))
watch(sections, () => emit('update:sections', JSON.parse(JSON.stringify(sections))), { deep: true })
const law = computed(() => lomloeMathLaw.subjects?.[props.subjectId] || {})
const competencies = computed(() => law.value.specificCompetencies || [])
const criteria = computed(() => [...new Map([...(law.value.evaluationCriteria || []), ...competencies.value.flatMap((competency) => (competency.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competency.id })))].map((criterion) => [criterion.id, criterion])).values()])
const descriptors = computed(() => (lomloeMathLaw.global?.operationalDescriptors || []).filter((descriptor) => !descriptor.stage || descriptor.stage === (String(law.value.stage || '').toLowerCase().includes('bach') ? 'Bachillerato' : 'ESO')))
const criterionOptions = computed(() => criteria.value.map((criterion) => ({ value: criterion.id, title: `${criterion.code} · ${criterion.description}` })))
const points = (value) => Number(String(value ?? '').replace(',', '.'))
const total = (section) => section.achievements.reduce((sum, item) => sum + (Number.isFinite(points(item.points)) ? points(item.points) : 0), 0)
const validSection = (section) => section.achievements.every((item) => {
  const value = points(item.points)
  return String(item.description || '').trim() && String(item.points ?? '').trim() !== ''
    && Number.isFinite(value) && value >= 0 && Math.abs(value * 4 - Math.round(value * 4)) < 1e-8
}) && Math.abs(total(section) - section.maximum) < 1e-8
const valid = computed(() => sections.every(validSection))
const aiRunning = ref(false)
watch(aiRunning, (value) => emit('busy-change', value), { flush: 'sync' })
const aiProgress = ref('')
const aiErrors = ref([])
const busyKey = ref('')
const achievementCount = computed(() => sections.reduce((sum, section) => sum + section.achievements.length, 0))
function add(section) {
  section.achievements.push({ id: globalThis.crypto.randomUUID(), description: '', points: 0, alignment: { criterionIds: [], descriptorEvidence: [], source: 'manual' } })
}
function setCriteria(achievement, ids) {
  const selected = [...new Set(ids || [])]
  const allowed = new Set(selected.flatMap((id) => {
    const criterion = criteria.value.find((entry) => entry.id === id)
    const competency = competencies.value.find((entry) => entry.id === criterion?.competenceId)
    return [...(criterion?.descriptorIds || []), ...(competency?.descriptorIds || [])]
  }))
  const previous = achievement.alignment || {}
  const criterionEvidence = selected.map((id) => ({ criterionId: id, strength: criterionStrength(previous, id, criterionDescriptorIds(law.value, id)) || 'medium' }))
  achievement.alignment = { ...previous, criterionIds: selected, criterionEvidence, descriptorEvidence: (previous.descriptorEvidence || []).filter((entry) => allowed.has(entry.descriptorId)), source: 'manual' }
}
function strengthFor(achievement, id) { return criterionStrength(achievement.alignment, id, criterionDescriptorIds(law.value, id)) || 'medium' }
function setStrength(achievement, id, strength) {
  const alignment = achievement.alignment || {}
  achievement.alignment = { ...alignment, criterionEvidence: [...(alignment.criterionEvidence || []).filter((item) => item.criterionId !== id), { criterionId: id, strength }], source: 'manual' }
}
async function suggest(section, achievement) {
  const context = section.context || {}
  const response = await httpsCallable(functions, 'suggestRubricAlignment', { timeout: 120_000 })({
    model: props.model, course: props.course, subjectId: props.subjectId, subjectTitle: law.value.subjectTitle || '',
    rubricTitle: 'Matriz de evaluación del documento', categoryTitle: `${section.exerciseLabel} · ${section.label}`,
    levelDescription: `Logro a vincular: ${achievement.description}\nPuntuación: ${points(achievement.points)} puntos.\nEnunciado y solución del apartado: ${JSON.stringify(context.segment || {})}\nEjercicio completo: ${String(context.latex || '').slice(0, 4500)}`,
    criteria: criteria.value, competencies: competencies.value, descriptors: descriptors.value,
  })
  const selected = response.data?.criterionIds || []
  setCriteria(achievement, selected)
  const allowed = new Set(selected.flatMap((id) => {
    const criterion = criteria.value.find((entry) => entry.id === id)
    const competency = competencies.value.find((entry) => entry.id === criterion?.competenceId)
    return [...(criterion?.descriptorIds || []), ...(competency?.descriptorIds || [])]
  }))
  const descriptorEvidence = (response.data?.descriptorEvidence || []).filter((entry) => allowed.has(entry.descriptorId))
  const proposed = { criterionEvidence: response.data?.criterionEvidence || [], descriptorEvidence }
  achievement.alignment = { criterionIds: selected, criterionEvidence: selected.map((id) => ({ criterionId: id, strength: criterionStrength(proposed, id, criterionDescriptorIds(law.value, id)) || 'medium' })), descriptorEvidence, source: 'ai', model: response.data?.model || props.model }
}
async function suggestMany(targets) {
  if (aiRunning.value || !criteria.value.length || !targets.length) return
  aiRunning.value = true; aiErrors.value = []; let completed = 0; let cursor = 0
  aiProgress.value = `Vinculando 0 de ${targets.length} logros…`
  if (targets.length === 1) busyKey.value = `${targets[0].section.blockId}:${targets[0].achievement.id}`
  const worker = async () => {
    while (cursor < targets.length) {
      const { section, achievement } = targets[cursor++]
      try {
        if (!achievement.description?.trim()) throw new Error('Escribe el texto del logro antes de vincularlo.')
        await suggest(section, achievement)
      } catch (error) { aiErrors.value.push(`${section.exerciseLabel}, ${section.label}: ${error?.message || 'No se ha podido vincular el logro.'}`) }
      completed += 1; aiProgress.value = `Vinculando ${completed} de ${targets.length} logros…`
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker)) }
  finally { aiRunning.value = false; busyKey.value = ''; aiProgress.value = '' }
}
function suggestAll() { return suggestMany(sections.flatMap((section) => section.achievements.map((achievement) => ({ section, achievement })))) }
function apply() {
  if (!valid.value || aiRunning.value) return
  emit('apply', sections.map((section) => ({ ...section, achievements: section.achievements.map((item) => ({ ...item, description: item.description.trim(), points: points(item.points) })) })))
}
</script>

<template>
  <div class="matrix-editor">
    <header class="matrix-editor-toolbar"><strong><v-icon icon="mdi-pencil-outline" size="18" /> Editar matriz de evaluación</strong><v-spacer /><v-btn icon="mdi-close" size="small" variant="text" aria-label="Cerrar editor" :disabled="aiRunning" @click="emit('cancel')" /></header>
    <div class="matrix-editor-body">
      <p class="matrix-editor-hint">Modifica los logros de este documento y vincúlalos a criterios de evaluación. Los puntos van de 0,25 en 0,25 y deben sumar el total del apartado. Las notas guardadas no se recalculan automáticamente.</p>
      <div class="matrix-editor-ai">
        <v-select :model-value="model" :items="models" item-title="title" item-value="value" label="Modelo de IA" variant="outlined" density="compact" hide-details :disabled="aiRunning" @update:model-value="emit('update:model', $event)" />
        <v-btn prepend-icon="mdi-auto-fix" size="small" variant="tonal" color="primary" :loading="aiRunning && !busyKey" :disabled="aiRunning || !criteria.length || !achievementCount" @click="suggestAll">Vincular todos con IA</v-btn>
      </div>
      <p v-if="!criteria.length" class="matrix-editor-error">Selecciona una asignatura con criterios de evaluación para poder vincular los logros.</p>
      <p v-if="aiProgress" class="matrix-editor-hint" role="status">{{ aiProgress }}</p>
      <p v-for="(error, index) in aiErrors" :key="index" class="matrix-editor-error" role="alert">{{ error }}</p>
      <div v-for="section in sections" :key="`${section.blockId}:${section.segmentId}`" class="matrix-editor-section">
        <header class="matrix-editor-section-heading"><strong>{{ section.exerciseLabel }} · {{ section.label }}</strong><span :class="{ invalid: !validSection(section) }">{{ total(section).toLocaleString('es-ES') }} / {{ section.maximum.toLocaleString('es-ES') }} pt</span></header>
        <div v-for="(achievement, index) in section.achievements" :key="achievement.id || index" class="matrix-editor-achievement">
          <div class="matrix-editor-row">
            <v-textarea v-model="achievement.description" label="Logro" variant="outlined" density="compact" rows="1" auto-grow hide-details :disabled="aiRunning" />
            <v-text-field v-model="achievement.points" label="Puntos" type="number" min="0" step="0.25" variant="outlined" density="compact" hide-details :disabled="aiRunning" />
            <v-btn icon="mdi-delete-outline" variant="text" size="small" color="error" aria-label="Eliminar logro" :disabled="aiRunning" @click="section.achievements.splice(index, 1)" />
          </div>
          <div class="matrix-editor-alignment">
            <v-select :model-value="achievement.alignment?.criterionIds || []" :items="criterionOptions" label="Criterios de evaluación" multiple chips closable-chips variant="outlined" density="compact" hide-details :disabled="aiRunning || !criteria.length" @update:model-value="setCriteria(achievement, $event)" />
            <v-btn icon="mdi-auto-fix" variant="text" size="small" color="primary" :loading="busyKey === `${section.blockId}:${achievement.id}`" :disabled="aiRunning || !criteria.length || !achievement.description?.trim()" aria-label="Vincular este logro con IA" title="Vincular este logro con IA" @click="suggestMany([{ section, achievement }])" />
          </div>
          <div v-for="criterionId in achievement.alignment?.criterionIds || []" :key="criterionId" class="matrix-editor-evidence">
            <span :title="criteria.find(item => item.id === criterionId)?.description">{{ criteria.find(item => item.id === criterionId)?.code || criterionId }}</span>
            <v-btn-toggle :model-value="strengthFor(achievement, criterionId)" density="compact" color="primary" :disabled="aiRunning" @update:model-value="value => { if (value) setStrength(achievement, criterionId, value) }">
              <v-btn value="weak" size="x-small">Débil</v-btn><v-btn value="medium" size="x-small">Media</v-btn><v-btn value="strong" size="x-small">Fuerte</v-btn>
            </v-btn-toggle>
          </div>
        </div>
        <v-btn size="small" variant="text" prepend-icon="mdi-plus" :disabled="aiRunning" @click="add(section)">Añadir logro</v-btn>
        <p v-if="!validSection(section)" class="matrix-editor-error">Completa los textos y usa puntos en múltiplos de 0,25 hasta alcanzar el total.</p>
      </div>
      <div v-if="!sections.length" class="matrix-editor-hint">No hay ejercicios en la matriz.</div>
    </div>
    <footer><v-btn variant="text" :disabled="aiRunning" @click="emit('cancel')">Cancelar</v-btn><v-btn color="primary" variant="flat" :disabled="!valid || !sections.length || aiRunning" @click="apply">Aplicar cambios</v-btn></footer>
  </div>
</template>

<style scoped>
.matrix-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #fff; }
.matrix-editor-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #dce4ed; color: #244b76; }
.matrix-editor-body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.matrix-editor-hint { color: #52677d; font-size: .84rem; margin: 0; }
.matrix-editor-ai { display: flex; gap: 10px; align-items: center; }.matrix-editor-ai .v-select { max-width: 320px; }
.matrix-editor-section { border: 1px solid #dce4ed; border-radius: 5px; padding: 12px; }
.matrix-editor-section-heading { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: #244b76; font-size: .9rem; }
.matrix-editor-section-heading span { white-space: nowrap; }.matrix-editor-section-heading span.invalid, .matrix-editor-error { color: #b00020; }
.matrix-editor-achievement { padding: 8px 0; border-bottom: 1px solid #edf1f5; }.matrix-editor-row { display: grid; grid-template-columns: minmax(0, 1fr) 105px 40px; gap: 8px; align-items: center; margin-bottom: 8px; }
.matrix-editor-alignment { display: flex; align-items: center; gap: 8px; padding-right: 0; }.matrix-editor-alignment .v-select { min-width: 0; }
.matrix-editor-evidence { display: flex; align-items: center; gap: 10px; padding: 6px 0 0; color: #315981; font-size: .76rem; }.matrix-editor-evidence > span { min-width: 40px; font-weight: 650; }
.matrix-editor-error { margin: 4px 0 0; font-size: .75rem; }
footer { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 16px; border-top: 1px solid #dce4ed; }
@media (max-width: 500px) { .matrix-editor-row { grid-template-columns: minmax(0, 1fr) 82px 36px; gap: 4px; }.matrix-editor-ai { align-items: stretch; flex-direction: column; }.matrix-editor-ai .v-select { max-width: none; } }
</style>
