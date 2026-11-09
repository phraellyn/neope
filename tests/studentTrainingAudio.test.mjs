import assert from 'node:assert/strict'

const starts = []
const stops = []
let contexts = 0
class FakeAudioContext {
  constructor() { contexts++; this.state = 'suspended'; this.currentTime = 10; this.destination = {} }
  async resume() { this.state = 'running' }
  createOscillator() { return { frequency: {}, connect() {}, start(at) { starts.push(at) }, stop(at) { stops.push(at) } } }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} } }
}
globalThis.window = { AudioContext: FakeAudioContext }
try {
  const { unlockTrainingAudio, playTrainingAlert } = await import('../src/utils/studentTrainingAudio.js')
  unlockTrainingAudio()
  await playTrainingAlert()
  assert.equal(contexts, 1, 'Se reutiliza el contexto desbloqueado')
  assert.equal(starts.length, 2, 'El aviso contiene dos sonidos')
  assert.ok(starts[1] > stops[0], 'Los sonidos quedan separados')
  await playTrainingAlert(() => false)
  assert.equal(starts.length, 2, 'Al silenciar no se programan sonidos')
} finally { delete globalThis.window }
console.log('Aviso acústico: dos tonos suaves y silencio verificados.')
