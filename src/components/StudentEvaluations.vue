<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  loadStudentIdentitiesForGroup,
  saveStudentIdentities,
} from '../services/localStudentIdentity'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const props = defineProps({
  group: { type: Object, required: true },
  teacherProfile: { type: Object, default: () => ({ centros: [] }) },
})

const PERIODS = Object.freeze([
  { key: 'inicial', label: 'Inicial' },
  { key: 'primera', label: 'Primera' },
  { key: 'segunda', label: 'Segunda' },
  { key: 'tercera', label: 'Tercera' },
  { key: 'final', label: 'Final' },
  { key: 'extraordinaria', label: 'Extraordinaria' },
])
const GENERAL_OPTIONS = Object.freeze([
  { title: 'Alto', value: 'alto' },
  { title: 'Medio', value: 'medio' },
  { title: 'Bajo', value: 'bajo' },
])
const ATTITUDE_ROWS = Object.freeze([
  { key: 'interesAprendizaje', label: 'Interés por el aprendizaje' },
  { key: 'participacionClase', label: 'Participación en clase' },
  { key: 'respetoConvivencia', label: 'Respeto y convivencia' },
  { key: 'autonomiaResponsabilidad', label: 'Autonomía y responsabilidad' },
  { key: 'organizacionTrabajo', label: 'Organización del trabajo' },
])
const ATTITUDE_OPTIONS = Object.freeze([
  { title: 'Muy adecuado', value: 'muy-adecuado' },
  { title: 'Adecuado', value: 'adecuado' },
  { title: 'Mejorable', value: 'mejorable' },
  { title: 'Necesita apoyo', value: 'necesita-apoyo' },
])

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function defaultEvaluation() {
  return {
    valoracionGeneral: null,
    actitudGeneral: Object.fromEntries(ATTITUDE_ROWS.map((row) => [row.key, null])),
    observacionesTutor: '',
    faltasJustificadas: 0,
    faltasInjustificadas: 0,
    retrasos: 0,
  }
}

const studentIdentities = ref(new Map())
const students = computed(() => {
  const list = (Array.isArray(props.group?.alumnos) ? props.group.alumnos : [])
    .map((student) => (typeof student === 'string' ? { id: student } : student))
    .filter((student) => student?.id)
  return list.sort((left, right) => {
    const leftName = String(studentIdentities.value.get(left.id)?.nombre || left.nombre || '').trim()
    const rightName = String(studentIdentities.value.get(right.id)?.nombre || right.nombre || '').trim()
    if (!leftName && rightName) return 1
    if (leftName && !rightName) return -1
    return (leftName || left.id).localeCompare(rightName || right.id, 'es', { sensitivity: 'base' })
  })
})
const evaluationRecords = ref({})
const selectedPeriod = ref('inicial')
const selectedStudentIndex = ref(0)
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const elapsedByStudent = ref({})
const totalElapsedSeconds = ref(0)
const timerPaused = ref(false)
let saveTimer = null
let timerHandle = null
let totalTimerHandle = null

const currentStudent = computed(() => students.value[selectedStudentIndex.value] || null)
const currentIdentity = computed(() => currentStudent.value ? studentIdentities.value.get(currentStudent.value.id) || {} : {})
const currentEvaluation = computed(() => {
  const studentId = currentStudent.value?.id
  if (!studentId) return defaultEvaluation()
  return evaluationRecords.value[studentId] || defaultEvaluation()
})
const currentPeriodLabel = computed(() => PERIODS.find((period) => period.key === selectedPeriod.value)?.label || 'Evaluación')
const displayName = (student) => studentIdentities.value.get(student?.id)?.nombre || student?.nombre || student?.id || 'Alumno'
const displayShortName = (student) => studentIdentities.value.get(student?.id)?.nombreCorto || student?.nombreCorto || displayName(student)
const currentElapsedSeconds = computed(() => Number(elapsedByStudent.value[currentStudent.value?.id] || 0))
const currentTimerPaused = computed(() => timerPaused.value)
const currentAge = computed(() => {
  const match = String(currentIdentity.value.fechaNacimiento || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const birthDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(birthDate.getTime()) || birthDate > new Date()) return null
  const today = new Date()
  let years = today.getFullYear() - birthDate.getFullYear()
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) years -= 1
  return years >= 0 ? years : null
})
const currentPendingSubjects = computed(() => Array.isArray(currentIdentity.value.asignaturasPendientes)
  ? currentIdentity.value.asignaturasPendientes.filter((subject) => String(subject || '').trim())
  : [])

function formatElapsed(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(total / 60)
  const remainingSeconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function stopStudentTimer() {
  if (timerHandle) window.clearInterval(timerHandle)
  timerHandle = null
}

function stopTotalTimer() {
  if (totalTimerHandle) window.clearInterval(totalTimerHandle)
  totalTimerHandle = null
}

function startTotalTimer() {
  stopTotalTimer()
  if (loading.value || timerPaused.value) return
  totalTimerHandle = window.setInterval(() => {
    totalElapsedSeconds.value += 1
  }, 1000)
}

function startStudentTimer() {
  stopStudentTimer()
  const studentId = currentStudent.value?.id
  if (!studentId || loading.value || timerPaused.value) return
  elapsedByStudent.value[studentId] ||= 0
  timerHandle = window.setInterval(() => {
    elapsedByStudent.value[studentId] = Number(elapsedByStudent.value[studentId] || 0) + 1
  }, 1000)
}

function toggleStudentTimer() {
  const studentId = currentStudent.value?.id
  if (!studentId || loading.value) return
  timerPaused.value = !timerPaused.value
  if (timerPaused.value) {
    stopStudentTimer()
    stopTotalTimer()
  } else {
    startStudentTimer()
    startTotalTimer()
  }
}

function restartStudentTimer() {
  const studentId = currentStudent.value?.id
  if (!studentId || loading.value) return
  elapsedByStudent.value[studentId] = 0
  if (!timerPaused.value) startStudentTimer()
}

function ensureStudentEvaluation(studentId) {
  if (!studentId) return
  if (!evaluationRecords.value[studentId]) evaluationRecords.value[studentId] = defaultEvaluation()
  evaluationRecords.value[studentId].actitudGeneral ||= {}
  ATTITUDE_ROWS.forEach((row) => {
    if (!(row.key in evaluationRecords.value[studentId].actitudGeneral)) evaluationRecords.value[studentId].actitudGeneral[row.key] = null
  })
  if (!Number.isFinite(Number(evaluationRecords.value[studentId].faltasJustificadas))) evaluationRecords.value[studentId].faltasJustificadas = 0
  if (!Number.isFinite(Number(evaluationRecords.value[studentId].faltasInjustificadas))) evaluationRecords.value[studentId].faltasInjustificadas = 0
  if (!Number.isFinite(Number(evaluationRecords.value[studentId].retrasos))) evaluationRecords.value[studentId].retrasos = 0
}

function selectStudent(index) {
  if (!students.value.length) return
  const nextIndex = Math.min(Math.max(index, 0), students.value.length - 1)
  if (nextIndex === selectedStudentIndex.value) return
  stopStudentTimer()
  selectedStudentIndex.value = nextIndex
  startStudentTimer()
}

function previousStudent() {
  selectStudent(selectedStudentIndex.value - 1)
}

function nextStudent() {
  selectStudent(selectedStudentIndex.value + 1)
}

function setPeriod(period) {
  selectedPeriod.value = period
  // Los otros periodos parten de una ficha vacía, pero se guardan con la misma
  // estructura para que puedan completarse más adelante sin migraciones.
  const studentId = currentStudent.value?.id
  if (!studentId) return
  const identity = studentIdentities.value.get(studentId) || {}
  const saved = identity.evaluacionesPrivadas?.[props.group.id]?.[period]
  evaluationRecords.value[studentId] = saved ? clone(saved) : defaultEvaluation()
}

function updateEvaluation() {
  const studentId = currentStudent.value?.id
  if (!studentId) return
  ensureStudentEvaluation(studentId)
  scheduleSave()
}

function scheduleSave() {
  clearTimeout(saveTimer)
  const studentId = currentStudent.value?.id
  const period = selectedPeriod.value
  const evaluation = clone(currentEvaluation.value)
  saveTimer = setTimeout(() => { void persistEvaluation(studentId, period, evaluation) }, 350)
}

async function persistEvaluation(studentId, period, evaluation) {
  if (!studentId || !props.group?.id) return
  const previous = studentIdentities.value.get(studentId) || { id: studentId }
  const identity = clone(previous)
  identity.id = studentId
  identity.evaluacionesPrivadas ||= {}
  identity.evaluacionesPrivadas[props.group.id] ||= {}
  identity.evaluacionesPrivadas[props.group.id][period] = clone(evaluation)
  saving.value = true
  try {
    await saveStudentIdentities(props.group.id, [identity], { preserveEmpty: false })
    studentIdentities.value.set(studentId, identity)
  } catch (error) {
    showAppErrorToast(error?.message || 'No se ha podido guardar la evaluación en este dispositivo.')
  } finally {
    saving.value = false
  }
}

function persistCurrentEvaluation() {
  return persistEvaluation(currentStudent.value?.id, selectedPeriod.value, currentEvaluation.value)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function marker(checked) {
  return `<span class="marker${checked ? ' marker-checked' : ''}">${checked ? '●' : '○'}</span>`
}

function formatReportDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function printEvaluationSheets() {
  if (loading.value || !students.value.length || selectedPeriod.value !== 'inicial') {
    showAppErrorToast('Selecciona «Inicial» para imprimir los cuestionarios.')
    return
  }
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    showAppErrorToast('El navegador ha bloqueado la ventana de impresión.')
    return
  }
  const printLogos = [
    ['/brand/evaluation/comunidad-madrid.png', 'Comunidad de Madrid'],
    ['/brand/evaluation/fse.png', 'Fondo Social Europeo'],
    ['/brand/evaluation/ies-africa.png', 'IES África'],
  ]
  const logoHtml = printLogos.map(([url, alt]) => `<img src="${url}" alt="${alt}" />`).join('')
  const groupName = props.group?.nombre || props.group?.curso || ''
  const reportDate = formatReportDate()
  const sheets = students.value.map((student) => {
    const identity = studentIdentities.value.get(student.id) || {}
    const evaluation = evaluationRecords.value[student.id] || defaultEvaluation()
    const photo = identity.foto || student.foto || ''
    const attitudes = ATTITUDE_ROWS.map((row) => `<tr><th>${escapeHtml(row.label)}</th>${ATTITUDE_OPTIONS.map((option) => `<td>${marker(evaluation.actitudGeneral?.[row.key] === option.value)}</td>`).join('')}</tr>`).join('')
    const general = GENERAL_OPTIONS.map((option) => `<span>${marker(evaluation.valoracionGeneral === option.value)} ${escapeHtml(option.title)}</span>`).join('')
    return `<article class="sheet">
      <header class="sheet-header">
        <div class="sheet-logos">${logoHtml}</div>
        <div class="sheet-title"><div>INFORME DE EVALUACIÓN INICIAL</div><small>IES África · Refuerzo de Matemáticas</small></div>
        ${photo ? `<img class="sheet-student-photo" src="${escapeHtml(photo)}" alt="Fotografía del alumno" />` : ''}
      </header>
      <div class="student-line"><strong>ALUMNO/A</strong><span>${escapeHtml(identity.nombre || student.nombre || '')}</span><strong>CURSO</strong><span>${escapeHtml(groupName)}</span></div>
      <section><h2>1. VALORACIÓN GENERAL DE DESARROLLO INICIAL DE LAS COMPETENCIAS CLAVE</h2><div class="general-options">${general}</div></section>
      <section><h2>2. ACTITUD GENERAL</h2><p class="instruction">Marque con una opción lo que corresponda.</p><table><thead><tr><th>Aspecto</th>${ATTITUDE_OPTIONS.map((option) => `<th>${escapeHtml(option.title)}</th>`).join('')}</tr></thead><tbody>${attitudes}</tbody></table></section>
      <section class="observations"><h2>OBSERVACIONES DEL TUTOR</h2><p class="observation-note">(fortalezas, aspectos a mejorar, recomendaciones a la familia…)</p><div class="observation-box">${escapeHtml(evaluation.observacionesTutor).replaceAll('\n', '<br>')}</div></section>
      <footer><div>Fuenlabrada, ${escapeHtml(reportDate)}</div><div class="signature"><strong>EL/LA TUTOR/A</strong><span>Fdo: _______________________________________</span></div><p>Don/Doña ________________________________________, tutor/a legal del alumno/a ________________________, del curso ${escapeHtml(groupName)}, ha recibido el informe de la EVALUACIÓN INICIAL del curso 2026/2027.</p><div class="signature"><span>Firma tutores legales: __________________________</span></div><small>Calle de Portugal, 41 – 28943 FUENLABRADA (MADRID) – C.C. 28077907 – Teléfono: 916073584 – FAX 916085507</small></footer>
    </article>`
  }).join('')
  let printStarted = false
  const startPrint = () => {
    if (printStarted) return
    printStarted = true
    printWindow.focus()
    window.setTimeout(() => { printWindow.print(); printWindow.close() }, 450)
  }
  printWindow.addEventListener('load', startPrint, { once: true })
  printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Evaluación inicial - ${escapeHtml(groupName)}</title><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#1d1d1d;font-family:Arial,Helvetica,sans-serif}.sheet{width:100%;height:273mm;min-height:0;page-break-after:always;padding:5mm 4mm;display:flex;flex-direction:column;gap:4mm}.sheet:last-child{page-break-after:auto}.sheet-header{display:flex;align-items:center;gap:6mm;min-height:27mm;border-bottom:1.2px solid #233f69;padding-bottom:3mm}.sheet-logos{display:flex;align-items:center;gap:3mm;height:24mm;max-width:84mm}.sheet-logos img{max-width:26mm;max-height:23mm;object-fit:contain}.sheet-title{flex:1;color:#203f6a;font-size:16pt;font-weight:800;line-height:1.15}.sheet-title small{display:block;margin-top:2mm;font-size:9pt;font-weight:500}.sheet-student-photo{width:22mm;height:22mm;border:1px solid #b8c5d2;border-radius:50%;object-fit:cover}.student-line{display:grid;grid-template-columns:auto 1fr auto 38mm;gap:3mm;align-items:end;border:1px solid #565656;padding:3mm;font-size:10pt}.student-line span{min-height:5mm;border-bottom:1px solid #565656}.sheet section{margin-top:1mm}.sheet h2{margin:0 0 2.5mm;color:#203f6a;font-size:10.3pt;line-height:1.15}.general-options{display:flex;gap:12mm;padding:1mm 4mm;font-size:10pt}.marker{display:inline-block;width:4.5mm;color:#59616c;font-size:14pt;line-height:.7;vertical-align:-.5mm}.marker-checked{color:#203f6a}.instruction,.observation-note{margin:0 0 2mm;font-size:8.5pt;color:#555}table{width:100%;border-collapse:collapse;font-size:8.6pt}th,td{border:1px solid #555;padding:2.5mm 2mm;text-align:center;vertical-align:middle}th:first-child{width:43%;text-align:left}tbody th{font-weight:600}.observations{flex:1;min-height:39mm}.observation-box{min-height:30mm;border:1px solid #555;padding:3mm;font-size:9pt;line-height:1.3}.sheet footer{margin-top:auto;border-top:1px solid #777;padding-top:3mm;font-size:8pt;line-height:1.25}.signature{display:flex;justify-content:space-between;gap:10mm;margin:4mm 0}.sheet footer p{margin:3mm 0}.sheet footer>small{display:block;margin-top:4mm;text-align:center;font-size:6.7pt;color:#555}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>${sheets}</body></html>`)
  printWindow.document.close()
  window.setTimeout(() => {
    if (printWindow.document.readyState === 'complete') startPrint()
  }, 700)
}

async function hydrate() {
  loading.value = true
  loadError.value = ''
  try {
    const identities = await loadStudentIdentitiesForGroup(props.group)
    studentIdentities.value = identities
    const firstStudent = students.value[0]
    if (firstStudent) {
      const saved = identities.get(firstStudent.id)?.evaluacionesPrivadas?.[props.group.id]?.[selectedPeriod.value]
      evaluationRecords.value[firstStudent.id] = saved ? clone(saved) : defaultEvaluation()
    }
    students.value.forEach((student) => {
      ensureStudentEvaluation(student.id)
    })
  } catch (error) {
    loadError.value = error?.message || 'No se han podido abrir las evaluaciones locales.'
    showAppErrorToast(loadError.value)
  } finally {
    loading.value = false
    startStudentTimer()
    startTotalTimer()
  }
}

watch(() => props.group?.id, () => {
  stopStudentTimer()
  stopTotalTimer()
  totalElapsedSeconds.value = 0
  timerPaused.value = false
  selectedStudentIndex.value = 0
  selectedPeriod.value = 'inicial'
  void hydrate()
})

watch(() => currentStudent.value?.id, (studentId) => {
  if (!studentId) return
  const saved = studentIdentities.value.get(studentId)?.evaluacionesPrivadas?.[props.group.id]?.[selectedPeriod.value]
  evaluationRecords.value[studentId] = saved ? clone(saved) : defaultEvaluation()
})

watch(selectedPeriod, (period, previous) => {
  if (period === previous) return
  const studentId = currentStudent.value?.id
  if (!studentId) return
  const saved = studentIdentities.value.get(studentId)?.evaluacionesPrivadas?.[props.group.id]?.[period]
  evaluationRecords.value[studentId] = saved ? clone(saved) : defaultEvaluation()
})

onMounted(hydrate)
onBeforeUnmount(() => {
  stopStudentTimer()
  stopTotalTimer()
  clearTimeout(saveTimer)
  void persistCurrentEvaluation()
})
</script>

<template>
  <div class="student-evaluations">
    <aside class="student-evaluations-periods" aria-label="Periodo de evaluación">
      <div class="student-evaluations-periods-title">Evaluaciones</div>
      <button
        v-for="period in PERIODS"
        :key="period.key"
        type="button"
        class="student-evaluations-period"
        :class="{ 'student-evaluations-period-active': selectedPeriod === period.key }"
        @click="setPeriod(period.key)"
      >{{ period.label }}</button>
    </aside>

    <section class="student-evaluations-content">
      <div class="student-evaluations-toolbar">
        <div class="student-evaluations-toolbar-title">
          <strong>{{ currentPeriodLabel }}</strong>
          <span v-if="currentStudent">· {{ displayShortName(currentStudent) }}</span>
        </div>
        <div class="student-evaluations-toolbar-actions">
          <div class="student-evaluations-timer-controls" aria-label="Cronómetro de la ficha">
            <button type="button" class="student-evaluations-timer-button" :disabled="loading || !currentStudent" :aria-label="currentTimerPaused ? 'Reanudar cronómetro' : 'Pausar cronómetro'" :title="currentTimerPaused ? 'Reanudar cronómetro' : 'Pausar cronómetro'" @click="toggleStudentTimer">
              <v-icon :icon="currentTimerPaused ? 'mdi-play' : 'mdi-pause'" size="15" />
            </button>
            <span class="student-evaluations-timer" title="Tiempo del alumno · tiempo total de la evaluación">
              <span>T. alumno {{ formatElapsed(currentElapsedSeconds) }}</span>
              <span aria-hidden="true">·</span>
              <span>T. total {{ formatElapsed(totalElapsedSeconds) }}</span>
            </span>
            <button type="button" class="student-evaluations-timer-button" :disabled="loading || !currentStudent" aria-label="Reiniciar cronómetro" title="Reiniciar cronómetro" @click="restartStudentTimer">
              <v-icon icon="mdi-restart" size="15" />
            </button>
          </div>
          <button type="button" class="student-evaluations-print" :disabled="loading || !students.length || selectedPeriod !== 'inicial'" aria-label="Imprimir evaluación inicial de todos los alumnos" title="Imprimir evaluación inicial de todos los alumnos" @click="printEvaluationSheets">
            <v-icon icon="mdi-printer-outline" size="18" />
            <span>Imprimir</span>
          </button>
        </div>
        <div class="student-evaluations-student-navigation" aria-label="Navegar entre alumnos">
          <button type="button" class="student-evaluations-nav" :disabled="selectedStudentIndex <= 0 || loading" aria-label="Alumno anterior" @click="previousStudent"><v-icon icon="mdi-chevron-left" /></button>
          <span>{{ students.length ? selectedStudentIndex + 1 : 0 }} / {{ students.length }}</span>
          <button type="button" class="student-evaluations-nav" :disabled="selectedStudentIndex >= students.length - 1 || loading" aria-label="Alumno siguiente" @click="nextStudent"><v-icon icon="mdi-chevron-right" /></button>
        </div>
      </div>

      <div v-if="loading" class="student-evaluations-state"><v-progress-circular indeterminate color="primary" /><span>Cargando evaluación local…</span></div>
      <div v-else-if="loadError" class="student-evaluations-state student-evaluations-state-error">{{ loadError }}</div>
      <div v-else-if="!currentStudent" class="student-evaluations-state">Este grupo todavía no tiene alumnos.</div>
      <form v-else class="student-evaluations-form" @submit.prevent>
        <header class="student-evaluations-student-header">
          <div>
            <span class="student-evaluations-kicker">Alumno/a</span>
            <h2>{{ displayName(currentStudent) }}</h2>
          </div>
          <img v-if="currentIdentity.foto" class="student-evaluations-student-photo" :src="currentIdentity.foto" :alt="`Fotografía de ${displayName(currentStudent)}`">
          <span v-if="saving" class="student-evaluations-saving">Guardando en este dispositivo…</span>
        </header>
        <div v-if="currentAge !== null || currentPendingSubjects.length" class="student-evaluations-student-facts">
          <span v-if="currentAge !== null"><strong>Edad:</strong> {{ currentAge }} años</span>
          <span v-if="currentPendingSubjects.length"><strong>Pendientes:</strong> {{ currentPendingSubjects.join(' · ') }}</span>
        </div>

        <div v-if="selectedPeriod === 'inicial'" class="student-evaluations-attendance">
          <v-text-field v-model.number="currentEvaluation.faltasJustificadas" type="number" min="0" step="1" label="Faltas justificadas" variant="outlined" density="compact" hide-details @update:model-value="updateEvaluation" />
          <v-text-field v-model.number="currentEvaluation.faltasInjustificadas" type="number" min="0" step="1" label="Faltas injustificadas" variant="outlined" density="compact" hide-details @update:model-value="updateEvaluation" />
          <v-text-field v-model.number="currentEvaluation.retrasos" type="number" min="0" step="1" label="Retrasos" variant="outlined" density="compact" hide-details @update:model-value="updateEvaluation" />
        </div>

        <section v-if="selectedPeriod === 'inicial'" class="student-evaluations-section">
          <h3>Valoración general de desarrollo inicial de las competencias clave</h3>
          <v-radio-group v-model="currentEvaluation.valoracionGeneral" inline hide-details @update:model-value="updateEvaluation">
            <v-radio v-for="option in GENERAL_OPTIONS" :key="option.value" :label="option.title" :value="option.value" />
          </v-radio-group>
        </section>

        <section v-if="selectedPeriod === 'inicial'" class="student-evaluations-section">
          <h3>Actitud general</h3>
          <div class="student-evaluations-attitude-table">
            <div class="student-evaluations-attitude-head"><span>Indicador</span><span v-for="option in ATTITUDE_OPTIONS" :key="option.value">{{ option.title }}</span></div>
            <div v-for="row in ATTITUDE_ROWS" :key="row.key" class="student-evaluations-attitude-row">
              <strong>{{ row.label }}</strong>
              <label v-for="option in ATTITUDE_OPTIONS" :key="option.value" class="student-evaluations-attitude-choice">
                <input v-model="currentEvaluation.actitudGeneral[row.key]" type="radio" :name="`${currentStudent.id}-${row.key}`" :value="option.value" @change="updateEvaluation">
                <span aria-hidden="true"></span>
              </label>
            </div>
          </div>
        </section>

        <section v-if="selectedPeriod === 'inicial'" class="student-evaluations-section student-evaluations-observations">
          <h3>Observaciones del tutor</h3>
          <v-textarea v-model="currentEvaluation.observacionesTutor" rows="5" auto-grow variant="outlined" hide-details placeholder="Fortalezas, aspectos a mejorar, recomendaciones a la familia…" @update:model-value="updateEvaluation" />
        </section>
        <div v-else class="student-evaluations-future-period">
          Este periodo estará disponible próximamente.
        </div>
      </form>
    </section>
    <aside class="student-evaluations-student-list" aria-label="Alumnos del grupo">
      <div class="student-evaluations-student-list-title">Alumnos</div>
      <button
        v-for="(student, index) in students"
        :key="student.id"
        type="button"
        class="student-evaluations-student-option"
        :class="{ 'student-evaluations-student-option-active': selectedStudentIndex === index }"
        @click="selectStudent(index)"
      >
        <span class="student-evaluations-student-number">{{ index + 1 }}</span>
        <span>{{ displayName(student) }}</span>
      </button>
      <div v-if="!students.length" class="student-evaluations-student-list-empty">Sin alumnos</div>
    </aside>
  </div>
</template>

<style scoped>
.student-evaluations {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f6f8fc;
  color: #294d78;
}
.student-evaluations-periods {
  width: 190px;
  flex: 0 0 190px;
  padding: 18px 12px;
  border-right: 1px solid #d6e0ed;
  background: #edf3fa;
}
.student-evaluations-periods-title {
  padding: 4px 12px 14px;
  color: #6c82a0;
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.student-evaluations-period {
  display: block;
  width: 100%;
  margin: 4px 0;
  padding: 11px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #44688f;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.student-evaluations-period:hover { background: #e1ebf7; }
.student-evaluations-period-active { background: #3f73ac; color: #fff; font-weight: 700; }
.student-evaluations-content { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; padding: 0 18px 24px; }
.student-evaluations-toolbar { position: sticky; z-index: 2; top: 0; display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-height: 58px; border-bottom: 1px solid #d6e0ed; background: rgba(246,248,252,.96); backdrop-filter: blur(8px); }
.student-evaluations-toolbar-title { display: flex; align-items: baseline; gap: 14px; }
.student-evaluations-toolbar-title { margin-right: auto; }
.student-evaluations-toolbar-title strong { font-size: 1rem; }
.student-evaluations-toolbar-title span { color: #778da8; }
.student-evaluations-toolbar-actions { display: inline-flex; align-items: center; gap: 10px; }
.student-evaluations-timer-controls { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.student-evaluations-timer-button { display: inline-grid; place-items: center; width: 27px; height: 27px; padding: 0; border: 0; border-radius: 50%; background: #e5edf7; color: #3f73ac; cursor: pointer; }
.student-evaluations-timer-button:hover:not(:disabled) { background: #d7e5f4; }
.student-evaluations-timer-button:disabled { cursor: default; opacity: .45; }
.student-evaluations-timer { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 148px; color: #315f94; font-size: .72rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.student-evaluations-student-navigation { display: flex; align-items: center; gap: 8px; color: #657d9b; font-size: .85rem; }
.student-evaluations-nav { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #e5edf7; color: #3f73ac; cursor: pointer; }
.student-evaluations-nav:disabled { opacity: .45; cursor: default; }
.student-evaluations-print { display: inline-flex; align-items: center; gap: 5px; margin-left: 28px; padding: 7px 10px; border: 1px solid #b7c9de; border-radius: 999px; background: #fff; color: #315f94; font: inherit; font-size: .72rem; font-weight: 700; cursor: pointer; }
.student-evaluations-print:hover:not(:disabled) { background: #edf3fa; }
.student-evaluations-print:disabled { cursor: default; opacity: .45; }
.student-evaluations-form { max-width: 980px; margin: 16px auto 0; }
.student-evaluations-student-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.student-evaluations-kicker { color: #8196b0; font-size: .75rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.student-evaluations-student-header h2 { margin: 3px 0 0; color: #2f5c8e; font-size: 1.25rem; }
.student-evaluations-student-photo { width: 70px; height: 70px; flex: 0 0 70px; border: 2px solid #d0dce9; border-radius: 50%; object-fit: cover; }
.student-evaluations-saving { color: #7088a4; font-size: .8rem; }
.student-evaluations-student-facts { display: flex; flex-wrap: wrap; gap: 5px 18px; margin: -2px 0 16px; color: #607b9b; font-size: .76rem; }
.student-evaluations-student-facts strong { color: #426992; }
.student-evaluations-attendance { display: grid; grid-template-columns: repeat(3, minmax(130px, 190px)); gap: 8px; margin-bottom: 2px; }
.student-evaluations-section { margin-top: 12px; padding: 14px 16px; border: 1px solid #d6e0ed; border-radius: 12px; background: #fff; }
.student-evaluations-section h3 { margin: 0 0 10px; color: #446a94; font-size: .9rem; }
.student-evaluations-future-period { margin-top: 24px; padding: 28px; border: 1px dashed #c2d1e1; border-radius: 14px; background: #fff; color: #7d91aa; text-align: center; }
.student-evaluations-attitude-table { overflow-x: auto; }
.student-evaluations-attitude-head, .student-evaluations-attitude-row { display: grid; grid-template-columns: minmax(230px, 1.6fr) repeat(4, minmax(110px, 1fr)); align-items: center; min-width: 720px; }
.student-evaluations-attitude-head { padding: 0 10px 6px; color: #7188a4; font-size: .68rem; font-weight: 700; text-align: center; text-transform: uppercase; }
.student-evaluations-attitude-head span:first-child { text-align: left; }
.student-evaluations-attitude-row { min-height: 42px; border-top: 1px solid #e5ebf2; }
.student-evaluations-attitude-row strong { padding: 6px 8px; color: #45698f; font-size: .78rem; }
.student-evaluations-attitude-choice { display: grid; place-items: center; height: 100%; cursor: pointer; }
.student-evaluations-attitude-choice input { position: absolute; opacity: 0; pointer-events: none; }
.student-evaluations-attitude-choice span { width: 16px; height: 16px; border: 2px solid #aebfd3; border-radius: 50%; }
.student-evaluations-attitude-choice input:checked + span { border: 5px solid #3f73ac; background: #fff; }
.student-evaluations-state { display: flex; min-height: 260px; align-items: center; justify-content: center; gap: 12px; color: #7389a4; }
.student-evaluations-state-error { color: #b5263d; }
.student-evaluations-student-list { width: 210px; flex: 0 0 210px; min-height: 0; overflow-y: auto; padding: 14px 10px; border-left: 1px solid #d6e0ed; background: #edf3fa; }
.student-evaluations-student-list-title { padding: 4px 8px 10px; color: #6c82a0; font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.student-evaluations-student-option { display: flex; align-items: center; gap: 7px; width: 100%; margin: 3px 0; padding: 7px 8px; border: 0; border-radius: 9px; background: transparent; color: #44688f; font: inherit; font-size: .74rem; line-height: 1.15; text-align: left; cursor: pointer; }
.student-evaluations-student-option:hover { background: #e1ebf7; }
.student-evaluations-student-option-active { background: #3f73ac; color: #fff; font-weight: 700; }
.student-evaluations-student-option-active:hover { background: #3f73ac; }
.student-evaluations-student-option > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.student-evaluations-student-number { display: inline-grid; place-items: center; width: 21px; height: 21px; flex: 0 0 21px; border-radius: 50%; background: rgba(255,255,255,.58); color: #3f73ac; font-size: .66rem; font-weight: 800; }
.student-evaluations-student-option-active .student-evaluations-student-number { background: rgba(255,255,255,.9); }
.student-evaluations-student-list-empty { padding: 12px 8px; color: #7b91aa; font-size: .76rem; }
@media (max-width: 720px) {
  .student-evaluations-periods { width: 135px; flex-basis: 135px; }
  .student-evaluations-content { padding: 0 14px 28px; }
  .student-evaluations-toolbar { align-items: flex-start; flex-wrap: wrap; gap: 8px; padding: 14px 0; }
  .student-evaluations-toolbar-title { width: 100%; }
  .student-evaluations-student-list { width: 150px; flex-basis: 150px; padding-left: 6px; padding-right: 6px; }
  .student-evaluations-student-header { align-items: flex-start; flex-direction: column; }
  .student-evaluations-attendance { grid-template-columns: 1fr; }
}
</style>
