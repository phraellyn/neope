<script setup>
import { ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import { loadStudentIdentitiesForGroup, saveStudentIdentities } from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  student: { type: Object, required: true },
  group: { type: Object, required: true },
  configurationMode: { type: Boolean, default: false },
})

const emit = defineEmits(['saved', 'error'])
const identity = ref({ id: '', nombre: '', nombreCorto: '', foto: '', repetidor: false, pendiente: false, nuevo: false })
const isLoading = ref(true)
const isSaving = ref(false)
const error = ref('')
watch(error, (message) => {
  if (message) showAppErrorToast(message)
})
const photoDragActive = ref(false)
const resetAccessDialog = ref(false)
const isResettingAccess = ref(false)
let ready = false
let saveSequence = 0

function applyStudent(value) {
  identity.value = {
    id: value?.id || '',
    nombre: value?.nombre || '',
    nombreCorto: value?.nombreCorto || '',
    foto: value?.foto || '',
    repetidor: Boolean(value?.repetidor),
    pendiente: Boolean(value?.pendiente),
    nuevo: Boolean(value?.nuevo),
  }
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
    applyStudent({ ...props.student, ...(stored.get(props.student.id) || {}) })
  } catch (cause) {
    applyStudent(props.student)
    error.value = 'No se han podido abrir los datos locales de este alumno.'
    emit('error', cause)
  } finally {
    isLoading.value = false
    ready = true
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
watch(identity, persist, { deep: true })

defineExpose({ persist })
</script>

<template>
  <div class="student-detail-view">
    <div class="student-detail-grid">
      <v-card class="student-detail-card" variant="flat">
        <v-card-item>
          <v-card-title>Datos del alumno</v-card-title>
          <v-card-subtitle>La información se guarda únicamente en este dispositivo.</v-card-subtitle>
        </v-card-item>
        <v-card-text class="student-detail-form">
          <v-text-field v-model="identity.nombre" label="Nombre completo" placeholder="APELLIDO 1 APELLIDO 2, Nombre" :readonly="!configurationMode" :loading="isLoading" variant="outlined" density="comfortable" hide-details="auto" />
          <v-text-field v-model="identity.nombreCorto" label="Nombre corto" placeholder="Nombre para el aula" :readonly="!configurationMode" :loading="isLoading" variant="outlined" density="comfortable" hide-details="auto" />
          <div class="student-detail-code"><span>Código pseudónimo</span><code>{{ identity.id }}</code></div>
          <v-btn v-if="configurationMode" variant="tonal" color="primary" prepend-icon="mdi-lock-reset" @click="resetAccessDialog = true">Restablecer contraseña de acceso</v-btn>
          <div class="student-detail-flags">
            <div class="student-detail-flags-title">Indicadores</div>
            <v-switch v-model="identity.repetidor" label="Repetidor" color="primary" :disabled="!configurationMode" hide-details density="compact" />
            <v-switch v-model="identity.pendiente" label="Pendiente" color="primary" :disabled="!configurationMode" hide-details density="compact" />
            <v-switch v-model="identity.nuevo" label="Nuevo" color="primary" :disabled="!configurationMode" hide-details density="compact" />
          </div>
        </v-card-text>
      </v-card>

      <v-card class="student-detail-photo-card" variant="flat">
        <div class="student-detail-photo" :class="{ 'student-detail-photo-empty': !identity.foto, 'student-detail-photo-dragging': photoDragActive }" @dragenter.prevent="startPhotoDrag" @dragover.prevent="startPhotoDrag" @dragleave.prevent="photoDragActive = false" @drop.prevent="dropPhoto">
          <img v-if="identity.foto" :src="identity.foto" alt="Fotografía del alumno">
          <v-icon v-else icon="mdi-account-school-outline" size="72" />
        </div>
        <v-card-actions class="student-detail-photo-actions">
          <v-btn variant="tonal" color="primary" prepend-icon="mdi-camera-outline" :disabled="!configurationMode" @click="$refs.photoInput?.click()">Cambiar fotografía</v-btn>
          <v-btn v-if="identity.foto" icon="mdi-delete-outline" variant="text" aria-label="Eliminar fotografía" :disabled="!configurationMode" @click="clearPhoto" />
          <input ref="photoInput" type="file" accept="image/*" hidden @change="selectPhoto">
        </v-card-actions>
        <div class="student-detail-local-note"><v-icon icon="mdi-lock-outline" size="15" /> Fotografía local y cifrada</div>
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
