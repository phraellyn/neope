<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { latex } from 'codemirror-lang-latex'
import { prettyPrintLatex } from '../utils/latexPrettyPrint'

const props = defineProps({
  modelValue: { type: String, default: '' },
  compiling: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'compile'])
const editorHost = ref(null)
let editor = null
let applyingExternalValue = false

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#10213a', color: '#EAF2FF' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { caretColor: '#FFFFFF' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#FFFFFF' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#315E97 !important' },
  '.cm-activeLine': { backgroundColor: '#173455' },
  '.cm-gutters': { backgroundColor: '#0B192D', color: '#8EA7C5', borderRight: '1px solid #244669' },
  '.cm-activeLineGutter': { backgroundColor: '#173455', color: '#FFFFFF' },
}, { dark: true })

const editorHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword], color: '#7DD3FC', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: '#FDE68A' },
  { tag: [tags.number, tags.integer, tags.float], color: '#C4B5FD' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8FB39A', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.paren, tags.punctuation], color: '#F9A8D4' },
  { tag: [tags.typeName, tags.className], color: '#86EFAC' },
]))

function compile() {
  emit('compile')
  editor?.focus()
  return true
}

function format() {
  if (!editor) return true
  const source = editor.state.doc.toString()
  const formatted = prettyPrintLatex(source)
  if (formatted !== source) {
    editor.dispatch({ changes: { from: 0, to: source.length, insert: formatted } })
  }
  editor.focus()
  return true
}

watch(() => props.modelValue, (value) => {
  if (!editor || editor.state.doc.toString() === value) return
  applyingExternalValue = true
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  applyingExternalValue = false
})

onMounted(() => {
  editor = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        editorTheme,
        editorHighlighting,
        latex({ enableAutocomplete: false, autoCloseBrackets: true, autoCloseTags: true, enableTooltips: true }),
        keymap.of([
          indentWithTab,
          { key: 'Mod-s', run: compile },
          { key: 'Ctrl-s', run: compile },
          { key: 'Mod-f', run: format },
          { key: 'Ctrl-f', run: format },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalValue) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
    parent: editorHost.value,
  })
})

onBeforeUnmount(() => editor?.destroy())
</script>

<template>
  <section class="document-code-editor">
    <header>
      <span>Código LaTeX</span>
      <v-spacer />
      <v-tooltip text="Formatear código (Ctrl/Cmd + F)" location="top">
        <template #activator="{ props: tooltipProps }">
          <v-btn v-bind="tooltipProps" prepend-icon="mdi-format-align-left" size="small" variant="text" aria-label="Formatear código" @click="format">Formatear</v-btn>
        </template>
      </v-tooltip>
      <v-tooltip text="Recompilar (Ctrl/Cmd + S)" location="top">
        <template #activator="{ props: tooltipProps }">
          <v-btn v-bind="tooltipProps" prepend-icon="mdi-refresh" size="small" color="primary" variant="tonal" aria-label="Recompilar código" :loading="compiling" @click="compile">Recompilar</v-btn>
        </template>
      </v-tooltip>
    </header>
    <div ref="editorHost" class="document-code-editor-host" />
  </section>
</template>

<style scoped>
.document-code-editor { display: grid; min-width: 0; min-height: 0; grid-template-rows: 43px minmax(0, 1fr); overflow: hidden; background: #10213a; }
.document-code-editor header { display: flex; min-width: 0; align-items: center; gap: 5px; padding: 5px 8px 5px 13px; border-bottom: 1px solid #d8e2ed; background: #f8fafd; color: #365a82; }
.document-code-editor header > span { font-size: .72rem; font-weight: 800; letter-spacing: .035em; text-transform: uppercase; }
.document-code-editor-host { min-width: 0; min-height: 0; overflow: hidden; }
.document-code-editor-host :deep(.cm-editor) { height: 100%; }
</style>
