<script setup>
import { computed, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
const props = defineProps({ groupId: { type: String, required: true }, student: { type: Object, required: true }, modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'changed'])
const messages = ref([])
const replies = ref({})
const busy = ref(false)
const error = ref('')
const labels = { pending: 'Pendiente', waiting: 'En espera', resolved: 'Atendida', dismissed: 'Descartada' }
const studentMessages = computed(() => messages.value.filter((message) => message.studentCode === props.student.id))
async function call(message = null, status = '') {
  busy.value = true; error.value = ''
  try {
    const result = await httpsCallable(functions, 'manageTeacherStudentMessages')({ groupId: props.groupId, ...(message ? { messageId: message.id, status, reply: replies.value[message.id] || '' } : {}) })
    messages.value = result.data.messages
    messages.value.forEach((entry) => { replies.value[entry.id] = entry.reply || '' })
    emit('changed', messages.value)
  } catch (cause) { error.value = cause.message || 'No se han podido cargar los mensajes.' }
  finally { busy.value = false }
}
watch(() => props.modelValue, (open) => { if (open) void call() })
</script>
<template>
  <v-dialog :model-value="modelValue" max-width="680" @update:model-value="emit('update:modelValue', $event)">
    <v-card><v-card-title>Mensajes de {{ student.nombre || student.id }}</v-card-title><v-card-text class="teacher-messages">
      <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
      <v-progress-linear v-if="busy" indeterminate />
      <article v-for="message in studentMessages" :key="message.id"><div><strong>{{ labels[message.status] }}</strong><small>{{ new Date(message.createdAt).toLocaleDateString('es-ES') }}</small></div><p>{{ message.text }}</p><v-textarea v-model="replies[message.id]" label="Respuesta" rows="2" maxlength="2000" variant="outlined" density="compact" hide-details /><div class="message-actions"><v-btn size="small" variant="text" :disabled="busy" @click="call(message, 'dismissed')">Descartar</v-btn><v-btn size="small" variant="text" :disabled="busy" @click="call(message, 'waiting')">En espera</v-btn><v-btn size="small" color="primary" variant="tonal" :disabled="busy" @click="call(message, 'resolved')">Atendida</v-btn></div></article>
      <p v-if="!busy && !studentMessages.length">No hay mensajes de este alumno.</p>
    </v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="emit('update:modelValue', false)">Cerrar</v-btn></v-card-actions></v-card>
  </v-dialog>
</template>
<style scoped>.teacher-messages { display: grid; gap: 12px; }.teacher-messages article { display: grid; gap: 8px; padding: 12px; border: 1px solid #d6e1ed; border-radius: 8px; }.teacher-messages article > div:first-child { display: flex; justify-content: space-between; color: #6b829b; font-size: .78rem; }.teacher-messages p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }.message-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; }</style>
