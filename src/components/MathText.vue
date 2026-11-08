<script setup>
import { computed } from 'vue'
import 'katex/dist/katex.min.css'
import { renderMathText } from '../utils/mathText'

const props = defineProps({ text: { type: [String, Number], default: '' } })
const parts = computed(() => renderMathText(props.text))
</script>

<template><span class="math-text"><template v-for="(part, index) in parts" :key="index"><span v-if="part.html" v-html="part.html" /><template v-else>{{ part.text }}</template></template></span></template>

<style scoped>.math-text { white-space: pre-wrap; overflow-wrap: anywhere; }.math-text :deep(.katex-display) { margin: .35em 0; overflow-x: auto; overflow-y: hidden; }</style>
