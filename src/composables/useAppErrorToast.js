import { ref } from 'vue'

const visible = ref(false)
const message = ref('')
const copyText = ref('')
const color = ref('error')

export function showAppErrorToast(value, options = {}) {
  const nextMessage = String(value || '').trim()
  if (!nextMessage) return
  message.value = nextMessage
  copyText.value = options.copy === false ? '' : String(options.copyText || nextMessage)
  color.value = options.color || 'error'
  visible.value = true
}

export function useAppErrorToast() {
  return { visible, message, copyText, color }
}
