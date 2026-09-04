<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import {
  deleteRubric as removeRubricDocument,
  emptyRubric,
  loadGlobalLaw,
  loadRubrics,
  loadSubjectLaw,
  saveRubric as persistRubric,
} from '../services/rubricRepository'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  teacherId: { type: String, default: '' },
  subjects: { type: Array, default: () => [] },
  searchQuery: { type: String, default: '' },
  subjectFilter: { type: String, default: '' },
  aiModel: { type: String, default: 'google/gemini-3-flash-preview' },
})

const emit = defineEmits(['state-change'])

const mode = ref('library')
const rubrics = ref([])
const editor = ref(emptyRubric())
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const deleteTarget = ref(null)
const alignmentDialog = ref(false)
const alignmentTarget = ref(null)
const globalLaw = ref({ keyCompetencies: [], operationalDescriptors: [] })
const subjectLaw = ref({ specificCompetencies: [], evaluationCriteria: [] })
const loadingLaw = ref(false)
const suggestingLevelId = ref(null)
let catalogSyncPromise = null

function uniqueId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${value}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function emitState() {
  emit('state-change', {
    mode: mode.value,
    canSave: isValid.value,
    isSaving: saving.value,
    persisted: Boolean(editor.value.id),
  })
}

const courseOptions = computed(() => [...new Set(props.subjects.map((subject) => subject.course))])
const availableSubjects = computed(() => props.subjects.filter((subject) => !editor.value.course || subject.course === editor.value.course))
const filteredRubrics = computed(() => {
  const search = props.searchQuery.trim().toLocaleLowerCase('es-ES')
  return rubrics.value.filter((rubric) => (
    (!props.subjectFilter || rubric.subjectId === props.subjectFilter)
    && (!search || rubric.title.toLocaleLowerCase('es-ES').includes(search))
  ))
})
const isValid = computed(() => Boolean(
  editor.value.course
  && editor.value.subjectId
  && editor.value.title.trim()
  && editor.value.categories.length
  && editor.value.categories.every((category) => {
    if (!category.title.trim()) return false
    if (category.type === 'range') {
      return Boolean(category.range?.description?.trim())
        && Number.isInteger(Number(category.range?.min))
        && Number.isInteger(Number(category.range?.max))
        && Number.isInteger(Number(category.range?.default))
        && Number(category.range.min) <= Number(category.range.default)
        && Number(category.range.default) <= Number(category.range.max)
    }
    return category.levels.length
      && category.levels.every((level) => level.description.trim() && Number.isInteger(Number(level.points)))
      && category.levels.some((level) => level.id === category.defaultLevelId)
  })
))

const specificCompetencies = computed(() => Array.isArray(subjectLaw.value.specificCompetencies) ? subjectLaw.value.specificCompetencies : [])
const competencyById = computed(() => new Map(specificCompetencies.value.map((competency) => [competency.id, competency])))
const evaluationCriteria = computed(() => {
  const topLevel = Array.isArray(subjectLaw.value.evaluationCriteria) ? subjectLaw.value.evaluationCriteria : []
  const nested = specificCompetencies.value.flatMap((competency) => (
    (Array.isArray(competency.criteria) ? competency.criteria : []).map((criterion) => ({
      ...criterion,
      competenceId: criterion.competenceId || competency.id,
      competenceCode: criterion.competenceCode || competency.code,
    }))
  ))
  const byId = new Map([...topLevel, ...nested].filter((criterion) => criterion?.id).map((criterion) => [criterion.id, criterion]))
  return [...byId.values()]
})
const selectedCriterionIds = computed({
  get: () => alignmentTarget.value?.alignment?.criterionIds || [],
  set: (value) => {
    if (alignmentTarget.value) alignmentTarget.value.alignment.criterionIds = value
  },
})
const relevantDescriptors = computed(() => {
  const selectedCriteria = evaluationCriteria.value.filter((criterion) => selectedCriterionIds.value.includes(criterion.id))
  const descriptorIds = new Set(selectedCriteria.flatMap((criterion) => [
    ...(criterion.descriptorIds || []),
    ...(competencyById.value.get(criterion.competenceId)?.descriptorIds || []),
  ]))
  const stage = editor.value.course.includes('BTO') ? 'Bachillerato' : 'ESO'
  const descriptors = Array.isArray(globalLaw.value.operationalDescriptors) ? globalLaw.value.operationalDescriptors : []
  const stageDescriptors = descriptors.filter((descriptor) => !descriptor.stage || descriptor.stage === stage)
  return descriptorIds.size ? stageDescriptors.filter((descriptor) => descriptorIds.has(descriptor.id)) : stageDescriptors
})

function alignmentSummary(category) {
  const criteria = category.alignment?.criterionIds?.length || 0
  const evidence = category.alignment?.descriptorEvidence?.filter((item) => item.strength)?.length || 0
  if (!criteria && !evidence) return 'Sin vinculación curricular'
  return `${criteria} criterio${criteria === 1 ? '' : 's'} · ${evidence} evidencia${evidence === 1 ? '' : 's'}`
}

function rubricStructureLabel(rubric) {
  const levelCount = rubric.categories.reduce((total, category) => total + (category.type === 'levels' ? category.levels.length : 0), 0)
  const rangeCount = rubric.categories.filter((category) => category.type === 'range').length
  return [levelCount ? `${levelCount} niveles` : '', rangeCount ? `${rangeCount} horquilla${rangeCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
}

function formatDate(value) {
  if (!value) return 'Sin guardar'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? 'Sin guardar' : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date)
}

async function refresh() {
  if (!props.teacherId) return
  loading.value = true
  try {
    rubrics.value = await loadRubrics(props.teacherId)
  } catch (error) {
    console.error('No se han podido cargar las rúbricas:', error)
    showAppErrorToast('No se han podido cargar las rúbricas.')
  } finally {
    loading.value = false
  }
}

function newRubric() {
  editor.value = emptyRubric(props.teacherId)
  mode.value = 'editor'
  emitState()
}

function editRubric(rubric) {
  editor.value = clone(rubric)
  mode.value = 'editor'
  emitState()
}

function closeEditor() {
  mode.value = 'library'
  alignmentDialog.value = false
  emitState()
}

async function save() {
  if (!isValid.value || saving.value) return false
  saving.value = true
  emitState()
  try {
    const subject = props.subjects.find((item) => item.id === editor.value.subjectId)
    editor.value.subjectTitle = subject?.title || editor.value.subjectTitle
    const saved = await persistRubric(editor.value, props.teacherId)
    editor.value = saved
    const index = rubrics.value.findIndex((rubric) => rubric.id === saved.id)
    if (index >= 0) rubrics.value.splice(index, 1, saved)
    else rubrics.value.unshift(saved)
    mode.value = 'library'
    return true
  } catch (error) {
    console.error('No se ha podido guardar la rúbrica:', error)
    showAppErrorToast(error?.message || 'No se ha podido guardar la rúbrica.')
    return false
  } finally {
    saving.value = false
    emitState()
  }
}

function duplicateRubric(rubric = editor.value) {
  const copy = clone(rubric)
  copy.id = null
  copy.title = `${copy.title || 'Rúbrica'} (copia)`
  copy.sourceRubricId = rubric.id || rubric.sourceRubricId || null
  copy.createdAt = null
  copy.updatedAt = null
  copy.categories = copy.categories.map((category) => {
    const oldDefaultLevelId = category.defaultLevelId
    const levels = category.levels.map((level) => ({ ...level, id: uniqueId('level') }))
    const defaultIndex = category.levels.findIndex((level) => level.id === oldDefaultLevelId)
    return {
      ...category,
      id: uniqueId('category'),
      levels,
      defaultLevelId: levels[Math.max(0, defaultIndex)]?.id || null,
    }
  })
  editor.value = copy
  mode.value = 'editor'
  emitState()
}

function requestDelete(rubric = editor.value) {
  if (!rubric?.id) return
  deleteTarget.value = rubric
  deleteDialog.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value?.id || deleting.value) return
  deleting.value = true
  try {
    await removeRubricDocument(deleteTarget.value.id)
    rubrics.value = rubrics.value.filter((rubric) => rubric.id !== deleteTarget.value.id)
    if (editor.value.id === deleteTarget.value.id) closeEditor()
    deleteDialog.value = false
    deleteTarget.value = null
  } catch (error) {
    console.error('No se ha podido eliminar la rúbrica:', error)
    showAppErrorToast('No se ha podido eliminar la rúbrica.')
  } finally {
    deleting.value = false
  }
}

function setCourse(course) {
  editor.value.course = course || ''
  if (!availableSubjects.value.some((subject) => subject.id === editor.value.subjectId)) {
    editor.value.subjectId = ''
    editor.value.subjectTitle = ''
  }
}

function setSubject(subjectId) {
  editor.value.subjectId = subjectId || ''
  editor.value.subjectTitle = props.subjects.find((subject) => subject.id === subjectId)?.title || ''
}

function addCategory() {
  editor.value.categories.push({
    id: uniqueId('category'),
    title: '',
    type: 'levels',
    levels: [],
    defaultLevelId: null,
    range: { description: '', min: 0, max: 3, default: 1 },
    alignment: { criterionIds: [], descriptorEvidence: [], source: 'manual' },
  })
}

function removeCategory(categoryIndex) {
  editor.value.categories.splice(categoryIndex, 1)
}

function addLevel(category) {
  const level = {
    id: uniqueId('level'),
    description: '',
    points: category.levels.length,
  }
  category.levels.push(level)
  if (!category.defaultLevelId) category.defaultLevelId = level.id
}

function removeLevel(category, levelIndex) {
  const [removed] = category.levels.splice(levelIndex, 1)
  if (removed?.id === category.defaultLevelId) category.defaultLevelId = category.levels[0]?.id || null
}

function setCategoryType(category, type) {
  category.type = type
  category.alignment ||= { criterionIds: [], descriptorEvidence: [], source: 'manual' }
  category.range ||= { description: '', min: 0, max: 3, default: 1 }
  category.range.description ||= ''
  if (type === 'levels' && !category.levels.length) addLevel(category)
}

async function openAlignment(category) {
  alignmentTarget.value = category
  category.alignment ||= { criterionIds: [], descriptorEvidence: [], source: 'manual' }
  category.alignment.criterionIds ||= []
  category.alignment.descriptorEvidence ||= []
  alignmentDialog.value = true
  await loadLawCatalogs()
}

async function loadLawCatalogs() {
  if (!editor.value.subjectId) return
  loadingLaw.value = true
  try {
    const [globalCatalog, subjectCatalog] = await Promise.all([
      loadGlobalLaw(),
      loadSubjectLaw(editor.value.subjectId),
    ])
    globalLaw.value = globalCatalog
    subjectLaw.value = subjectCatalog
    if ((globalCatalog.catalogOrigin === 'bundled' || subjectCatalog.catalogOrigin === 'bundled') && !catalogSyncPromise) {
      const callable = httpsCallable(functions, 'syncLomloeCatalog', { timeout: 60_000 })
      catalogSyncPromise = callable().catch((error) => {
        console.warn('El catálogo LOMLOE local funciona, pero no se ha podido sincronizar con Firestore:', error)
      })
    }
  } catch (error) {
    console.error('No se ha podido cargar el catálogo LOMLOE:', error)
    showAppErrorToast('No se ha podido cargar el catálogo LOMLOE.')
  } finally {
    loadingLaw.value = false
  }
}

function evidenceStrength(descriptorId) {
  return alignmentTarget.value?.alignment?.descriptorEvidence?.find((item) => item.descriptorId === descriptorId)?.strength || ''
}

function setEvidenceStrength(descriptorId, strength) {
  const alignment = alignmentTarget.value.alignment
  alignment.descriptorEvidence = alignment.descriptorEvidence.filter((item) => item.descriptorId !== descriptorId)
  if (strength) alignment.descriptorEvidence.push({ descriptorId, strength })
  alignment.source = 'manual'
}

async function suggestAlignment() {
  const category = alignmentTarget.value
  if (!category || !evaluationCriteria.value.length || suggestingLevelId.value) return
  suggestingLevelId.value = category.id
  try {
    const callable = httpsCallable(functions, 'suggestRubricAlignment', { timeout: 120_000 })
    const response = await callable({
      model: props.aiModel,
      course: editor.value.course,
      subjectId: editor.value.subjectId,
      subjectTitle: editor.value.subjectTitle,
      rubricTitle: editor.value.title,
      categoryTitle: category.title,
      levelDescription: category.type === 'range'
        ? `${category.range.description}\nCategoría cuantitativa con puntuación entera entre ${category.range.min} y ${category.range.max}, con valor inicial ${category.range.default}.`
        : category.levels.map((level) => `${level.points} puntos: ${level.description}`).join('\n'),
      score: category.type === 'range' ? category.range : null,
      criteria: evaluationCriteria.value,
      competencies: specificCompetencies.value,
      descriptors: relevantDescriptors.value,
    })
    category.alignment = {
      criterionIds: response.data?.criterionIds || [],
      descriptorEvidence: response.data?.descriptorEvidence || [],
      source: 'ai',
      model: response.data?.model || props.aiModel,
    }
  } catch (error) {
    console.error('No se ha podido proponer la vinculación curricular:', error)
    showAppErrorToast(error?.message || 'No se ha podido proponer la vinculación curricular con IA.')
  } finally {
    suggestingLevelId.value = null
  }
}

watch(() => props.teacherId, refresh, { immediate: true })
watch(isValid, emitState)
onMounted(emitState)

defineExpose({ newRubric, closeEditor, save, duplicateActive: () => duplicateRubric(editor.value), requestDeleteActive: () => requestDelete(editor.value) })
</script>

<template>
  <div class="rubric-manager">
    <div v-if="loading" class="rubric-loading">
      <v-progress-circular indeterminate color="primary" />
      <span>Cargando rúbricas…</span>
    </div>

    <section v-else-if="mode === 'library'" class="rubric-library">
      <div v-if="!filteredRubrics.length" class="rubric-empty">
        <v-icon icon="mdi-table-star" size="52" />
        <strong>{{ rubrics.length ? 'Ninguna rúbrica coincide con los filtros' : 'Aún no hay rúbricas' }}</strong>
        <span>{{ rubrics.length ? 'Prueba con otro título o asignatura.' : 'Crea una rúbrica para empezar a evaluar por niveles de desempeño.' }}</span>
        <v-btn v-if="!rubrics.length" color="primary" variant="tonal" prepend-icon="mdi-plus" @click="newRubric">Nueva rúbrica</v-btn>
      </div>
      <div v-else class="rubric-grid">
        <v-card v-for="rubric in filteredRubrics" :key="rubric.id" class="rubric-card" variant="outlined" @click="editRubric(rubric)">
          <v-card-item>
            <template #prepend><v-avatar color="primary" variant="tonal"><v-icon icon="mdi-table-star" /></v-avatar></template>
            <v-card-title>{{ rubric.title }}</v-card-title>
            <v-card-subtitle>{{ rubric.course }} · {{ rubric.subjectTitle }}</v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <div class="rubric-card-stats">
              <span>{{ rubric.categories.length }} categoría{{ rubric.categories.length === 1 ? '' : 's' }}</span>
              <span>{{ rubricStructureLabel(rubric) }}</span>
            </div>
            <small>Actualizada {{ formatDate(rubric.updatedAt) }}</small>
          </v-card-text>
          <v-card-actions>
            <span class="rubric-card-open">Abrir</span>
            <v-spacer />
            <v-menu>
              <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-vertical" size="small" variant="text" aria-label="Más acciones" @click.stop /></template>
              <v-list density="compact">
                <v-list-item prepend-icon="mdi-content-copy" title="Duplicar" @click="duplicateRubric(rubric)" />
                <v-list-item prepend-icon="mdi-delete-outline" title="Eliminar" base-color="error" @click="requestDelete(rubric)" />
              </v-list>
            </v-menu>
          </v-card-actions>
        </v-card>
      </div>
    </section>

    <section v-else class="rubric-editor">
      <div class="rubric-definition">
        <v-select :model-value="editor.course" :items="courseOptions" label="Curso" variant="outlined" density="comfortable" hide-details @update:model-value="setCourse" />
        <v-select :model-value="editor.subjectId" :items="availableSubjects" item-title="title" item-value="id" label="Asignatura" variant="outlined" density="comfortable" hide-details :disabled="!editor.course" @update:model-value="setSubject" />
        <v-text-field v-model="editor.title" label="Título" variant="outlined" density="comfortable" hide-details />
      </div>

      <div class="rubric-categories">
        <article v-for="(category, categoryIndex) in editor.categories" :key="category.id" class="rubric-category">
          <header>
            <span class="rubric-category-number">{{ categoryIndex + 1 }}</span>
            <v-text-field v-model="category.title" label="Categoría" placeholder="Texto corto" variant="outlined" density="compact" hide-details />
            <v-select
              :model-value="category.type"
              :items="[{ title: 'Niveles de desempeño', value: 'levels' }, { title: 'Horquilla de puntuación', value: 'range' }]"
              item-title="title"
              item-value="value"
              label="Tipo"
              variant="outlined"
              density="compact"
              hide-details
              @update:model-value="setCategoryType(category, $event)"
            />
            <v-btn variant="text" size="small" prepend-icon="mdi-link-variant" class="rubric-category-alignment" @click="openAlignment(category)">
              {{ alignmentSummary(category) }}
            </v-btn>
            <v-btn icon="mdi-delete-outline" size="small" rounded="circle" variant="text" color="error" aria-label="Eliminar categoría" @click="removeCategory(categoryIndex)" />
          </header>

          <div class="rubric-category-body">
            <template v-if="category.type === 'levels'">
              <v-radio-group v-model="category.defaultLevelId" hide-details class="rubric-level-list">
                <div v-for="(level, levelIndex) in category.levels" :key="level.id" class="rubric-level-row">
                  <div class="rubric-default-level">
                    <v-radio :value="level.id" color="primary" density="compact" :aria-label="`Usar el nivel ${levelIndex + 1} como valor inicial`" />
                    <small>Inicial</small>
                  </div>
                  <v-textarea v-model="level.description" :label="`Nivel ${levelIndex + 1}`" placeholder="Descripción del desempeño" variant="outlined" density="compact" rows="2" auto-grow hide-details />
                  <v-text-field v-model.number="level.points" type="number" min="0" step="1" label="Puntos" variant="outlined" density="compact" hide-details />
                  <v-btn icon="mdi-delete-outline" size="x-small" rounded="circle" variant="text" color="error" :aria-label="`Eliminar nivel ${levelIndex + 1}`" @click="removeLevel(category, levelIndex)" />
                </div>
              </v-radio-group>
              <v-btn variant="text" color="primary" size="small" prepend-icon="mdi-plus" class="rubric-add-level" @click="addLevel(category)">Añadir nivel</v-btn>
            </template>
            <div v-else class="rubric-range-row">
              <v-textarea v-model="category.range.description" label="Descripción de lo que se valora" placeholder="Describe la evidencia o desempeño que se puntuará dentro de esta horquilla" variant="outlined" density="compact" rows="2" auto-grow hide-details class="rubric-range-description" />
              <v-text-field v-model.number="category.range.min" type="number" step="1" label="Puntuación mínima" variant="outlined" density="compact" hide-details />
              <v-text-field v-model.number="category.range.max" type="number" step="1" label="Puntuación máxima" variant="outlined" density="compact" hide-details />
              <v-text-field v-model.number="category.range.default" type="number" step="1" label="Puntuación inicial" variant="outlined" density="compact" hide-details />
              <span>Se podrá elegir cualquier puntuación entera del intervalo.</span>
            </div>
          </div>
        </article>
        <button type="button" class="rubric-add-category" @click="addCategory">
          <v-icon icon="mdi-plus-circle-outline" size="26" />
          <span>Añadir categoría</span>
        </button>
      </div>
    </section>

    <v-dialog v-model="alignmentDialog" max-width="980" height="min(820px, 90vh)">
      <v-card class="rubric-alignment-dialog">
        <v-card-title>
          <div><small>Vinculación curricular</small><strong>{{ alignmentTarget?.title || 'Categoría' }}</strong></div>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" aria-label="Cerrar" @click="alignmentDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <div v-if="loadingLaw" class="rubric-loading"><v-progress-circular indeterminate color="primary" /><span>Cargando normativa…</span></div>
          <div v-else-if="!evaluationCriteria.length" class="rubric-law-empty">
            <v-icon icon="mdi-bookshelf" size="42" />
            <strong>No hay datos LOMLOE cargados para {{ editor.subjectTitle }}</strong>
            <span>La estructura ya está preparada; falta incorporar el catálogo legal de esta asignatura en Firestore.</span>
          </div>
          <template v-else>
            <div class="rubric-law-heading">
              <div><strong>Criterios de evaluación</strong><span>Selecciona uno o varios criterios vinculados con esta categoría.</span></div>
              <v-btn color="secondary" variant="tonal" size="small" prepend-icon="mdi-auto-fix" :loading="suggestingLevelId === alignmentTarget?.id" @click="suggestAlignment">Proponer con IA</v-btn>
            </div>
            <v-expansion-panels variant="accordion" multiple class="rubric-competencies">
              <v-expansion-panel v-for="competency in specificCompetencies" :key="competency.id">
                <v-expansion-panel-title><span class="rubric-competency-code">{{ competency.code }}</span>{{ competency.title || competency.description }}</v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-checkbox v-for="criterion in evaluationCriteria.filter((item) => item.competenceId === competency.id)" :key="criterion.id" v-model="selectedCriterionIds" :value="criterion.id" color="primary" hide-details>
                    <template #label><span class="rubric-criterion"><strong>{{ criterion.code }}</strong>{{ criterion.description }}</span></template>
                  </v-checkbox>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <div v-if="selectedCriterionIds.length" class="rubric-descriptors">
              <div class="rubric-law-heading"><div><strong>Descriptores operativos</strong><span>Indica la intensidad de la evidencia que aporta esta categoría.</span></div></div>
              <div v-for="descriptor in relevantDescriptors" :key="descriptor.id" class="rubric-descriptor-row">
                <div><strong>{{ descriptor.code }}</strong><span>{{ descriptor.description }}</span></div>
                <v-btn-toggle :model-value="evidenceStrength(descriptor.id)" density="compact" color="primary" variant="outlined" @update:model-value="setEvidenceStrength(descriptor.id, $event)">
                  <v-btn value="weak">Débil</v-btn><v-btn value="medium">Media</v-btn><v-btn value="strong">Fuerte</v-btn>
                </v-btn-toggle>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-divider />
        <v-card-actions><v-spacer /><v-btn color="primary" variant="flat" @click="alignmentDialog = false">Aceptar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="520" :persistent="deleting">
      <v-card>
        <v-card-title class="pt-5 px-6">Eliminar rúbrica</v-card-title>
        <v-card-text class="px-6">Se eliminará «{{ deleteTarget?.title }}» y toda su configuración. Esta acción no se puede deshacer.</v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" :disabled="deleting" @click="deleteDialog = false">Cancelar</v-btn><v-btn color="error" variant="flat" :loading="deleting" @click="confirmDelete">Eliminar</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.rubric-manager { width: 100%; min-height: 100%; background: #f4f7fb; color: #23466f; }
.rubric-loading, .rubric-empty, .rubric-law-empty { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; min-height: 280px; color: #70849c; text-align: center; }
.rubric-library { padding: 18px; }
.rubric-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
.rubric-card { border-color: #d6e1ed; border-radius: 8px; cursor: pointer; transition: border-color .16s, transform .16s; }
.rubric-card:hover { border-color: #7da3cf; transform: translateY(-1px); }
.rubric-card :deep(.v-card-title) { color: #284f7d; font-size: 1rem; font-weight: 750; }
.rubric-card-stats { display: flex; gap: 8px; margin-bottom: 12px; }
.rubric-card-stats span { padding: 4px 9px; border-radius: 999px; background: #edf3fa; color: #456b96; font-size: .76rem; font-weight: 700; }
.rubric-card small { color: #8999aa; }
.rubric-card-open { padding-left: 4px; color: #4e729a; font-size: .75rem; font-weight: 750; }
.rubric-editor { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 20px 0 72px; }
.rubric-definition { display: grid; grid-template-columns: 170px minmax(220px, 1fr) minmax(300px, 2fr); gap: 12px; padding: 16px; border: 1px solid #d5e0ed; border-radius: 8px; background: #fff; }
.rubric-categories { display: grid; gap: 14px; margin-top: 14px; }
.rubric-category { overflow: hidden; border: 1px solid #cfddeb; border-radius: 8px; background: #fff; }
.rubric-category > header { display: grid; grid-template-columns: auto minmax(220px, 1fr) minmax(210px, 260px) auto auto; align-items: center; gap: 9px; padding: 10px 12px; background: #eaf1f9; }
.rubric-category-number { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #3f72af; color: white; font-weight: 800; }
.rubric-category-alignment { max-width: 190px; color: #456b96; font-size: .7rem; letter-spacing: 0; }
.rubric-category-body { padding: 11px 12px 13px; }
.rubric-level-list { margin: 0; }
.rubric-level-list :deep(.v-selection-control-group) { display: grid; gap: 7px; }
.rubric-level-row { display: grid; grid-template-columns: 54px minmax(0, 1fr) 94px 28px; align-items: center; gap: 9px; padding: 8px 9px; border: 1px solid #dce5ef; border-radius: 6px; background: #fbfcfe; }
.rubric-default-level { display: flex; align-items: center; justify-content: center; flex-direction: column; color: #73869c; }
.rubric-default-level :deep(.v-selection-control) { min-height: 25px; }
.rubric-default-level small { margin-top: -4px; font-size: .61rem; text-transform: uppercase; letter-spacing: .04em; }
.rubric-add-level { margin-top: 7px; }
.rubric-range-row { display: grid; grid-template-columns: repeat(3, minmax(130px, 180px)) minmax(220px, 1fr); align-items: center; gap: 10px; }
.rubric-range-description { grid-column: 1 / -1; }
.rubric-range-row > span { color: #788ba1; font-size: .78rem; }
.rubric-add-category { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 62px; border: 1px dashed #9eb7d2; border-radius: 8px; color: #4775a8; background: #f5f8fc; font-weight: 750; cursor: pointer; }
.rubric-alignment-dialog { height: 100%; }
.rubric-alignment-dialog :deep(.v-card-title) { display: flex; align-items: center; padding: 15px 18px; }
.rubric-alignment-dialog :deep(.v-card-title > div) { display: flex; flex-direction: column; }
.rubric-alignment-dialog :deep(.v-card-title small) { color: #7c8ea3; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; }
.rubric-alignment-dialog :deep(.v-card-title strong) { color: #294f7d; font-size: 1rem; }
.rubric-alignment-dialog :deep(.v-card-text) { overflow: auto; }
.rubric-law-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
.rubric-law-heading > div { display: flex; flex-direction: column; }
.rubric-law-heading strong { color: #315d90; }
.rubric-law-heading span { color: #7d8da0; font-size: .82rem; }
.rubric-competency-code { margin-right: 10px; color: #3d70ab; font-weight: 800; }
.rubric-criterion { display: grid; gap: 2px; padding: 5px 0; color: #536c87; font-size: .86rem; line-height: 1.4; }
.rubric-descriptors { margin-top: 22px; }
.rubric-descriptor-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 10px 0; border-top: 1px solid #e0e7ef; }
.rubric-descriptor-row > div { display: grid; gap: 2px; }
.rubric-descriptor-row strong { color: #315d90; }
.rubric-descriptor-row span { color: #657a91; font-size: .8rem; }
.rubric-descriptor-row :deep(.v-btn) { padding-inline: 10px; font-size: .7rem; }
@media (max-width: 760px) {
  .rubric-library { padding: 8px; }
  .rubric-editor { width: calc(100% - 16px); padding-top: 8px; }
  .rubric-definition { grid-template-columns: 1fr; }
  .rubric-category > header { grid-template-columns: auto minmax(0, 1fr) auto; }
  .rubric-category > header > :nth-child(3) { grid-column: 2; }
  .rubric-category-alignment { grid-column: 2; justify-self: start; }
  .rubric-category > header > :last-child { grid-column: 3; grid-row: 1; }
  .rubric-level-row { grid-template-columns: 44px minmax(0, 1fr) 82px 28px; }
  .rubric-range-row { grid-template-columns: repeat(3, 1fr); }
  .rubric-range-row > span { grid-column: 1 / -1; }
  .rubric-descriptor-row { grid-template-columns: 1fr; }
}
</style>
