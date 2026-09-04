<script setup>
import { ref } from 'vue'
import { exportStudentIdentityBundle, importStudentIdentityBundle } from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const exportDialog = ref(false)
const preparedDialog = ref(false)
const importDialog = ref(false)
const password = ref('')
const confirmation = ref('')
const importFile = ref(null)
const preparedFile = ref(null)
const loading = ref(false)

function fileValue(value) {
  return Array.isArray(value) ? value[0] : value
}

async function exportData() {
  loading.value = true
  try {
    if (password.value !== confirmation.value) throw new Error('Las contraseñas no coinciden.')
    const serialized = await exportStudentIdentityBundle(password.value)
    preparedFile.value = new File(
      [serialized],
      `datos-alumnos-neope-${new Date().toISOString().slice(0, 10)}.neope`,
      { type: 'application/json' },
    )
    exportDialog.value = false
    preparedDialog.value = true
    password.value = ''
    confirmation.value = ''
  } catch (error) {
    if (error?.name !== 'AbortError') showAppErrorToast(error?.message || 'No se ha podido exportar el archivo.')
  } finally { loading.value = false }
}

function downloadPreparedFile() {
  const file = preparedFile.value
  if (!file) return
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function sharePreparedFile() {
  const file = preparedFile.value
  if (!file) return
  if (!navigator.canShare?.({ files: [file] })) {
    downloadPreparedFile()
    return
  }
  try {
    // La llamada se realiza directamente desde este segundo clic. De este modo
    // no caduca la activación del usuario durante el cifrado PBKDF2 anterior.
    await navigator.share({ files: [file], title: 'Datos locales de alumnos de Neope' })
  } catch (error) {
    if (error?.name === 'AbortError') return
    downloadPreparedFile()
    showAppErrorToast('El dispositivo ha bloqueado el menú de compartir. Se ha descargado el archivo en su lugar.', { color: 'info', copy: false })
  }
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
  <v-dialog v-model="exportDialog" max-width="500"><v-card title="Exportar datos locales"><v-card-text><p class="mb-4">Elige una contraseña para proteger el archivo. Tendrás que escribirla en el otro dispositivo.</p><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" /><v-text-field v-model="confirmation" label="Confirma la contraseña" type="password" variant="outlined" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="exportDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="exportData">Preparar archivo</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="preparedDialog" max-width="460"><v-card title="Archivo preparado"><v-card-text>El archivo cifrado está listo. Puedes compartirlo directamente o guardarlo en este dispositivo.</v-card-text><v-card-actions><v-btn variant="tonal" prepend-icon="mdi-download-outline" @click="downloadPreparedFile">Descargar</v-btn><v-spacer /><v-btn variant="text" @click="preparedDialog = false">Cerrar</v-btn><v-btn color="primary" prepend-icon="mdi-share-variant-outline" @click="sharePreparedFile">Compartir</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="importDialog" max-width="500"><v-card title="Importar datos locales"><v-card-text><v-file-input v-model="importFile" label="Archivo .neope" variant="outlined" /><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" @keyup.enter="importData" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="importDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="importData">Importar</v-btn></v-card-actions></v-card></v-dialog>
</template>

<style scoped>.local-transfer-card { margin-top: 18px; border-color: #cfdbea; border-radius: 8px; }.local-transfer-card :deep(.v-card-title) { color: #315d90; font-size: 1rem; font-weight: 700; }.local-transfer-card :deep(.v-card-text) { color: #718298; line-height: 1.55; }</style>
