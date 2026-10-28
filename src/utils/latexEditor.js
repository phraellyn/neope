import { EditorState, Prec } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { lintGutter, lintKeymap, setDiagnostics } from '@codemirror/lint'
import { prettyPrintLatex } from './latexPrettyPrint.js'

export function formatLatexEditor(view) {
  if (!view) return false
  const source = view.state.doc.toString()
  const formatted = prettyPrintLatex(source).split('\n')
  const changes = []
  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number)
    const next = formatted[number - 1]
    if (next !== line.text) changes.push({ from: line.from, to: line.from + (line.text.match(/^[ \t]*/)?.[0].length || 0), insert: next.match(/^[ \t]*/)?.[0] || '' })
  }
  if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
  return true
}

function wrappedIndentations(view) {
  const ranges = []
  const visited = new Set()
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from)
    while (line.from <= visible.to) {
      if (!visited.has(line.number)) {
        visited.add(line.number)
        const prefix = line.text.match(/^[ \t]*/)?.[0] || ''
        let width = 0
        for (const character of prefix) width += character === '\t' ? view.state.tabSize - width % view.state.tabSize : 1
        const indent = Math.min(width, 24)
        if (indent) ranges.push(Decoration.line({ attributes: { style: `padding-left:calc(${indent}ch + 6px);text-indent:-${indent}ch` } }).range(line.from))
      }
      if (line.number === view.state.doc.lines) break
      line = view.state.doc.line(line.number + 1)
    }
  }
  return Decoration.set(ranges, true)
}

const hangingIndent = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = wrappedIndentations(view) }
  update(update) { if (update.docChanged || update.viewportChanged) this.decorations = wrappedIndentations(update.view) }
}, { decorations: (plugin) => plugin.decorations })

export const latexEditorTools = [
  EditorView.lineWrapping,
  hangingIndent,
  search({ top: true }),
  lintGutter(),
  Prec.highest(keymap.of([
    { key: 'Mod-f', run: openSearchPanel },
    { key: 'Alt-Shift-f', run: formatLatexEditor },
    ...searchKeymap,
    ...lintKeymap,
  ])),
  EditorState.phrases.of({
    'Find': 'Buscar', 'Replace': 'Reemplazar', 'next': 'Siguiente', 'previous': 'Anterior',
    'all': 'Todos', 'match case': 'Distinguir mayúsculas', 'regexp': 'Expresión regular',
    'by word': 'Palabra completa', 'replace': 'Reemplazar', 'replace all': 'Reemplazar todo',
    'close': 'Cerrar', 'Go to line': 'Ir a la línea', 'go': 'Ir', 'Diagnostics': 'Errores',
    'No diagnostics': 'Sin errores',
  }),
  EditorView.theme({
    '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
    '.cm-content': { overflowWrap: 'anywhere' },
    '.cm-line': { overflowWrap: 'anywhere', wordBreak: 'break-word' },
    '.cm-panels': { backgroundColor: '#edf3fa', color: '#173455' },
    '.cm-search': { padding: '7px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' },
    '.cm-search .cm-textfield': { minWidth: '80px', maxWidth: '100%', background: '#fff', color: '#173455' },
    '.cm-search .cm-button': { backgroundImage: 'none', backgroundColor: '#e2eaf4', color: '#173455' },
    '.cm-searchMatch': { backgroundColor: '#a0711f88', outline: '1px solid #e9bb56' },
    '.cm-searchMatch-selected': { backgroundColor: '#b57923cc' },
    '.cm-tooltip-lint': { backgroundColor: '#fff4f4', color: '#822525', borderColor: '#e7a5a5' },
    '.cm-diagnostic': { fontFamily: 'inherit', whiteSpace: 'pre-wrap' },
  }),
]

export function setLatexDiagnostics(view, diagnostics = []) {
  if (!view) return
  view.dispatch(setDiagnostics(view.state, diagnostics.filter((item) => item.line > 0 && item.line <= view.state.doc.lines).map((item) => {
    const line = view.state.doc.line(item.line)
    return { from: line.from, to: line.to, severity: item.severity || 'error', message: item.message, source: 'LaTeX' }
  })))
}

export function goToLatexLine(view, line, column = 1) {
  if (!view || !Number.isInteger(line) || line < 1 || line > view.state.doc.lines) return false
  const target = view.state.doc.line(line)
  const position = Math.min(target.to, target.from + Math.max(0, Number(column) - 1))
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) })
  view.focus()
  return true
}

export function searchLatexEditor(view) { return view ? openSearchPanel(view) : false }
