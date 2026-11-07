<script setup>
import { ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
const props = defineProps({ group: { type: Object, required: true } })
const emit = defineEmits(['read'])
const messages = ref([])
const text = ref('')
const busy = ref(false)
const error = ref('')
const labels = { pending: 'Pendiente', waiting: 'En espera', resolved: 'Atendida', dismissed: 'Descartada' }
let requestId = 0
async function load(send = false) {
  const request = ++requestId
  busy.value = true; error.value = ''
  try {
    const result = await httpsCallable(functions, 'manageStudentMessages')({ groupId: props.group.id, markRead: true, ...(send ? { text: text.value } : {}) })
    if (request !== requestId) return
    messages.value = result.data.messages
    emit('read')
    if (send) text.value = ''
  } catch (cause) { if (request === requestId) error.value = cause.message || 'No se han podido cargar los mensajes.' }
  finally { if (request === requestId) busy.value = false }
}
watch(() => props.group.id, () => { messages.value = []; text.value = ''; void load() }, { immediate: true })
</script>
<template>
  <section class="student-messages">
    <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
    <v-textarea v-model="text" label="Sugerencia o aviso para el profesor" variant="outlined" rows="3" maxlength="2000" counter />
    <v-btn color="primary" :loading="busy" :disabled="!text.trim()" @click="load(true)">Enviar</v-btn>
    <article v-for="message in messages" :key="message.id" class="student-message"><div><strong>{{ labels[message.status] || 'Pendiente' }}</strong><small>{{ new Date(message.createdAt).toLocaleDateString('es-ES') }}</small></div><p>{{ message.text }}</p><p v-if="message.reply" class="student-reply"><strong>Respuesta del profesor:</strong> {{ message.reply }}</p></article>
    <p v-if="!busy && !messages.length">Todavía no has enviado mensajes.</p>
  </section>
</template>
<style scoped>.student-messages { display: grid; gap: 12px; }.student-messages > .v-btn { justify-self: start; }.student-message { padding: 12px; border: 1px solid #d6e1ed; border-radius: 8px; background: #fff; }.student-message > div { display: flex; justify-content: space-between; gap: 8px; color: #6b829b; font-size: .78rem; }.student-message p { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }.student-reply { padding: 8px; border-radius: 6px; background: #edf4fb; }</style>
