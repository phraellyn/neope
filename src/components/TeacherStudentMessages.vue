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
watch(() => props.modelValue, (openDialog) => { if (openDialog) { selectedId.value = ''; entries.value = []; void call() } }, { immediate: true })
watch(() => [selectedId.value, entries.value.length], async () => { await nextTick(); if (chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight })
const timer = window.setInterval(() => { if (props.modelValue) void call({ quiet: true }) }, 15000)
onBeforeUnmount(() => { requestId += 1; window.clearInterval(timer) })
</script>
<template>
  <v-dialog :model-value="modelValue" width="680" :height="$vuetify.display.smAndDown ? '100dvh' : 'min(750px, calc(100dvh - 48px))'" :fullscreen="$vuetify.display.smAndDown" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card class="teacher-chat-dialog"><v-card-title class="dialog-heading"><span>Mensajes de {{ student.nombre || student.id }}</span><v-btn icon="mdi-close" size="small" variant="text" aria-label="Cerrar" @click="emit('update:modelValue', false)" /></v-card-title>
      <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">{{ error }}</v-alert>
      <v-progress-linear v-if="busy" indeterminate />
      <div v-if="!selectedId" class="conversation-list"><button v-for="message in studentMessages" :key="message.id" type="button" class="conversation" :disabled="busy" @click="open(message)"><span class="conversation-main"><strong class="conversation-status" :class="`status-${message.status || 'pending'}`">{{ labels[message.status] || 'Pendiente' }}</strong><span>{{ message.lastText || message.reply || message.text }}</span></span><span class="conversation-meta"><small>{{ date(message.updatedAt || message.createdAt) }}</small><v-badge v-if="unread(message)" dot inline color="error" /></span></button><p v-if="!busy && !studentMessages.length">No hay mensajes de este alumno.</p></div>
      <template v-else><header class="chat-header"><v-btn icon="mdi-arrow-left" variant="text" size="small" aria-label="Volver a conversaciones" :disabled="busy" @click="back" /><div class="chat-identity"><strong>{{ student.nombre || student.id }}</strong><small>{{ labels[selected?.status] || 'Pendiente' }}</small></div><div class="chat-actions"><template v-if="!closed"><v-btn icon="mdi-check-circle-outline" size="small" variant="text" :disabled="busy" aria-label="Terminar conversación" title="Terminar conversación" @click="call({ status: 'resolved' })" /><v-btn icon="mdi-clock-outline" size="small" variant="text" :disabled="busy" aria-label="Dejar en espera" title="Dejar en espera" @click="call({ status: 'waiting' })" /><v-btn icon="mdi-cancel" size="small" variant="text" :disabled="busy" aria-label="Descartar conversación" title="Descartar conversación" @click="call({ status: 'dismissed' })" /></template><v-btn v-else icon="mdi-lock-open-variant-outline" size="small" variant="text" :disabled="busy" aria-label="Reabrir conversación" title="Reabrir conversación" @click="call({ status: 'pending' })" /></div></header>
        <div ref="chatBody" class="chat-body"><div v-for="entry in entries" :key="entry.id" class="bubble" :class="entry.sender === 'teacher' ? 'bubble--own' : 'bubble--other'"><p>{{ entry.text }}</p><small>{{ date(entry.createdAt) }}</small></div></div>
        <p v-if="closed" class="chat-closed">Conversación cerrada. Puedes reabrirla para continuar.</p>
        <form v-else class="chat-compose" @submit.prevent="call({ send: true })"><ChatEmojiPicker @select="text += $event" /><v-textarea v-model="text" label="Escribe una respuesta" rows="1" auto-grow max-rows="4" maxlength="2000" density="compact" variant="outlined" hide-details /><v-btn type="submit" icon="mdi-send" color="primary" variant="text" :loading="busy" :disabled="!text.trim()" aria-label="Enviar mensaje" /></form>
      </template>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.teacher-chat-dialog { display:flex; flex:1 1 100%; flex-direction:column; width:100%; height:100%; min-height:0; max-height:100%; overflow:hidden; border-radius:4px; background:#f4f7fb; }
.dialog-heading { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:8px; padding:10px 14px; background:#fff; color:#315f96; font-size:1rem; }
.dialog-heading > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.conversation-list { display:grid; flex:1 1 0; min-height:0; align-content:start; gap:10px; overflow-y:auto; padding:12px; }
.conversation { display:flex; justify-content:space-between; gap:12px; width:100%; padding:10px 12px; border:0; border-radius:5px; background:#fff; box-shadow:0 2px 8px #1d375419; color:#315f94; text-align:left; cursor:pointer; }
.conversation:hover { background:#f9fbfe; }
.conversation:focus-visible { outline:2px solid #4776aa; outline-offset:2px; }
.conversation-main,.conversation-meta { display:grid; gap:4px; min-width:0; }
.conversation-main strong { font-size:.86rem; }
.conversation-main span { overflow:hidden; color:#687e96; text-overflow:ellipsis; white-space:nowrap; }
.conversation-meta { justify-items:end; color:#71839a; white-space:nowrap; }
.conversation-list > p { margin:8px 4px; color:#71839a; }
.chat-header { display:flex; flex:0 0 auto; align-items:center; gap:4px; min-width:0; padding:6px 8px; border-top:1px solid #e6edf5; background:#fff; color:#315f96; }
.chat-identity { display:grid; flex:1 1 auto; min-width:0; line-height:1.2; }
.chat-identity strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.92rem; }
.chat-identity small { margin-top:3px; color:#71839a; font-size:.72rem; }
.chat-actions { display:flex; flex:0 0 auto; align-items:center; }
.chat-body { display:flex; flex:1 1 0; min-height:0; flex-direction:column; align-items:flex-start; gap:8px; overflow-y:auto; overscroll-behavior:contain; padding:16px; background:#edf3f1; }
.bubble { flex:0 0 auto; max-width:min(85%, 480px); padding:8px 10px; border-radius:4px; background:#fff; color:#344b60; box-shadow:0 1px 3px #17334a20; }
.bubble--own { align-self:flex-end; background:#d8eacb; }
.bubble p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.bubble small { display:block; margin-top:3px; color:#778a91; font-size:.68rem; text-align:right; }
.chat-compose { display:flex; flex:0 0 auto; align-items:center; gap:4px; padding:8px; padding-bottom:max(8px, env(safe-area-inset-bottom)); background:#fff; }
.chat-compose :deep(.v-textarea) { min-width:0; }
.chat-closed { flex:0 0 auto; margin:0; padding:12px; background:#fff; color:#71839a; text-align:center; font-size:.85rem; }
@media (max-width:600px) { .teacher-chat-dialog { height:100dvh; max-height:100dvh; border-radius:0; } .chat-body { padding:12px; } .chat-header { gap:0; } .chat-actions :deep(.v-btn) { width:36px; height:36px; } }
</style>
