<script setup>
import { ref, watch } from 'vue'
import ExercisePdfPreview from './ExercisePdfPreview.vue'

const props = defineProps({ src: { type: String, required: true }, title: { type: String, default: 'Enunciado completo' } })
const pageCount = ref(1)
watch(() => props.src, () => { pageCount.value = 1 }, { flush: 'sync' })
</script>

<template>
  <div class="exercise-full-pdf-preview">
    <ExercisePdfPreview v-for="page in pageCount" :key="`${src}:${page}`" :src="src" :page-number="page" :title="`${title}, página ${page}`" thumbnail @page-count="count => { if (page === 1) pageCount = count }" />
  </div>
</template>

<style scoped>
.exercise-full-pdf-preview { background: #fff; }
.exercise-full-pdf-preview > * + * { border-top: 1px solid #e4ebf3; }
</style>
