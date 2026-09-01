<script setup>
import { ref } from 'vue'
import { exportStudentIdentityBundle, importStudentIdentityBundle } from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const exportDialog = ref(false)
const importDialog = ref(false)
const password = ref('')
const confirmation = ref('')
const importFile = ref(null)
const loading = ref(false)

function fileValue(value) {
  return Array.isArray(value) ? value[0] : value
}

async function exportData() {
  loading.value = true
  try {
    if (password.value !== confirmation.value) throw new Error('Las contraseñas no coinciden.')
    const serialized = await exportStudentIdentityBundle(password.value)
    const file = new File([serialized], `datos-alumnos-neope-${new Date().toISOString().slice(0, 10)}.neope`, { type: 'application/json' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Datos locales de alumnos de Neope' })
    } else {
      const url = URL.createObjectURL(file)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    exportDialog.value = false
    password.value = ''
    confirmation.value = ''
  } catch (error) {
    if (error?.name !== 'AbortError') showAppErrorToast(error?.message || 'No se ha podido exportar el archivo.')
  } finally { loading.value = false }
}

async function importData() {
  loading.value = true
  try {
    const file = fileValue(importFile.value)
    if (!file) throw new Error('Selecciona el archivo que quieres importar.')
    const result = await importStudentIdentityBundle(await file.text(), password.value)
    importDialog.value = false
    importFile.value = null
    password.value = ''
    showAppErrorToast(`Se han importado los datos locales de ${result.students} alumnos. Recarga el grupo para verlos.`, { color: 'success', copy: false })
  } catch (error) {
    showAppErrorToast(error?.message || 'No se ha podido importar el archivo.')
  } finally { loading.value = false }
}

function open(kind) {
  password.value = ''
  confirmation.value = ''
  importFile.value = null
  if (kind === 'export') exportDialog.value = true
  else importDialog.value = true
}
</script>

<template>
  <v-card class="local-transfer-card" variant="outlined">
    <v-card-title><v-icon icon="mdi-shield-lock-outline" class="mr-2" />Datos privados de alumnos</v-card-title>
    <v-card-text>Comparte nombres, fotografías y observaciones entre tus dispositivos mediante un archivo cifrado. El archivo no pasa por Neope ni por Firebase.</v-card-text>
    <v-card-actions><v-btn variant="tonal" prepend-icon="mdi-export" @click="open('export')">Exportar archivo</v-btn><v-btn variant="tonal" prepend-icon="mdi-import" @click="open('import')">Importar archivo</v-btn></v-card-actions>
  </v-card>
  <v-dialog v-model="exportDialog" max-width="500"><v-card title="Exportar datos locales"><v-card-text><p class="mb-4">Elige una contraseña para proteger el archivo. Tendrás que escribirla en el otro dispositivo.</p><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" /><v-text-field v-model="confirmation" label="Confirma la contraseña" type="password" variant="outlined" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="exportDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="exportData">Compartir</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="importDialog" max-width="500"><v-card title="Importar datos locales"><v-card-text><v-file-input v-model="importFile" label="Archivo .neope" accept=".neope,application/json" variant="outlined" /><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" @keyup.enter="importData" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="importDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="importData">Importar</v-btn></v-card-actions></v-card></v-dialog>
</template>

<style scoped>.local-transfer-card { margin-top: 18px; border-color: #cfdbea; border-radius: 8px; }.local-transfer-card :deep(.v-card-title) { color: #315d90; font-size: 1rem; font-weight: 700; }.local-transfer-card :deep(.v-card-text) { color: #718298; line-height: 1.55; }</style>
