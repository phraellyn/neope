<script setup>
defineProps({
  diagnostics: { type: Array, default: () => [] },
  log: { type: String, default: '' },
  stale: { type: Boolean, default: false },
})
const emit = defineEmits(['locate'])
</script>

<template>
  <section v-if="diagnostics.length || log" class="latex-error-list" aria-label="Errores de compilación" aria-live="polite">
    <header><v-icon icon="mdi-alert-circle-outline" size="17" /><strong>Errores de compilación</strong></header>
    <p v-if="stale" class="latex-errors-stale">El código ha cambiado. Recompila para actualizar las ubicaciones.</p>
    <ul>
      <li v-for="error in diagnostics" :key="error.id">
        <button type="button" :disabled="!error.line || stale" :title="error.line && !stale ? 'Localizar en el código' : 'Consulta el registro para ver el código generado o el preámbulo'" @click="emit('locate', error)">
          <span class="latex-error-location"><v-icon v-if="error.line" icon="mdi-crosshairs-gps" size="15" />{{ error.location || `Línea ${error.line}` }}</span>
          <span>{{ error.message }}</span>
        </button>
      </li>
    </ul>
    <details v-if="log"><summary>Ver registro del compilador</summary><pre>{{ log }}</pre></details>
  </section>
</template>

<style scoped>
.latex-error-list { max-height: 220px; min-width: 0; overflow: auto; border-top: 1px solid #dbb8b8; padding: 9px 11px; background: #fff5f4; color: #7e2e2e; font-size: .76rem; }
header { display: flex; align-items: center; gap: 6px; }
ul { margin: 6px 0 0; padding: 0; list-style: none; }
li + li { margin-top: 4px; }
button { width: 100%; display: flex; align-items: baseline; gap: 9px; padding: 6px; border-radius: 4px; text-align: left; overflow-wrap: anywhere; }
button:not(:disabled) { cursor: pointer; background: #ffe6e2; }
button:not(:disabled):hover, button:focus-visible { background: #ffd6cf; outline: 1px solid #b63b3b; }
button:disabled { color: inherit; opacity: .8; }
.latex-error-location { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-weight: 700; }
.latex-errors-stale { margin: 5px 0; color: #895a21; }
summary { margin-top: 7px; cursor: pointer; font-weight: 600; }
pre { max-height: 280px; overflow: auto; padding: 7px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .7rem; }
</style>
