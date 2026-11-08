<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ total: { type: Number, default: 0 }, maximum: { type: Number, default: 0 }, manual: { type: Boolean, default: false }, disabled: { type: Boolean, default: false } })
const emit = defineEmits(['manual-score', 'reset-score'])
const draft = ref('')
const invalid = ref(false)
function sync() { draft.value = String(props.total).replace('.', ','); invalid.value = false }
watch(() => props.total, sync, { immediate: true })
function commit() {
  const text = draft.value.trim().replace(',', '.')
  const number = Number(text)
  if (!text || !/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(number)) { invalid.value = true; return }
  invalid.value = false
  emit('manual-score', number)
}
</script>

<template>
  <div class="document-score"><span>Nota <small v-if="manual">manual</small></span><div class="document-score-controls"><input v-model="draft" type="text" inputmode="decimal" aria-label="Nota del documento" :aria-invalid="invalid" :disabled="disabled" @change="commit" @keydown.enter.prevent="commit" @keydown.esc="sync" /><span>/ {{ new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(maximum) }}</span><v-btn icon="mdi-restore" variant="text" size="small" :disabled="disabled || !manual" aria-label="Restablecer nota calculada por la matriz" title="Restablecer nota calculada por la matriz" @click="emit('reset-score')" /></div><small v-if="invalid" class="score-error">Introduce una nota válida.</small></div>
</template>

<style scoped>.document-score { display: grid; gap: 1px; font-size: .72rem; }.document-score > span { color: #71839a; }.document-score-controls { display: flex; align-items: center; gap: 4px; white-space: nowrap; }.document-score input { width: 58px; min-height: 32px; padding: 2px 5px; border: 1px solid #bdccdc; border-radius: 5px; text-align: right; background: white; color: #315f94; font-weight: 700; }.document-score input[aria-invalid="true"] { border-color: #b32643; }.score-error { color: #b32643; }</style>
