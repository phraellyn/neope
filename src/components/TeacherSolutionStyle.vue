<script setup>
import { computed, ref, watch } from 'vue'
import { applicableSolutionStyle, normalizeSolutionStyle, teacherStylePrompt } from '../../functions/solutionStyle.js'
import { buildExerciseLatex, exerciseStructureFromDocument } from '../utils/exerciseStructure.js'

const props = defineProps({ modelValue: { type: Object, default: () => ({}) }, fullGuide: { type: String, default: '' }, nodes: { type: Array, default: () => [] }, exercises: { type: Array, default: () => [] }, hasMoreExercises: Boolean, loadingExercises: Boolean, saving: Boolean })
const emit = defineEmits(['save', 'load-more'])
const draft = ref(normalizeSolutionStyle(props.modelValue))
const fullGuideDraft = ref(props.fullGuide)
const showFullGuide = ref(Boolean(props.fullGuide))
const previewIds = ref([])
const previewExerciseId = ref(null)
const exampleSelection = ref({})
const exampleError = ref('')
const expanded = ref([])
watch(() => props.modelValue, value => { draft.value = normalizeSolutionStyle(value) }, { deep: true })
watch(() => props.fullGuide, value => { fullGuideDraft.value = value || ''; showFullGuide.value = Boolean(value) })
const options = computed(() => {
  const map = new Map(props.nodes.map(n => [n.id, n]))
  return props.nodes.filter(n => n.id !== 'matematicas').map(n => {
    const path = []; const seen = new Set(); let node = n
    while (node && node.id !== 'matematicas' && !seen.has(node.id)) { seen.add(node.id); path.unshift(node.title); node = map.get(node.parentId) }
    return { title: path.join(' › '), value: n.id }
  })
})
const exerciseOptions = computed(() => props.exercises.map(e => ({ value: e.id, title: [e.info, e.statement?.latex || e.enunciado || e.structure?.enunciado || 'Ejercicio'].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 130) })))
function selectPreviewExercise(id) {
  const exercise = props.exercises.find(item => item.id === id)
  if (exercise) previewIds.value = [...new Set([...(exercise.curriculum?.conceptIds || []), ...(exercise.structure?.contenidos || [])])]
}
function ancestors(ids) {
  const map = new Map(props.nodes.map(n => [n.id, n.parentId]))
  const result = new Set(ids)
  for (const id of ids) { let p = map.get(id); const seen = new Set(); while (p && !seen.has(p)) { result.add(p); seen.add(p); p = map.get(p) } }
  return [...result]
}
const activeStyle = computed(() => applicableSolutionStyle(draft.value, ancestors(previewIds.value)))
const preview = computed(() => teacherStylePrompt({ estiloCompleto: fullGuideDraft.value, estiloSoluciones: draft.value }, ancestors(previewIds.value)))
function addRule() { const rule = { id: crypto.randomUUID(), title: '', enabled: true, conceptIds: [], instructions: '', example: '' }; draft.value.rules.push(rule); expanded.value = [rule.id] }
function removeRule(rule) { draft.value.rules = draft.value.rules.filter(item => item.id !== rule.id) }
function insertExample(rule) {
  exampleError.value = ''
  const exercise = props.exercises.find(e => e.id === exampleSelection.value[rule.id])
  if (!exercise) return
  const structure = exercise.structure || exerciseStructureFromDocument(exercise)
  const example = buildExerciseLatex(structure, { includeSolutions: true, includeAnswers: true, includeCriteria: false, includeInfo: false, preserveApartadosEnvironment: true })
  const combined = [rule.example, example].filter(Boolean).join('\n\n% Otro ejemplo\n\n')
  if (combined.length > 5000) { exampleError.value = 'Los ejemplos superan el espacio disponible. Copia solo los apartados que quieras utilizar.'; return }
  if (!/\\begin\s*\{solucion\}/.test(example)) { exampleError.value = 'Este ejercicio no tiene una solución desarrollada para utilizar como ejemplo.'; return }
  rule.example = combined
}
function loadProposal() {
  const id = title => props.nodes.find(n => n.title.toLocaleLowerCase('es') === title.toLocaleLowerCase('es'))?.id
  const rule = (title, concepts, instructions) => { const conceptIds = concepts.map(id).filter(Boolean); return { id: crypto.randomUUID(), title, enabled: conceptIds.length > 0, conceptIds, instructions, example: '' } }
  draft.value = { enabled: false, general: "Explica con frases breves y cálculos desarrollados. Comprueba las hipótesis, conserva el enunciado y sus apartados, y concluye lo que se pide. Compón las soluciones para una columna de unos 8 cm: divide las expresiones largas en aligned, sin líneas en blanco, ni reducir sistemáticamente la letra. Utiliza gráficos sencillos cuando ayuden a explicar un paso, con etiquetas correctas; no sustituyen la demostración. Usa comandos propios solo si están definidos en la plantilla activa y no incluyas criterios en los PDF.", rules: [
    rule('Límites', ['Límites'], "Muestra las indeterminaciones entre corchetes. Justifica la técnica y desarrolla los pasos. Al aplicar L'Hôpital comprueba sus condiciones y etiqueta la igualdad con letra sin serifa y tamaño tiny, por ejemplo \\underset{\\text{\\tiny\\textsf{L'H}}}{=}. Las demás anotaciones explicativas bajo signos también deben usar \\textsf y \\tiny. Para 1^infinito explica la transformación exponencial."),
    rule('Bolzano, Rolle y Lagrange', ['Bolzano', 'Rolle', 'Lagrange'], 'Comprueba las hipótesis. Para Bolzano y Rolle presenta las condiciones en un array matemático, separa con \\hline y escribe debajo la conclusión adaptada. Explica cómo se conecta con la demostración.'),
    rule('Polinomios: Ruffini y división', ['Polinomios'], 'Utiliza Ruffini solo para polinomios de grado 3 o superior y, al quedar una ecuación de segundo grado, usa la fórmula cuadrática. En enunciados nuevos escribe la división en modo matemático como R(x):Q(x) o como fracción, conservando sin cambios los enunciados existentes al resolverlos. Ordena los coeficientes, respeta los términos que faltan y representa Ruffini o la división entera con array, multicolumn y cline. Presenta por defecto el resultado como dividendo/divisor = cociente + resto/divisor, con grado del resto menor que el del divisor; si el resto es cero, muestra solo el cociente. Comprueba la identidad y muestra dividendo = divisor por cociente + resto solo si el enunciado la solicita.'),
    rule('Fracciones anidadas', ['Fracciones'], 'Simplifica de dentro hacia fuera. Si procede usa el mínimo común múltiplo para eliminar denominadores interiores, multiplicando numerador y denominador y mostrando los pasos.'),
    rule('Radicales y logaritmos', ['Raíces', 'Logaritmos'], 'Descompón en factores y potencias, explica las propiedades aplicadas y comprueba los dominios. Si ayuda a comprender, muestra por separado dos métodos con títulos breves.'),
    rule('Continuidad y derivabilidad', ['Continuidad', 'Derivabilidad'], 'En funciones a trozos comprueba los límites laterales y el valor en el punto de unión; para la derivabilidad justifica las derivadas laterales y concluye si coinciden.'),
    rule('Extremos y optimización', ['Derivadas'], 'Define variables y restricciones, determina el dominio, calcula la derivada y justifica los signos y los extremos. En problemas contextualizados expresa la respuesta con sus unidades.'),
  ] }
}
</script>

<template>
  <section class="solution-style">
    <header class="solution-style-header"><div><strong>Estilo de las soluciones</strong><p>Configura tus preferencias personales.</p></div><v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" :loading="saving" @click="emit('save', { style: normalizeSolutionStyle(draft), fullGuide: fullGuideDraft })">Guardar</v-btn></header>
    <template v-if="showFullGuide">
      <p class="solution-style-help">La guía completa se envía automáticamente al generar ejercicios o soluciones. Los cambios se aplican al guardar.</p>
      <v-textarea v-model="fullGuideDraft" label="Guía completa" variant="outlined" rows="18" auto-grow maxlength="100000" counter />
      <div class="solution-style-preview"><strong>Vista previa de lo que se enviará</strong><pre>{{ preview }}</pre></div>
    </template>
    <template v-else>
    <div class="solution-style-actions"><v-switch v-model="draft.enabled" label="Aplicar mi estilo a la IA" color="primary" hide-details density="compact" /><v-btn v-if="!draft.general && !draft.rules.length" variant="text" size="small" prepend-icon="mdi-file-document-outline" @click="loadProposal">Cargar propuesta inicial</v-btn></div>
    <v-textarea v-model="draft.general" label="Indicaciones generales" variant="outlined" rows="5" auto-grow maxlength="6000" counter />
    <div class="solution-style-rule-header"><strong>Indicaciones por concepto</strong><v-btn variant="tonal" color="primary" size="small" prepend-icon="mdi-plus" @click="addRule">Añadir</v-btn></div>
    <p class="solution-style-help">Si no eliges conceptos, la indicación se aplica siempre. Al elegir un concepto se aplica también a sus descendientes. Las pautas iniciales sin concepto asignado están desactivadas hasta que las configures.</p>
    <v-expansion-panels v-model="expanded" multiple variant="accordion" class="solution-style-panels">
      <v-expansion-panel v-for="rule in draft.rules" :key="rule.id" :value="rule.id">
        <v-expansion-panel-title><span>{{ rule.title || 'Nueva indicación' }}</span><v-spacer /><span class="solution-style-summary">{{ rule.enabled ? (rule.conceptIds.length ? `${rule.conceptIds.length} conceptos` : 'Siempre') : 'Desactivada' }}</span></v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-switch v-model="rule.enabled" label="Indicación activa" color="primary" hide-details density="compact" />
          <v-text-field v-model="rule.title" label="Título" variant="outlined" density="compact" maxlength="120" />
          <v-autocomplete v-model="rule.conceptIds" :items="options" label="Conceptos a los que se aplica" variant="outlined" density="compact" multiple chips closable-chips />
          <v-textarea v-model="rule.instructions" label="Indicaciones" variant="outlined" rows="4" auto-grow maxlength="3000" counter />
          <v-autocomplete v-model="exampleSelection[rule.id]" :items="exerciseOptions" label="Añadir ejemplo de los ejercicios cargados" variant="outlined" density="compact" clearable />
          <v-btn v-if="hasMoreExercises" size="small" variant="text" :loading="loadingExercises" @click="emit('load-more')">Cargar más ejercicios</v-btn>
          <v-btn size="small" variant="tonal" :disabled="!exampleSelection[rule.id]" @click="insertExample(rule)">Usar como ejemplo</v-btn>
          <v-alert v-if="exampleError" type="warning" density="compact" class="mt-2">{{ exampleError }}</v-alert>
          <p class="solution-style-help">Revisa el ejemplo y sus cálculos antes de incluirlo. Se enviará al modelo con esta indicación.</p>
          <v-textarea v-model="rule.example" label="Ejemplo aprobado (LaTeX, opcional)" variant="outlined" rows="4" auto-grow maxlength="5000" counter />
          <v-btn color="error" variant="text" prepend-icon="mdi-delete-outline" @click="removeRule(rule)">Eliminar indicación</v-btn>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <div class="solution-style-preview"><strong>Vista previa de las indicaciones</strong><v-autocomplete v-model="previewExerciseId" :items="exerciseOptions" label="Elegir ejercicio cargado (opcional)" variant="outlined" density="compact" clearable @update:model-value="selectPreviewExercise" /><v-btn v-if="hasMoreExercises" size="small" variant="text" :loading="loadingExercises" @click="emit('load-more')">Cargar más ejercicios</v-btn><v-autocomplete v-model="previewIds" :items="options" label="Conceptos del ejercicio de prueba" multiple chips closable-chips variant="outlined" density="compact" /><p class="solution-style-help">Coinciden {{ activeStyle.rules.length }} indicaciones. El texto inferior muestra lo que se enviaría dentro del límite de contexto. La vista previa usa los cambios de esta pantalla; guarda para activarlos.</p><pre v-if="preview">{{ preview }}</pre><p v-else class="solution-style-help">Activa el estilo y añade indicaciones para ver el contexto.</p></div>
    </template>
  </section>
</template>

<style scoped>
.solution-style { display:grid; gap:12px; max-width:1040px; }
.solution-style-header,.solution-style-rule-header,.solution-style-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.solution-style-header p,.solution-style-help { color:#71839a; font-size:.75rem; margin:4px 0; }
.solution-style-summary { margin-right:8px; color:#71839a; font-size:.7rem; }
.solution-style-panels { border-radius:5px; }
.solution-style-preview { display:grid; gap:10px; margin-top:12px; }
.solution-style-preview pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; padding:12px; background:#f1f5fa; border-radius:5px; color:#395573; font-size:.72rem; }
</style>
