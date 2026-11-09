<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import ChatEmojiPicker from './ChatEmojiPicker.vue'
import { orderedConversations } from '../utils/conversationOrder'
import '../styles/conversationCards.css'
const props = defineProps({ groupId: { type: String, required: true }, student: { type: Object, required: true }, modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'changed'])
const messages = ref([]), entries = ref([]), selectedId = ref(''), text = ref(''), busy = ref(false), error = ref('')
const chatBody = ref(null)
const labels = { pending: 'Pendiente', waiting: 'En espera', resolved: 'Terminada', dismissed: 'Descartada' }
const studentMessages = computed(() => orderedConversations(messages.value.filter((message) => message.studentCode === props.student.id)))
const selected = computed(() => studentMessages.value.find((message) => message.id === selectedId.value))
const closed = computed(() => ['resolved', 'dismissed'].includes(selected.value?.status))
const unread = (message) => (message.studentLastAt || message.createdAt || '') > (message.teacherSeenAt || message.replyAt || (message.status !== 'pending' ? message.updatedAt : '') || '')
const date = (value) => value ? new Date(value).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
let requestId = 0
async function call({ send = false, status, quiet = false } = {}) {
  if (busy.value) return
  const request = ++requestId
  busy.value = true
  if (!quiet) error.value = ''
  try {
    const result = await httpsCallable(functions, 'manageTeacherStudentMessages')({ groupId: props.groupId, ...(selectedId.value ? { messageId: selectedId.value, markRead: true } : {}), ...(send ? { reply: text.value, append: true } : {}), ...(status ? { status } : {}) })
    if (request !== requestId) return
    messages.value = result.data.messages || []; entries.value = result.data.entries || []
    if (send) text.value = ''
    emit('changed', messages.value)
  } catch (cause) { if (request === requestId && !quiet) error.value = cause.message || 'No se han podido cargar los mensajes.' }
  finally { if (request === requestId) busy.value = false }
}
function open(message) { selectedId.value = message.id; entries.value = []; void call() }
function back() { selectedId.value = ''; entries.value = []; text.value = ''; void call() }
watch(() => props.modelValue, (openDialog) => { if (openDialog) { selectedId.value = ''; entries.value = []; void call() } })
watch(() => [selectedId.value, entries.value.length], async () => { await nextTick(); if (chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight })
const timer = window.setInterval(() => { if (props.modelValue) void call({ quiet: true }) }, 15000)
onBeforeUnmount(() => { requestId += 1; window.clearInterval(timer) })
</script>
<template>
  <v-dialog :model-value="modelValue" max-width="680" :fullscreen="$vuetify.display.smAndDown" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="teacher-chat-dialog"><v-card-title class="dialog-heading"><span>Mensajes de {{ student.nombre || student.id }}</span><v-btn icon="mdi-close" size="small" variant="text" aria-label="Cerrar" @click="emit('update:modelValue', false)" /></v-card-title>
      <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">{{ error }}</v-alert>
      <v-progress-linear v-if="busy" indeterminate />
      <div v-if="!selectedId" class="conversation-list"><button v-for="message in studentMessages" :key="message.id" type="button" class="conversation" :disabled="busy" @click="open(message)"><span class="conversation-main"><strong class="conversation-status" :class="`status-${message.status || 'pending'}`">{{ labels[message.status] || 'Pendiente' }}</strong><span>{{ message.lastText || message.reply || message.text }}</span></span><span class="conversation-meta"><small>{{ date(message.updatedAt || message.createdAt) }}</small><v-badge v-if="unread(message)" dot inline color="error" /></span></button><p v-if="!busy && !studentMessages.length">No hay mensajes de este alumno.</p></div>
      <template v-else><header class="chat-header"><v-btn icon="mdi-arrow-left" variant="text" size="small" aria-label="Volver a conversaciones" :disabled="busy" @click="back" /><div><strong>{{ student.nombre || student.id }}</strong><small>{{ labels[selected?.status] || 'Pendiente' }}</small></div><v-spacer /><template v-if="!closed"><v-btn icon="mdi-check-circle-outline" size="small" variant="text" :disabled="busy" aria-label="Terminar conversación" title="Terminar conversación" @click="call({ status: 'resolved' })" /><v-btn icon="mdi-clock-outline" size="small" variant="text" :disabled="busy" aria-label="Dejar en espera" title="Dejar en espera" @click="call({ status: 'waiting' })" /><v-btn icon="mdi-cancel" size="small" variant="text" :disabled="busy" aria-label="Descartar conversación" title="Descartar conversación" @click="call({ status: 'dismissed' })" /></template><v-btn v-else icon="mdi-lock-open-variant-outline" size="small" variant="text" :disabled="busy" aria-label="Reabrir conversación" title="Reabrir conversación" @click="call({ status: 'pending' })" /></header>
        <div ref="chatBody" class="chat-body"><div v-for="entry in entries" :key="entry.id" class="bubble" :class="entry.sender === 'teacher' ? 'bubble--own' : 'bubble--other'"><p>{{ entry.text }}</p><small>{{ date(entry.createdAt) }}</small></div></div>
        <p v-if="closed" class="chat-closed">Conversación cerrada. Puedes reabrirla para continuar.</p>
        <form v-else class="chat-compose" @submit.prevent="call({ send: true })"><ChatEmojiPicker @select="text += $event" /><v-textarea v-model="text" label="Escribe una respuesta" rows="1" auto-grow max-rows="4" maxlength="2000" density="compact" variant="outlined" hide-details /><v-btn type="submit" icon="mdi-send" color="primary" variant="text" :loading="busy" :disabled="!text.trim()" aria-label="Enviar mensaje" /></form>
      </template>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.teacher-chat-dialog { height:min(750px,90dvh); display:flex; flex-direction:column; }.dialog-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; }.conversation-list { overflow:auto; flex:1; }.conversation { display:flex; justify-content:space-between; gap:12px; width:100%; padding:12px; border-bottom:1px solid #dfe7f1; text-align:left; }.conversation-main,.conversation-meta { display:grid; gap:4px; min-width:0; }.conversation-main span { overflow:hidden; color:#687e96; text-overflow:ellipsis; white-space:nowrap; }.conversation-meta { justify-items:end; white-space:nowrap; color:#71839a; }.chat-header { display:flex; align-items:center; gap:8px; padding:4px 8px; color:#315f96; }.chat-header div { display:grid; }.chat-header small { color:#71839a; }.chat-body { flex:1 1 0; min-height:0; overflow:auto; display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px; background:#edf3f1; }.bubble { max-width:85%; padding:8px 10px; border-radius:9px; background:white; color:#344b60; box-shadow:0 1px 3px #17334a20; }.bubble--own { align-self:flex-end; background:#d8eacb; }.bubble p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }.bubble small { display:block; margin-top:3px; color:#778a91; font-size:.68rem; text-align:right; }.chat-compose { display:flex; align-items:end; gap:4px; padding:6px; }.message-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:2px; padding:4px; }
@media (max-width:600px) { .teacher-chat-dialog { height:100dvh; } }
.chat-compose { align-items:center; }.chat-closed { padding:12px; color:#71839a; text-align:center; font-size:.85rem; }
.conversation-list { display:grid; align-content:start; gap:10px; padding:8px; background:#f4f7fb; }.conversation { padding:10px 12px; border:0; border-radius:5px; background:white; box-shadow:0 2px 8px #1d375419; color:#315f94; }.conversation-main strong { font-size:.86rem; }
</style>
