<script setup>
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  diagnostics: { type: Array, default: () => [] },
  log: { type: String, default: '' },
  stale: { type: Boolean, default: false },
})
const emit = defineEmits(['locate'])
const copyStatus = ref('')
let copyStatusTimer

function diagnosticText(error) {
  const location = error.location || (error.line ? `Línea ${error.line}` : 'Compilación')
  return `${location}: ${error.message || 'Error de compilación'}`
}

async function copyText(value) {
  if (!value) return
  clearTimeout(copyStatusTimer)
  copyStatus.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Portapapeles no disponible')
    await navigator.clipboard.writeText(value)
  } catch {
    let textarea
    try {
      textarea = document.createElement('textarea')
      textarea.value = value
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      if (!document.execCommand('copy')) throw new Error('No se ha podido copiar')
    } catch {
      copyStatus.value = 'No se ha podido copiar. Selecciona el texto del registro para copiarlo.'
      return
    } finally { textarea?.remove() }
  }
  copyStatus.value = 'Copiado'
  clearTimeout(copyStatusTimer)
  copyStatusTimer = setTimeout(() => { copyStatus.value = '' }, 2500)
}

function copyAll() {
  const summary = props.diagnostics.map(diagnosticText).join('\n')
  const fullLog = props.log.trim()
  void copyText(fullLog ? [summary, fullLog].filter(Boolean).join('\n\n') : summary)
}

onBeforeUnmount(() => clearTimeout(copyStatusTimer))
</script>

<template>
  <section v-if="diagnostics.length || log" class="latex-error-list" aria-label="Errores de compilación" aria-live="polite">
    <header><v-icon icon="mdi-alert-circle-outline" size="17" /><strong>Errores de compilación</strong><span class="latex-error-copy-status" role="status">{{ copyStatus }}</span><button type="button" class="latex-error-copy-all" title="Copiar errores y registro del compilador" @click="copyAll"><v-icon icon="mdi-content-copy" size="15" /> Copiar todo</button></header>
    <p v-if="stale" class="latex-errors-stale">El código ha cambiado. Recompila para actualizar las ubicaciones.</p>
    <ul>
      <li v-for="error in diagnostics" :key="error.id">
        <button type="button" class="latex-error-locate" :disabled="!error.line || stale" :title="error.line && !stale ? 'Localizar en el código' : 'Consulta el registro para ver el código generado o el preámbulo'" @click="emit('locate', error)">
          <span class="latex-error-location"><v-icon v-if="error.line" icon="mdi-crosshairs-gps" size="15" />{{ error.location || `Línea ${error.line}` }}</span>
          <span>{{ error.message }}</span>
        </button>
        <button type="button" class="latex-error-copy" :aria-label="`Copiar error: ${error.message}`" title="Copiar este error" @click="copyText(diagnosticText(error))"><v-icon icon="mdi-content-copy" size="15" /></button>
      </li>
    </ul>
    <details v-if="log"><summary>Ver registro del compilador</summary><pre>{{ log }}</pre></details>
  </section>
</template>

<style scoped>
.latex-error-list { max-height: 220px; min-width: 0; overflow: auto; border-top: 1px solid #dbb8b8; padding: 9px 11px; background: #fff5f4; color: #7e2e2e; font-size: .76rem; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.latex-error-copy-status { margin-left: auto; font-size: .7rem; }
.latex-error-copy-all, .latex-error-copy { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 4px; padding: 5px; border-radius: 4px; color: #7e2e2e; white-space: nowrap; cursor: pointer; }
.latex-error-copy-all:hover, .latex-error-copy:hover, .latex-error-copy-all:focus-visible, .latex-error-copy:focus-visible { background: #ffd6cf; outline: 1px solid #b63b3b; }
ul { margin: 6px 0 0; padding: 0; list-style: none; }
li { display: flex; align-items: stretch; gap: 3px; min-width: 0; }
li + li { margin-top: 4px; }
.latex-error-locate { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 9px; padding: 6px; border-radius: 4px; text-align: left; overflow-wrap: anywhere; }
.latex-error-locate:not(:disabled) { cursor: pointer; background: #ffe6e2; }
.latex-error-locate:not(:disabled):hover, .latex-error-locate:focus-visible { background: #ffd6cf; outline: 1px solid #b63b3b; }
.latex-error-locate:disabled { color: inherit; opacity: .8; }
.latex-error-location { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-weight: 700; }
.latex-errors-stale { margin: 5px 0; color: #895a21; }
summary { margin-top: 7px; cursor: pointer; font-weight: 600; }
pre { max-height: 280px; overflow: auto; padding: 7px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .7rem; }
</style>
