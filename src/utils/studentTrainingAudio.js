let context
export function unlockTrainingAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!Audio) return null
    if (context?.state === 'closed') context = null
    context ||= new Audio()
    if (context.state !== 'running') void context.resume().catch(() => {})
    return context
  } catch { return null }
}
export async function playTrainingAlert(isEnabled = () => true) {
  try {
    const audio = unlockTrainingAudio()
    if (!audio) return
    if (audio.state !== 'running') await Promise.race([audio.resume(), new Promise((resolve) => setTimeout(resolve, 500))])
    if (audio.state !== 'running' || !isEnabled()) return
    const start = audio.currentTime + 0.03
    for (const offset of [0, 0.48]) {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      const at = start + offset
      oscillator.type = 'sine'
      oscillator.frequency.value = 660
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(0.08, at + 0.04)
      gain.gain.setValueAtTime(0.08, at + 0.22)
      gain.gain.linearRampToValueAtTime(0, at + 0.32)
      oscillator.connect(gain); gain.connect(audio.destination)
      oscillator.start(at); oscillator.stop(at + 0.33)
    }
  } catch { /* La señal visual continúa funcionando. */ }
}
