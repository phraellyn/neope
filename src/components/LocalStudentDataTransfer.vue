<script setup>
import { onMounted, ref } from 'vue'
import {
  clearAllLocalStudentIdentities,
  exportStudentIdentityBundle,
  importStudentIdentityBundle,
  linkedStudentIdentityFileStatus,
  linkStudentIdentityFile,
  supportsLinkedStudentIdentityFile,
  syncStudentIdentitiesFromLinkedFile,
  unlinkStudentIdentityFile,
} from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const exportDialog = ref(false)
const preparedDialog = ref(false)
const importDialog = ref(false)
const linkDialog = ref(false)
const clearDialog = ref(false)
const password = ref('')
const confirmation = ref('')
const importFile = ref(null)
const preparedFile = ref(null)
const loading = ref(false)
const linkedFile = ref({ supported: supportsLinkedStudentIdentityFile(), linked: false, permission: 'none', name: '' })

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

async function refreshLinkedFileStatus() {
  try {
    linkedFile.value = await linkedStudentIdentityFileStatus()
  } catch {
    linkedFile.value = { supported: supportsLinkedStudentIdentityFile(), linked: false, permission: 'none', name: '' }
  }
}

async function linkFile() {
  loading.value = true
  try {
    if (password.value.length < 8) throw new Error('La contraseña del archivo debe tener al menos 8 caracteres.')
    const handle = await globalThis.showSaveFilePicker({
      suggestedName: 'datos-alumnos-neope.neope',
      types: [{ description: 'Datos privados de Neope', accept: { 'application/json': ['.neope'] } }],
    })
    linkedFile.value = await linkStudentIdentityFile(handle, password.value)
    linkDialog.value = false
    password.value = ''
    showAppErrorToast('Archivo local vinculado. Utiliza este mismo archivo en desarrollo y en producción.', { color: 'success', copy: false })
  } catch (error) {
    if (error?.name !== 'AbortError') showAppErrorToast(error?.message || 'No se ha podido vincular el archivo local.')
  } finally { loading.value = false }
}

async function syncLinkedFile() {
  loading.value = true
  try {
    const result = await syncStudentIdentitiesFromLinkedFile({ requestPermission: true })
    await refreshLinkedFileStatus()
    showAppErrorToast(
      result ? `Archivo sincronizado: ${result.students} alumnos disponibles. Vuelve a abrir el grupo para verlos.` : 'El archivo local ya está sincronizado.',
      { color: 'success', copy: false },
    )
  } catch (error) {
    showAppErrorToast(error?.message || 'No se ha podido sincronizar el archivo local.')
  } finally { loading.value = false }
}

async function unlinkFile() {
  await unlinkStudentIdentityFile()
  await refreshLinkedFileStatus()
  showAppErrorToast('El archivo se ha desvinculado de este origen. Los datos locales no se han borrado.', { color: 'info', copy: false })
}

async function clearLocalData() {
  loading.value = true
  try {
    const result = await clearAllLocalStudentIdentities()
    clearDialog.value = false
    await refreshLinkedFileStatus()
    showAppErrorToast(
      result.linkedFileCleared
        ? 'Se han borrado todos los datos personales locales. Los códigos y calificaciones de Firebase no se han modificado.'
        : 'Se han borrado los datos del navegador, pero el archivo vinculado no tenía permiso de escritura y se ha desvinculado. Bórralo manualmente si ya no lo necesitas.',
      { color: result.linkedFileCleared ? 'success' : 'warning', copy: false },
    )
  } catch (error) {
    showAppErrorToast(error?.message || 'No se han podido borrar los datos locales.')
  } finally { loading.value = false }
}

function open(kind) {
  password.value = ''
  confirmation.value = ''
  importFile.value = null
  if (kind === 'export') exportDialog.value = true
  else importDialog.value = true
}

function openLinkDialog() {
  password.value = ''
  linkDialog.value = true
}

onMounted(refreshLinkedFileStatus)
</script>

<template>
  <v-card class="local-transfer-card" variant="outlined">
    <v-card-title><v-icon icon="mdi-shield-lock-outline" class="mr-2" />Datos privados de alumnos</v-card-title>
    <v-card-text>
      Nombres, fotografías y observaciones permanecen cifrados en este dispositivo. Puedes vincular el mismo archivo en desarrollo y producción; nunca pasa por Neope ni por Firebase.
      <div v-if="linkedFile.linked" class="local-transfer-linked">
        <v-icon icon="mdi-file-link-outline" size="17" />
        <strong>{{ linkedFile.name }}</strong>
        <span>{{ linkedFile.permission === 'granted' ? 'Sincronización automática activa' : 'Necesita permiso para sincronizar' }}</span>
      </div>
    </v-card-text>
    <v-card-actions class="flex-wrap">
      <template v-if="linkedFile.supported">
        <v-btn v-if="!linkedFile.linked" variant="tonal" prepend-icon="mdi-file-link-outline" @click="openLinkDialog">Vincular archivo local</v-btn>
        <template v-else>
          <v-btn variant="tonal" prepend-icon="mdi-sync" :loading="loading" @click="syncLinkedFile">Sincronizar</v-btn>
          <v-btn variant="text" prepend-icon="mdi-link-off" @click="unlinkFile">Desvincular</v-btn>
        </template>
      </template>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-export" @click="open('export')">Exportar copia</v-btn>
      <v-btn variant="text" prepend-icon="mdi-import" @click="open('import')">Importar copia</v-btn>
      <v-btn variant="text" color="error" prepend-icon="mdi-delete-outline" @click="clearDialog = true">Borrar datos locales</v-btn>
    </v-card-actions>
  </v-card>
  <v-dialog v-model="exportDialog" max-width="500"><v-card title="Exportar datos locales"><v-card-text><p class="mb-4">Elige una contraseña para proteger el archivo. Tendrás que escribirla en el otro dispositivo.</p><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" /><v-text-field v-model="confirmation" label="Confirma la contraseña" type="password" variant="outlined" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="exportDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="exportData">Preparar archivo</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="preparedDialog" max-width="460"><v-card title="Archivo preparado"><v-card-text>El archivo cifrado está listo. Puedes compartirlo directamente o guardarlo en este dispositivo.</v-card-text><v-card-actions><v-btn variant="tonal" prepend-icon="mdi-download-outline" @click="downloadPreparedFile">Descargar</v-btn><v-spacer /><v-btn variant="text" @click="preparedDialog = false">Cerrar</v-btn><v-btn color="primary" prepend-icon="mdi-share-variant-outline" @click="sharePreparedFile">Compartir</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="importDialog" max-width="500"><v-card title="Importar datos locales"><v-card-text><v-file-input v-model="importFile" label="Archivo .neope" variant="outlined" /><v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" @keyup.enter="importData" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="importDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="importData">Importar</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="linkDialog" max-width="520">
    <v-card title="Vincular archivo local">
      <v-card-text>
        <p class="mb-4">Elige o crea un archivo <strong>.neope</strong>. Para compartir los datos entre desarrollo y producción, selecciona este mismo archivo en ambas versiones.</p>
        <v-text-field v-model="password" label="Contraseña del archivo" type="password" variant="outlined" hint="La clave cifrada queda en este navegador y nunca se envía al backend." persistent-hint @keyup.enter="linkFile" />
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn variant="text" @click="linkDialog = false">Cancelar</v-btn><v-btn color="primary" :loading="loading" @click="linkFile">Elegir archivo</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="clearDialog" max-width="520">
    <v-card title="Borrar datos personales locales">
      <v-card-text>Se eliminarán de este navegador los nombres, fotografías y demás datos personales de todos los alumnos. Si hay un archivo compartido vinculado, también se vaciará. Los códigos pseudónimos, calificaciones y datos de Firebase no se modificarán.</v-card-text>
      <v-card-actions><v-spacer /><v-btn variant="text" @click="clearDialog = false">Cancelar</v-btn><v-btn color="error" variant="flat" :loading="loading" @click="clearLocalData">Borrar definitivamente</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>.local-transfer-card { margin-top: 18px; border-color: #cfdbea; border-radius: 8px; }.local-transfer-card :deep(.v-card-title) { color: #315d90; font-size: 1rem; font-weight: 700; }.local-transfer-card :deep(.v-card-text) { color: #718298; line-height: 1.55; }.local-transfer-linked { display: flex; align-items: center; gap: 7px; margin-top: 12px; padding: 7px 9px; border-radius: 6px; background: #edf3fa; }.local-transfer-linked strong { color: #315d90; }.local-transfer-linked span { margin-left: auto; color: #718298; font-size: .72rem; }</style>
