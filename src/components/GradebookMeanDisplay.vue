<script setup>
import { computed } from 'vue'
import { formatGradebookMean } from '../utils/gradebookMeanDisplay'
const props = defineProps({ value: { type: Number, default: null }, options: { type: Object, default: () => ({}) }, label: { type: String, default: '' } })
const display = computed(() => formatGradebookMean(props.value, props.options))
const accessible = computed(() => [props.label, display.value.primary ? `nota ${display.value.primary}` : 'sin nota', display.value.precise ? `media ${display.value.precise}` : ''].filter(Boolean).join(': '))
</script>

<template>
  <output class="gradebook-mean-output" :class="{ 'gradebook-mean-output-both': display.precise }" :aria-label="accessible"><span class="gradebook-mean-main">{{ display.primary }}</span><small v-if="display.precise" class="gradebook-mean-precise">{{ display.precise }}</small></output>
</template>

<style scoped>
.gradebook-mean-output { position: relative; display: grid; width: 100%; height: 100%; min-height: 36px; place-items: center; }
.gradebook-mean-output-both .gradebook-mean-main { font-size: 1.1rem; line-height: 1; }
.gradebook-mean-precise { position: absolute; right: 4px; bottom: 2px; color: #7289a0; font-size: .55rem; font-weight: 400; line-height: 1; }
</style>
