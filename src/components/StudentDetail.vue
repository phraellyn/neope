<script setup>
import { computed, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import {
  identityRecoveryMessage,
  loadStudentIdentitiesForGroup,
  saveStudentIdentities,
  studentIdentityDiagnostics,
} from '../services/localStudentIdentity'
import { loadStudentCompetencyProgress } from '../services/studentCompetencyProgress'
import { showAppErrorToast } from '../composables/useAppErrorToast'
import StudentCompetencyRadar from './StudentCompetencyRadar.vue'

const props = defineProps({
  student: { type: Object, required: true },
  group: { type: Object, required: true },
  configurationMode: { type: Boolean, default: false },
})

const emit = defineEmits(['saved', 'error'])
const identity = ref(emptyIdentity())
const isLoading = ref(true)
const isSaving = ref(false)
const competencyLoading = ref(false)
const competencyValues = ref([])
const error = ref('')
const activeTab = ref('personal')
watch(error, (message) => {
  if (message) showAppErrorToast(message)
})
const photoDragActive = ref(false)
const resetAccessDialog = ref(false)
const isResettingAccess = ref(false)
let ready = false
let saveSequence = 0
let competencyLoadSequence = 0

function emptyGuardian() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `tutor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nombre: '',
    correo: '',
    telefono: '',
    trabajo: '',
    parentesco: '',
  }
}

function emptyInterview() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `entrevista-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    date: new Date().toISOString().slice(0, 10),
    type: 'presencial',
    attendees: {
      mother: false,
      father: false,
      student: false,
      others: false,
      othersDetail: '',
    },
    summary: '',
  }
}

function normalizedInterviews(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((interview) => ({
      ...emptyInterview(),
      ...(interview || {}),
      attendees: { ...emptyInterview().attendees, ...(interview?.attendees || {}) },
    }))
    .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
}

function normalizedGuardians(value) {
  const guardians = Array.isArray(value)
    ? value.map((guardian) => ({ ...emptyGuardian(), ...(guardian || {}) }))
    : []
  while (guardians.length < 2) guardians.push(emptyGuardian())
  return guardians
}

function emptyIdentity() {
  return {
    id: '',
    nombre: '',
    nombreCorto: '',
    foto: '',
    fechaNacimiento: '',
    lugarNacimiento: '',
    domicilio: '',
    correo: '',
    telefono: '',
    asignaturasPendientes: [],
    tutores: normalizedGuardians([]),
    entrevistas: [],
    repetidor: false,
    pendiente: false,
    nuevo: false,
  }
}

const age = computed(() => {
  const match = String(identity.value.fechaNacimiento || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const birthDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) return null
  const today = new Date()
  let years = today.getFullYear() - birthDate.getFullYear()
  const birthdayPending = today.getMonth() < birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())
  if (birthdayPending) years -= 1
  return years >= 0 ? years : null
})

const sortedInterviews = computed(() => identity.value.entrevistas
  .map((interview, index) => ({ interview, index }))
  .sort((left, right) => String(right.interview.date || '').localeCompare(String(left.interview.date || ''))))

function applyStudent(value) {
  const pendingSubjects = Array.isArray(value?.asignaturasPendientes)
    ? value.asignaturasPendientes.filter((subject) => String(subject || '').trim())
    : []
  identity.value = {
    id: value?.id || '',
    nombre: value?.nombre || '',
    nombreCorto: value?.nombreCorto || '',
    foto: value?.foto || '',
    fechaNacimiento: value?.fechaNacimiento || '',
    lugarNacimiento: value?.lugarNacimiento || '',
    domicilio: value?.domicilio || '',
    correo: value?.correo || '',
    telefono: value?.telefono || '',
    asignaturasPendientes: pendingSubjects,
    tutores: normalizedGuardians(value?.tutores),
    entrevistas: normalizedInterviews(value?.entrevistas),
    repetidor: Boolean(value?.repetidor),
    pendiente: Boolean(value?.pendiente || pendingSubjects.length),
    nuevo: Boolean(value?.nuevo),
  }
}

function updatePendingSubjects(value) {
  identity.value.asignaturasPendientes = Array.isArray(value)
    ? value.map((subject) => String(subject || '').trim()).filter(Boolean)
    : []
  identity.value.pendiente = identity.value.asignaturasPendientes.length > 0
}

function addGuardian() {
  identity.value.tutores.push(emptyGuardian())
}

function removeGuardian(index) {
  if (identity.value.tutores.length <= 2) {
    identity.value.tutores[index] = emptyGuardian()
    return
  }
  identity.value.tutores.splice(index, 1)
}

function addInterview() {
  identity.value.entrevistas.unshift(emptyInterview())
}

function removeInterview(index) {
  identity.value.entrevistas.splice(index, 1)
}

function toggleFlag(field) {
  if (!props.configurationMode) return
  identity.value[field] = !identity.value[field]
}

async function persist() {
  if (!ready || !identity.value.id) return
  const sequence = ++saveSequence
  isSaving.value = true
  error.value = ''
  try {
    await saveStudentIdentities(props.group.id, [{ ...identity.value }], { preserveEmpty: false })
    if (sequence === saveSequence) emit('saved', { ...identity.value })
  } catch (cause) {
    error.value = 'No se han podido guardar los datos en este dispositivo.'
    emit('error', cause)
  } finally {
    if (sequence === saveSequence) isSaving.value = false
  }
}

async function load() {
  isLoading.value = true
  ready = false
  try {
    const stored = await loadStudentIdentitiesForGroup(props.group)
    const diagnostics = studentIdentityDiagnostics(stored)
    applyStudent({ ...props.student, ...(stored.get(props.student.id) || {}) })
    if (diagnostics.failed) {
      showAppErrorToast(identityRecoveryMessage(diagnostics), { color: 'warning', copy: false })
    }
  } catch (cause) {
    applyStudent(props.student)
    error.value = cause?.message || 'No se han podido abrir los datos locales de este alumno.'
    emit('error', cause)
  } finally {
    isLoading.value = false
    ready = true
  }
}

async function loadCompetencies() {
  const sequence = ++competencyLoadSequence
  competencyLoading.value = true
  try {
    const values = await loadStudentCompetencyProgress(props.group, props.student.id)
    if (sequence === competencyLoadSequence) competencyValues.value = values
  } catch (cause) {
    console.error('No se ha podido calcular el perfil competencial:', cause)
    if (sequence === competencyLoadSequence) {
      competencyValues.value = []
      showAppErrorToast('No se ha podido calcular el perfil competencial del alumno.')
    }
  } finally {
    if (sequence === competencyLoadSequence) competencyLoading.value = false
  }
}

function setPhotoFile(file) {
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => { identity.value.foto = String(reader.result || '') }
  reader.readAsDataURL(file)
}

function selectPhoto(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  setPhotoFile(file)
}

function dropPhoto(event) {
  photoDragActive.value = false
  if (!props.configurationMode) return
  setPhotoFile(event.dataTransfer?.files?.[0])
}

function startPhotoDrag() { if (props.configurationMode) photoDragActive.value = true }

function clearPhoto() { identity.value.foto = '' }

async function resetStudentPassword() {
  isResettingAccess.value = true
  try {
    await httpsCallable(functions, 'resetStudentAccess')({ groupId: props.group.id, code: identity.value.id })
    resetAccessDialog.value = false
    showAppErrorToast('El acceso se ha restablecido. El alumno podrá elegir una contraseña nueva con el mismo código.', { color: 'success', copy: false })
  } catch (cause) {
    showAppErrorToast(cause?.message || 'No se ha podido restablecer el acceso del alumno.')
  } finally {
    isResettingAccess.value = false
  }
}

watch(() => [props.student, props.group], load, { immediate: true, deep: true })
watch(() => [props.student.id, props.group], loadCompetencies, { immediate: true, deep: true })
watch(identity, persist, { deep: true })

defineExpose({ persist })
</script>

<template>
  <div class="student-detail-view">
    <header class="student-detail-header">
      <div>
        <span>Ficha del alumno</span>
        <h1>{{ identity.nombre || identity.nombreCorto || 'Alumno sin identificar' }}</h1>
      </div>
      <code>{{ identity.id }}</code>
    </header>
    <div class="student-detail-grid">
      <v-card class="student-detail-card student-detail-main-card" variant="flat">
        <v-tabs v-model="activeTab" class="student-detail-tabs" density="compact" color="primary" grow>
          <v-tab value="personal">Datos personales y familiares</v-tab>
          <v-tab value="results">Resultados académicos</v-tab>
          <v-tab value="interviews">Entrevistas</v-tab>
        </v-tabs>
        <v-window v-model="activeTab" class="student-detail-tab-content">
          <v-window-item value="personal">
            <v-card-item>
              <v-card-title>Datos personales</v-card-title>
              <v-card-subtitle>La información se guarda únicamente en este dispositivo.</v-card-subtitle>
            </v-card-item>
            <v-card-text class="student-detail-form">
              <v-text-field v-model="identity.nombre" class="student-field-name" label="Nombre completo" placeholder="APELLIDO 1 APELLIDO 2, Nombre" :readonly="!configurationMode" :loading="isLoading" variant="outlined" density="compact" hide-details />
              <v-text-field v-model="identity.nombreCorto" class="student-field-short-name" label="Nombre corto" placeholder="Nombre para el aula" :readonly="!configurationMode" :loading="isLoading" variant="outlined" density="compact" hide-details />
              <div class="student-detail-code student-field-code"><span>Código pseudónimo</span><code>{{ identity.id }}</code></div>

              <v-text-field v-model="identity.fechaNacimiento" class="student-field-birth-date" label="Fecha de nacimiento" type="date" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
              <div class="student-detail-age"><span>Edad</span><strong>{{ age === null ? '—' : `${age} años` }}</strong></div>
              <v-text-field v-model="identity.lugarNacimiento" class="student-field-birth-place" label="Lugar de nacimiento" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />

              <v-text-field v-model="identity.domicilio" class="student-field-address" label="Domicilio" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
              <v-text-field v-model="identity.correo" class="student-field-email" label="Correo electrónico" type="email" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
              <v-text-field v-model="identity.telefono" class="student-field-phone" label="Teléfono" type="tel" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />

              <div class="student-detail-flags">
                <button type="button" :class="{ active: identity.nuevo }" :aria-pressed="identity.nuevo" :disabled="!configurationMode" @click="toggleFlag('nuevo')"><v-icon icon="mdi-account-star-outline" size="17" />Nuevo</button>
                <button type="button" :class="{ active: identity.repetidor }" :aria-pressed="identity.repetidor" :disabled="!configurationMode" @click="toggleFlag('repetidor')"><v-icon icon="mdi-backup-restore" size="17" />Repite curso</button>
              </div>
              <v-combobox
                :model-value="identity.asignaturasPendientes"
                class="student-field-pending"
                label="Asignaturas pendientes de cursos anteriores"
                multiple
                chips
                closable-chips
                :readonly="!configurationMode"
                variant="outlined"
                density="compact"
                hide-details
                @update:model-value="updatePendingSubjects"
              />
              <v-btn v-if="configurationMode" class="student-reset-access" size="small" variant="text" color="primary" prepend-icon="mdi-lock-reset" @click="resetAccessDialog = true">Restablecer contraseña</v-btn>
            </v-card-text>

            <v-divider />
            <v-card-item class="student-guardians-heading">
              <v-card-title>Tutores legales</v-card-title>
              <template #append>
                <v-btn v-if="configurationMode" size="small" variant="text" prepend-icon="mdi-plus" @click="addGuardian">Añadir tutor</v-btn>
              </template>
            </v-card-item>
            <v-card-text class="student-guardians-table">
              <div class="student-guardian-labels" aria-hidden="true">
                <span>Nombre</span><span>Correo</span><span>Teléfono</span><span>Trabajo</span><span>Parentesco</span><span />
              </div>
              <div v-for="(guardian, index) in identity.tutores" :key="guardian.id" class="student-guardian-row">
                <v-text-field v-model="guardian.nombre" :label="`Tutor ${index + 1} · Nombre`" :aria-label="`Nombre del tutor ${index + 1}`" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
                <v-text-field v-model="guardian.correo" :label="`Tutor ${index + 1} · Correo`" :aria-label="`Correo del tutor ${index + 1}`" type="email" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
                <v-text-field v-model="guardian.telefono" :label="`Tutor ${index + 1} · Teléfono`" :aria-label="`Teléfono del tutor ${index + 1}`" type="tel" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
                <v-text-field v-model="guardian.trabajo" :label="`Tutor ${index + 1} · Trabajo`" :aria-label="`Trabajo del tutor ${index + 1}`" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
                <v-text-field v-model="guardian.parentesco" :label="`Tutor ${index + 1} · Parentesco`" :aria-label="`Parentesco del tutor ${index + 1}`" :readonly="!configurationMode" variant="outlined" density="compact" hide-details />
                <v-btn v-if="configurationMode" icon="mdi-close" size="x-small" rounded="circle" variant="text" color="error" :aria-label="`Eliminar tutor ${index + 1}`" @click="removeGuardian(index)" />
              </div>
            </v-card-text>
          </v-window-item>

          <v-window-item value="results">
            <div class="student-detail-empty-tab">
              <v-icon icon="mdi-chart-line" size="42" color="primary" />
              <h2>Resultados académicos</h2>
              <p>Aquí reuniremos la información académica del alumno cuando definamos esta parte de la ficha.</p>
            </div>
          </v-window-item>

          <v-window-item value="interviews">
            <v-card-item class="student-interviews-heading">
              <v-card-title>Entrevistas</v-card-title>
              <v-card-subtitle>Ordenadas desde la más reciente.</v-card-subtitle>
              <template #append>
                <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addInterview">Añadir entrevista</v-btn>
              </template>
            </v-card-item>
            <v-card-text class="student-interviews-list">
              <div v-if="!identity.entrevistas.length" class="student-detail-empty-list">Aún no hay entrevistas registradas.</div>
              <v-card v-for="{ interview, index } in sortedInterviews" :key="interview.id" class="student-interview-card" variant="outlined">
                <div class="student-interview-card-header">
                  <v-text-field v-model="interview.date" type="date" label="Fecha" variant="outlined" density="compact" hide-details />
                  <v-btn-toggle v-model="interview.type" mandatory color="primary" density="compact" class="student-interview-type">
                    <v-btn value="presencial">Presencial</v-btn>
                    <v-btn value="telefonica">Telefónica</v-btn>
                  </v-btn-toggle>
                  <v-btn icon="mdi-delete-outline" size="x-small" rounded="circle" variant="text" color="error" :aria-label="`Eliminar entrevista ${index + 1}`" @click="removeInterview(index)" />
                </div>
                <div class="student-interview-attendees">
                  <span>Asisten</span>
                  <v-checkbox v-model="interview.attendees.mother" label="Madre" density="compact" hide-details />
                  <v-checkbox v-model="interview.attendees.father" label="Padre" density="compact" hide-details />
                  <v-checkbox v-model="interview.attendees.student" label="Alumno" density="compact" hide-details />
                  <v-checkbox v-model="interview.attendees.others" label="Otros" density="compact" hide-details />
                  <v-text-field v-if="interview.attendees.others" v-model="interview.attendees.othersDetail" label="Especificar" variant="outlined" density="compact" hide-details />
                </div>
                <v-textarea v-model="interview.summary" label="Impresiones, acuerdos y seguimiento" rows="3" auto-grow variant="outlined" density="compact" hide-details />
              </v-card>
            </v-card-text>
          </v-window-item>
        </v-window>
      </v-card>

      <v-card class="student-detail-photo-card" variant="flat">
        <div class="student-detail-photo" :class="{ 'student-detail-photo-empty': !identity.foto, 'student-detail-photo-dragging': photoDragActive }" @dragenter.prevent="startPhotoDrag" @dragover.prevent="startPhotoDrag" @dragleave.prevent="photoDragActive = false" @drop.prevent="dropPhoto">
          <img v-if="identity.foto" :src="identity.foto" alt="Fotografía del alumno">
          <v-icon v-else icon="mdi-account-school-outline" size="72" />
        </div>
        <v-card-actions class="student-detail-photo-actions">
          <v-btn v-if="configurationMode" size="small" variant="tonal" color="primary" prepend-icon="mdi-camera-outline" @click="$refs.photoInput?.click()">Cambiar fotografía</v-btn>
          <v-btn v-if="configurationMode && identity.foto" icon="mdi-delete-outline" size="small" variant="text" aria-label="Eliminar fotografía" @click="clearPhoto" />
          <input ref="photoInput" type="file" accept="image/*" hidden @change="selectPhoto">
        </v-card-actions>
        <div class="student-detail-local-note"><v-icon icon="mdi-lock-outline" size="15" /> Datos personales locales y cifrados</div>
        <StudentCompetencyRadar :values="competencyValues" :loading="competencyLoading" />
      </v-card>
    </div>
    <div v-if="isSaving" class="student-detail-saving">Guardando en este dispositivo…</div>
    <v-dialog v-model="resetAccessDialog" max-width="460">
      <v-card title="Restablecer acceso del alumno">
        <v-card-text>La contraseña actual dejará de funcionar. El alumno podrá elegir otra al entrar de nuevo con el código <strong>{{ identity.id }}</strong>.</v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="resetAccessDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="isResettingAccess" @click="resetStudentPassword">Restablecer</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
