<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import ChatEmojiPicker from './ChatEmojiPicker.vue'
import { orderedConversations } from '../utils/conversationOrder'
import '../styles/conversationCards.css'
const props = defineProps({ group: { type: Object, required: true } })
const emit = defineEmits(['unread'])
const messages = ref([]), entries = ref([]), selectedId = ref(''), composing = ref(false), text = ref(''), busy = ref(false), error = ref('')
const chatBody = ref(null)
const teacherName = ref('')
const labels = { pending: 'Pendiente', waiting: 'En espera', resolved: 'Terminada', dismissed: 'Descartada' }
const selected = computed(() => messages.value.find((item) => item.id === selectedId.value))
const sortedMessages = computed(() => orderedConversations(messages.value))
const closed = computed(() => ['resolved', 'dismissed'].includes(selected.value?.status))
const unread = (item) => Boolean(item.replyAt && item.replyAt > (item.studentSeenAt || ''))
const date = (value) => value ? new Date(value).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
let requestId = 0
async function load({ send = false, quiet = false } = {}) {
  if (busy.value) return
  const request = ++requestId
  busy.value = true
  if (!quiet) error.value = ''
  try {
    const result = await httpsCallable(functions, 'manageStudentMessages')({ groupId: props.group.id, ...(selectedId.value ? { messageId: selectedId.value, markRead: true } : {}), ...(send ? { text: text.value } : {}) })
    if (request !== requestId) return
    messages.value = result.data.messages || []
    entries.value = result.data.entries || []
    teacherName.value = result.data.teacherName || ''
    if (send) { selectedId.value = result.data.conversationId || selectedId.value; composing.value = false; text.value = '' }
    emit('unread', messages.value.filter(unread).length)
  } catch (cause) { if (request === requestId && !quiet) error.value = cause.message || 'No se han podido cargar los mensajes.' }
  finally { if (request === requestId) busy.value = false }
}
function open(item) { selectedId.value = item.id; composing.value = false; entries.value = []; void load() }
function back() { selectedId.value = ''; composing.value = false; text.value = ''; entries.value = []; void load() }
watch(() => props.group.id, () => { selectedId.value = ''; messages.value = []; entries.value = []; text.value = ''; void load() }, { immediate: true })
watch(() => [selectedId.value, entries.value.length], async () => { await nextTick(); if (chatBody.value) chatBody.value.scrollTop = chatBody.value.scrollHeight })
const timer = window.setInterval(() => void load({ quiet: true }), 15000)
onBeforeUnmount(() => { requestId += 1; window.clearInterval(timer) })
</script>
<template>
  <section class="student-messages">
    <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">{{ error }}</v-alert>
    <template v-if="!selectedId && !composing">
      <div class="messages-heading"><h2>Conversaciones</h2><v-btn icon="mdi-message-plus-outline" variant="text" color="primary" :disabled="busy" aria-label="Nueva conversación" title="Nueva conversación" @click="composing = true" /></div>
      <div class="conversation-list"><button v-for="message in sortedMessages" :key="message.id" type="button" class="conversation" :disabled="busy" @click="open(message)"><span class="conversation-main"><strong class="conversation-status" :class="`status-${message.status || 'pending'}`">{{ labels[message.status] || 'Pendiente' }}</strong><span>{{ message.lastText || message.reply || message.text }}</span></span><span class="conversation-meta"><small>{{ date(message.updatedAt || message.createdAt) }}</small><v-badge v-if="unread(message)" dot inline color="error" /></span></button><p v-if="!busy && !messages.length">Todavía no has enviado mensajes.</p></div>
    </template>
    <template v-else>
      <header class="chat-header"><v-btn icon="mdi-arrow-left" variant="text" size="small" aria-label="Volver a conversaciones" :disabled="busy" @click="back" /><div><strong>{{ teacherName || 'Profesor' }}</strong><small v-if="selected">{{ labels[selected.status] || 'Pendiente' }}</small></div></header>
      <div ref="chatBody" class="chat-body"><div v-for="entry in entries" :key="entry.id" class="bubble" :class="entry.sender === 'student' ? 'bubble--own' : 'bubble--other'"><p>{{ entry.text }}</p><small>{{ date(entry.createdAt) }}</small></div></div>
      <p v-if="closed" class="chat-closed">Conversación cerrada. El profesor puede reabrirla.</p>
      <form v-else class="chat-compose" @submit.prevent="load({ send: true })"><ChatEmojiPicker @select="text += $event" /><v-textarea v-model="text" label="Escribe un mensaje" rows="1" auto-grow max-rows="4" maxlength="2000" density="compact" variant="outlined" hide-details /><v-btn type="submit" icon="mdi-send" color="primary" variant="text" :loading="busy" :disabled="!text.trim()" aria-label="Enviar mensaje" /></form>
    </template>
  </section>
</template>
<style scoped>
.student-messages { display:flex; flex-direction:column; gap:8px; min-height:0; }.messages-heading,.chat-header { display:flex; align-items:center; justify-content:space-between; gap:8px; color:#315f96; }.messages-heading h2 { font-size:1rem; }.conversation-list { overflow:auto; display:grid; align-content:start; gap:10px; padding:3px; }.conversation { display:flex; justify-content:space-between; gap:12px; width:100%; padding:10px 12px; border:0; border-radius:5px; background:white; box-shadow:0 2px 8px #1d375419; color:#315f94; text-align:left; }.conversation-main,.conversation-meta { display:grid; gap:4px; min-width:0; }.conversation-main strong { font-size:.86rem; }.conversation-main span { overflow:hidden; color:#687e96; text-overflow:ellipsis; white-space:nowrap; }.conversation-meta { justify-items:end; white-space:nowrap; color:#71839a; }.chat-header { justify-content:flex-start; background:white; padding:4px; }.chat-header div { display:grid; }.chat-header small { color:#71839a; }.chat-body { flex:1 1 0; min-height:180px; overflow:auto; display:flex; flex-direction:column; align-items:flex-start; gap:8px; padding:12px; background:#edf3f1; }.bubble { max-width:85%; padding:8px 10px; border-radius:9px; background:white; color:#344b60; box-shadow:0 1px 3px #17334a20; }.bubble--own { align-self:flex-end; background:#d8eacb; }.bubble p { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }.bubble small { display:block; margin-top:3px; color:#778a91; font-size:.68rem; text-align:right; }.chat-compose { display:flex; align-items:center; gap:4px; padding:6px; background:white; }.chat-closed { padding:12px; background:white; color:#71839a; text-align:center; font-size:.85rem; }
</style>
