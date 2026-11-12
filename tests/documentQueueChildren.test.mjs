import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const file = resolve('src/components/DocumentQueueChildren.vue')
const runtime = resolve('tests/.document-queue-runtime.mjs')
let source = compileScript(parse(readFileSync(file, 'utf8')).descriptor, { id: 'queue-test', inlineTemplate: true }).content
source = source.replace("import ExercisePdfPreview from './ExercisePdfPreview.vue'", "const ExercisePdfPreview = { props: ['src'], template: '<div>PDF: {{ src }}</div>' }")
writeFileSync(runtime, source)
try {
  const { default: Queue } = await import(pathToFileURL(runtime).href)
  const exercise = { type: 'exercise', blockId: 'exercise-1', exerciseId: 'one' }
  const app = createSSRApp({ render: () => h(Queue, {
    blocks: [exercise], containerId: 'question-4', exercises: [{ id: 'one', titulo: 'Ejercicio de prueba' }],
    tools: [], mainPdf: () => 'main.pdf', apartados: () => [{ id: 'a' }, { id: 'b' }],
    apartadoPdf: (_, index) => `part-${index}.pdf`, metrics: () => ({ puntuacion: 2, tiempo: 5, apartados: [{ puntuacion: 1 }, { puntuacion: 1 }] }),
  }) })
  for (const name of ['v-icon', 'v-spacer', 'v-btn', 'v-text-field']) app.component(name, { render: () => null })
  const html = await renderToString(app)
  assert.match(html, /main\.pdf/)
  assert.match(html, /part-0\.pdf/)
  assert.match(html, /part-1\.pdf/)
  assert.match(html, /Ejercicio de prueba/)
  console.log('Bloques optativos: enunciado y apartados visibles.')
} finally {
  unlinkSync(runtime)
}
