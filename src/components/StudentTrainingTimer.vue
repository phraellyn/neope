<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { timerElapsed, timerWarning } from '../utils/studentTrainingTimer'
import { playTrainingAlert, unlockTrainingAudio } from '../utils/studentTrainingAudio'

const props = defineProps({ modelValue: { type: Object, required: true }, durationMinutes: { type: Number, default: 15 }, disabled: { type: Boolean, default: false } })
const emit = defineEmits(['action'])
const now = ref(Date.now())
const muted = ref(false)
const elapsed = computed(() => timerElapsed(props.modelValue, now.value))
const duration = computed(() => (props.durationMinutes > 0 ? props.durationMinutes : 15) * 60000)
const expired = computed(() => elapsed.value >= duration.value)
const display = computed(() => {
  const seconds = Math.floor(Math.abs(duration.value - elapsed.value) / 1000)
  return `${expired.value ? '+' : ''}${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
let interval
function beep() {
  if (!muted.value) void playTrainingAlert(() => !muted.value)
}
function toggle() {
  unlockTrainingAudio()
  emit('action', props.modelValue.runningSince ? 'pause' : 'resume')
}
let alertedLocally = false
function reset() { unlockTrainingAudio(); alertedLocally = false; emit('action', 'reset') }
watch(now, (value) => {
  if (!alertedLocally && timerWarning(props.modelValue, duration.value, value)) {
    alertedLocally = true
    emit('action', 'alerted')
    beep()
  }
})
watch(() => props.modelValue.alerted, (value, previous) => { if (!value && previous) alertedLocally = false })
function unlockOnInteraction() { if (!muted.value) unlockTrainingAudio() }
onMounted(() => {
  unlockTrainingAudio()
  window.addEventListener('pointerdown', unlockOnInteraction, { passive: true })
  window.addEventListener('touchstart', unlockOnInteraction, { passive: true })
  window.addEventListener('keydown', unlockOnInteraction)
  interval = window.setInterval(() => { now.value = Date.now() }, 250)
})
onBeforeUnmount(() => {
  window.clearInterval(interval)
  window.removeEventListener('pointerdown', unlockOnInteraction)
  window.removeEventListener('touchstart', unlockOnInteraction)
  window.removeEventListener('keydown', unlockOnInteraction)
})
</script>

<template>
  <div class="student-timer" :class="{ expired }" role="timer" :aria-label="expired ? `Tiempo superado: ${display}` : `Tiempo restante: ${display}`">
    <strong>{{ display }}</strong>
    <v-btn :icon="modelValue.runningSince ? 'mdi-pause' : 'mdi-play'" rounded="circle" variant="text" size="small" :disabled="disabled" :aria-label="modelValue.runningSince ? 'Pausar cronómetro' : 'Continuar cronómetro'" @click="toggle" />
    <v-btn icon="mdi-restart" rounded="circle" variant="text" size="small" :disabled="disabled" aria-label="Reiniciar cronómetro" @click="reset" />
    <v-btn :icon="muted ? 'mdi-volume-off' : 'mdi-volume-high'" rounded="circle" variant="text" size="small" :aria-label="muted ? 'Activar sonido' : 'Silenciar sonido'" @click="muted = !muted; unlockTrainingAudio()" />
  </div>
</template>

<style scoped>
.student-timer { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px 2px 12px; border-radius: 999px; color: #315f96; background: #e8f1fb; }
.student-timer.expired { color: #9d2d2d; background: #fff0ed; }
.student-timer strong { min-width: 54px; font-variant-numeric: tabular-nums; }
</style>
