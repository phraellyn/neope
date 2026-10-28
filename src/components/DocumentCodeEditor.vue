<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { latex } from 'codemirror-lang-latex'
import { formatLatexEditor, goToLatexLine, latexEditorTools, searchLatexEditor, setLatexDiagnostics } from '../utils/latexEditor'
import LatexErrorList from './LatexErrorList.vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  compiling: { type: Boolean, default: false },
  showHeader: { type: Boolean, default: true },
  diagnostics: { type: Array, default: () => [] },
  errorLog: { type: String, default: '' },
  diagnosticSource: { type: String, default: null },
})

const emit = defineEmits(['update:modelValue', 'compile'])
const editorHost = ref(null)
let editor = null
let applyingExternalValue = false
const position = ref({ line: 1, column: 1 })
const errorsStale = computed(() => props.diagnosticSource !== null && props.diagnosticSource !== props.modelValue)

function refreshDiagnostics() {
  setLatexDiagnostics(editor, errorsStale.value ? [] : props.diagnostics)
}

function locateError(error) {
  if (!errorsStale.value) goToLatexLine(editor, error.line, error.column)
}

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
  return formatLatexEditor(editor)
}

function search() { return editor ? searchLatexEditor(editor) : false }

watch(() => props.modelValue, (value) => {
  if (!editor || editor.state.doc.toString() === value) return
  applyingExternalValue = true
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  applyingExternalValue = false
  refreshDiagnostics()
})
watch([() => props.diagnostics, errorsStale], refreshDiagnostics, { deep: true })

onMounted(() => {
  editor = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        editorTheme,
        editorHighlighting,
        latexEditorTools,
        latex({ enableAutocomplete: false, autoCloseBrackets: true, autoCloseTags: true, enableTooltips: true }),
        keymap.of([
          indentWithTab,
          { key: 'Mod-s', run: compile },
          { key: 'Ctrl-s', run: compile },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternalValue) emit('update:modelValue', update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const cursor = update.state.selection.main.head
            const line = update.state.doc.lineAt(cursor)
            position.value = { line: line.number, column: cursor - line.from + 1 }
          }
        }),
      ],
    }),
    parent: editorHost.value,
  })
  refreshDiagnostics()
})

onBeforeUnmount(() => editor?.destroy())
defineExpose({ compile, format, search, goToLine: (line, column) => goToLatexLine(editor, line, column), focus: () => editor?.focus() })
</script>

<template>
  <section class="document-code-editor" :class="{ 'document-code-editor-headerless': !showHeader }">
    <header v-if="showHeader">
      <span>Código LaTeX</span>
      <v-spacer />
      <v-btn prepend-icon="mdi-magnify" size="small" variant="text" title="Buscar (Ctrl/Cmd + F)" aria-label="Buscar en el código" @click="search">Buscar</v-btn>
      <v-tooltip text="Mejorar sangría sin cambiar saltos de línea (Alt + Mayús + F)" location="top">
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
    <div class="document-code-editor-workspace">
      <div ref="editorHost" class="document-code-editor-host" />
      <LatexErrorList :diagnostics="diagnostics" :log="errorLog" :stale="errorsStale" @locate="locateError" />
      <footer>Línea {{ position.line }}, columna {{ position.column }} <span>Ctrl/Cmd + F · Buscar</span></footer>
    </div>
  </section>
</template>

<style scoped>
.document-code-editor { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; background: #10213a; }
.document-code-editor-headerless { grid-template-rows: minmax(0, 1fr); }
.document-code-editor header { display: flex; min-width: 0; min-height: 43px; flex-wrap: wrap; align-items: center; gap: 5px; padding: 5px 8px 5px 13px; border-bottom: 1px solid #d8e2ed; background: #f8fafd; color: #365a82; }
.document-code-editor header > span { font-size: .72rem; font-weight: 800; letter-spacing: .035em; text-transform: uppercase; }
.document-code-editor-host { min-width: 0; min-height: 0; overflow: hidden; }
.document-code-editor-workspace { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; overflow: hidden; }
.document-code-editor-workspace footer { display: flex; justify-content: space-between; gap: 8px; padding: 4px 9px; background: #0b192d; color: #a6bedb; font-size: .68rem; }
.document-code-editor-workspace footer span { color: #829bb9; }
.document-code-editor-host :deep(.cm-editor) { height: 100%; }
</style>
