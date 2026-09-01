<script setup>
import { useAppErrorToast } from '../composables/useAppErrorToast'

const { visible, message, copyText, color } = useAppErrorToast()

async function copyError() {
  if (!copyText.value) return
  try {
    await navigator.clipboard.writeText(copyText.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = copyText.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}
</script>

<template>
  <v-snackbar v-model="visible" location="bottom" :color="color" timeout="-1" class="app-error-toast">
    <div class="app-error-toast-message">{{ message }}</div>
    <template #actions>
      <v-btn v-if="copyText" variant="text" size="small" @click="copyError">Copiar</v-btn>
      <v-btn icon="mdi-close" variant="text" size="small" aria-label="Cerrar error" @click="visible = false" />
    </template>
  </v-snackbar>
</template>

<style scoped>
.app-error-toast-message {
  max-width: min(72vw, 960px);
  max-height: 30vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: .82rem;
  line-height: 1.35;
}
</style>
