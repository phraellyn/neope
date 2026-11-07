let context
export function unlockTrainingAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!Audio) return
    context ||= new Audio()
    void context.resume().catch(() => {})
  } catch { /* El navegador puede bloquear el sonido. */ }
}
export function playTrainingAlert() {
  try {
    if (!context || context.state !== 'running') return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 660
    gain.gain.value = 0.08
    oscillator.connect(gain); gain.connect(context.destination)
    oscillator.start(); oscillator.stop(context.currentTime + .25)
  } catch { /* La señal visual continúa funcionando. */ }
}
