import { executableLatex } from './latexDocumentSource.js'

// The comments travel with the .tex file and remain harmless to LaTeX.
const aliases = { asignatura: 'subject', subject: 'subject', titulo: 'title', title: 'title', fecha: 'date', date: 'date', grupo: 'course', curso: 'course', course: 'course', nivel: 'level', level: 'level' }
const labels = { subject: 'Asignatura', title: 'Título', date: 'Fecha', course: 'Grupo', level: 'Nivel' }
const types = { subject: 'subject', date: 'date', course: 'group', level: 'level' }
export function canonicalFieldKey(key) {
  const normalized = String(key || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return aliases[normalized] || String(key || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_]+/g, '_')
}
export function isInternalTemplate(template = {}) {
  return /(?:^|[\\/])ejercicio(?:\.tex)?$/i.test(String(template.archivo || template.nombre || '').trim())
}

// Upgrade only the known built-in collection header, preserving custom templates
// and the rest of the preamble stored in Firestore or in older documents.
export function upgradeExerciseCollectionHeader(template, standardCode) {
  if (String(template?.archivo || '').toLowerCase() !== 'ejercicios.tex') return template
  const code = String(template.codigo || '')
  if (!code.includes('\\newcommand{\\logo}[4]') || !code.includes('\\node at (13.0,0.55)')) return template
  const pattern = /\\newcommand\{\\logo\}\[\d+\]\{[\s\S]*?\n\}\s*(?=\\newenvironment\{ejercicios\})/
  const replacement = String(standardCode || '').match(pattern)?.[0]
  const centerField = String(standardCode || '').match(/^% neope:field \{"key":"center"[^\r\n]*$/m)?.[0]
  if (!replacement || !centerField || !pattern.test(code)) return template
  let updated = code.replace(pattern, () => replacement)
  if (!/^% neope:field \{"key":"center"/m.test(updated)) {
    updated = updated.replace(/^(% neope:document \{[^\r\n]*\})/m, `$1\n${centerField}`)
  }
  return { ...template, codigo: updated }
}
function declarations(code, type) {
  return [...code.matchAll(new RegExp(`^\\s*%\\s*neope:${type}\\s+(\\{.*\\})\\s*$`, 'gm'))].map((match) => {
    try { return JSON.parse(match[1]) } catch { throw new Error(`Declaración neope:${type} no válida: ${match[1]}`) }
  })
}
function normalizedField(field) {
  const key = canonicalFieldKey(field.key || field.label)
  return { ...field, key, label: field.label || labels[key] || key, type: field.type || types[key] || 'text', required: field.required !== false, ...(field.argument != null ? { argument: Number(field.argument) } : {}) }
}
export function templateMarkerFields(code = '') {
  // Ignore the commented example in the template editor's help text.
  const source = code.split('\n').filter((line) => !/^\s*%/.test(line)).join('\n')
  const definitions = [...source.matchAll(/\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([A-Za-z@]+)\}?\s*(?:\[(\d+)\])?|\\(?:long\s*\\)?(?:def|gdef)\s*\\([A-Za-z@]+)((?:\s*#\d)*)/g)]
  const fields = []
  for (const marker of source.matchAll(/(?<!%)%%\s*([^%\r\n]+?)\s*%%(?!%)/g)) {
    const definition = definitions.filter((entry) => entry.index < marker.index).at(-1)
    if (!definition) continue
    const command = definition[1] || definition[3]
    const line = source.slice(source.lastIndexOf('\n', marker.index) + 1, marker.index)
    const argumentsOnLine = [...line.matchAll(/#(\d+)/g)].map((entry) => Number(entry[1]))
    marker[1].split(',').forEach((label, index) => {
      if (argumentsOnLine[index]) fields.push(normalizedField({ key: label.trim(), label: labels[canonicalFieldKey(label)] || label.trim(), command, argument: argumentsOnLine[index] }))
    })
  }
  return fields.filter((field, index) => fields.findIndex((other) => other.command === field.command && other.argument === field.argument) === index)
}
function wrapper(code, label) {
  const lines = [...code.matchAll(new RegExp(`^\\s*%%%\\s*${label}:([^\\r\\n]*)$`, 'gmi'))]
  return lines.length ? lines.map((match) => match[1].trim()).join('\n') : null
}
export function readDocumentTemplate(code = '', legacy = null) {
  const declaration = declarations(code, 'document')[0] || {}
  const explicit = declarations(code, 'field').map(normalizedField)
  const inferred = templateMarkerFields(code)
  const fields = [...explicit, ...inferred.filter((field) => !explicit.some((other) => {
    const sameCommand = (other.command || declaration.command || legacy?.command) === field.command
    return sameCommand && (other.key === field.key || other.argument === field.argument)
  }))]
  if (!fields.length && !Object.keys(declaration).length && legacy) fields.push(...legacy.fields.map(normalizedField))
  const content = declaration.content || 'exercises'
  if (!['exercises', 'code'].includes(content)) throw new Error('neope:document content debe ser "exercises" o "code".')
  const before = wrapper(code, 'previo')
  const after = wrapper(code, 'final')
  return {
    ...legacy, ...declaration, version: Number(declaration.version) || 1, content,
    command: declaration.command ?? legacy?.command ?? inferred[0]?.command ?? '',
    fields, tools: legacy?.tools || declarations(code, 'tool'),
    assessment: declaration.assessment ?? content === 'exercises',
    exerciseEnvironment: declaration.exerciseEnvironment ?? 'ejercicios',
    before: before ?? '\\begin{document}\n{{header}}', after: after ?? '\\end{document}',
  }
}
export function migrateDocumentTemplate(template) {
  if (isInternalTemplate(template)) return { ...template, migrated: false }
  const source = String(template.codigo || '')
  const existing = declarations(source, 'document')[0] || {}
  if (Number(existing.version) >= 2) return { ...template, migrated: false }
  const name = String(template.nombre || template.archivo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const notes = /apunt|ejemplo|teoria/.test(name)
  const exam = /examen|exam|prueba|control/.test(name)
  const content = notes ? 'code' : (exam || /\\(?:newenvironment|renewenvironment)\s*\{ejercicios\}/.test(source) ? 'exercises' : 'code')
  const declared = declarations(source, 'field')
  const markers = templateMarkerFields(source)
  const fields = [...declared, ...markers.filter((field) => !declared.some((other) => canonicalFieldKey(other.key) === field.key))].map(normalizedField)
  if ((notes || !exam) && fields.some((field) => field.key === 'course')) {
    fields.forEach((field) => { if (field.key === 'course') Object.assign(field, { key: 'level', label: 'Nivel', type: 'level', required: true }) })
  }
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    if (fields[index].formOnly && fields.some((other) => other !== fields[index] && other.key === fields[index].key && Number.isFinite(other.argument))) fields.splice(index, 1)
  }
  if (!fields.some((field) => field.key === 'level')) fields.unshift(normalizedField({ key: 'level', label: 'Nivel', formOnly: true }))
  if (!fields.some((field) => field.key === 'subject')) fields.push(normalizedField({ key: 'subject', formOnly: true }))
  if (notes || exam) {
    if (!fields.some((field) => field.key === 'title')) fields.push(normalizedField({ key: 'title', formOnly: true }))
  }
  if (!exam) fields.forEach((field) => { if (['date', ...(notes ? [] : ['title'])].includes(field.key)) { field.required = false; field.hidden = field.key === 'date' } })
  const addOption = (key, label, value) => { if (!fields.some((field) => field.key === key)) fields.push({ key, label, type: 'checkbox', default: value, formOnly: true, required: false }) }
  if (content === 'exercises' && !exam) {
    addOption('includeInfo', 'Información de los ejercicios', true)
    addOption('includeAnswers', 'Respuestas breves (sol / lsol)', true)
    addOption('includeSolutions', 'Soluciones detalladas', false)
    addOption('includeCriteria', 'Criterios de calificación', true)
  }
  const config = { ...existing, version: 2, content, assessment: exam, command: existing.command || markers[0]?.command || '', exerciseEnvironment: 'ejercicios', render: { includeSolutions: exam && /resuelt|soluci/.test(name), includeAnswers: exam && /resuelt|soluci/.test(name) } }
  const preview = /\\usepackage\[[^\]]*active[^\]]*\]\{preview\}/.test(source)
  const header = config.command ? '{{header}}' : (notes ? '\\noindent\\textbf{ {{title}} }\\par\n\\noindent{{level}} · {{subject}}\\par\\medskip' : '')
  const previous = wrapper(source, 'previo') ?? `\\begin{document}${preview ? '\\begin{preview}' : ''}\n${header}`
  const final = wrapper(source, 'final') ?? `${preview ? '\\end{preview}' : ''}\\end{document}`
  const preamble = source.replace(/^\s*%\s*neope:(?:document|field)\s+\{.*\}\s*$/gm, '').replace(/^\s*%%%\s*(?:previo|final):[^\r\n]*$/gmi, '').trim()
  const codigo = [
    `% neope:document ${JSON.stringify(config)}`,
    ...fields.map((field) => `% neope:field ${JSON.stringify(field)}`), '', preamble, '',
    ...previous.split('\n').map((line) => `%%% previo: ${line}`),
    ...final.split('\n').map((line) => `%%% final: ${line}`), '',
  ].join('\n')
  return { ...template, codigo, migrated: codigo !== source }
}
export function templateHeader(metadata, valueFor) {
  const commands = new Map()
  for (const field of metadata.fields) {
    if (field.formOnly || !Number.isFinite(field.argument)) continue
    const command = field.command || metadata.command
    if (!command) continue
    const args = commands.get(command) || new Map()
    args.set(field.argument, valueFor(field))
    commands.set(command, args)
  }
  return [...commands].map(([command, args]) => `\\${command}${Array.from({ length: Math.max(...args.keys()) }, (_, index) => `{${args.get(index + 1) || ''}}`).join('')}`).join('\n')
}
export function renderTemplateWrapper(source, metadata, valueFor) {
  const values = new Map(metadata.fields.map((field) => [field.key, valueFor(field)]))
  return source.replace(/\{\{([\w]+)\}\}/g, (_, key) => key === 'header' ? templateHeader(metadata, valueFor) : String(values.get(canonicalFieldKey(key)) ?? ''))
}

export function appendShortAnswers(body, { enabled = false, supported = false, after = '' } = {}) {
  if (!supported) return body
  const source = String(body || '')
  const executable = executableLatex(source)
  const documentStart = /\\begin\s*\{document\}/.exec(executable)
  const offset = documentStart ? documentStart.index + documentStart[0].length : 0
  const tokens = [...executable.matchAll(/\\(begin|end)\s*\{ejercicios\}|\\soluciones\b/g)].filter((token) => token.index >= offset)
  const stack = []
  const environments = []
  const solutions = []
  for (const token of tokens) {
    if (token[1] === 'begin') stack.push(token)
    else if (token[1] === 'end') {
      const begin = stack.pop()
      if (begin) environments.push({ begin: begin.index, end: token.index, endAfter: token.index + token[0].length })
    } else solutions.push(token)
  }
  if (!environments.length) return source
  if (solutions.some((token) => environments.some((env) => token.index > env.begin && token.index < env.end))) return source
  const environment = environments.reduce((latest, env) => env.end > latest.end ? env : latest)
  const outside = solutions.find((token) => {
    if (token.index < environment.endAfter) return false
    const between = executable.slice(environment.endAfter, token.index)
    const linePrefix = executable.slice(executable.lastIndexOf('\n', token.index) + 1, token.index)
    return /^\s*(?:\\(?:columnbreak|newcolumn)\s*)?$/.test(between) || /^\s*$/.test(linePrefix)
  })
  if (!outside && /\\soluciones\b/.test(executableLatex(String(after)))) return source
  if (!outside && !enabled) return source
  let cleaned = source
  let columnBreak = ''
  if (outside) {
    let removeFrom = outside.index
    const between = executable.slice(environment.endAfter, outside.index)
    const breakMatch = /^\s*(\\(?:columnbreak|newcolumn))\s*$/.exec(between)
    if (breakMatch) {
      columnBreak = `${breakMatch[1]}\n`
      removeFrom = environment.endAfter
    }
    cleaned = source.slice(0, removeFrom) + source.slice(outside.index + outside[0].length)
  }
  return `${cleaned.slice(0, environment.end)}\n${columnBreak}\\soluciones\n${cleaned.slice(environment.end)}`
}

// Old documents keep a snapshot of their preamble. Add the TikZ compatibility
// key to those snapshots too, without changing the exercise or its answer.
export function ensureTikzPaddingCompatibility(source) {
  const code = String(source || '')
  const executable = executableLatex(code)
  const begin = /\\begin\s*\{document\}/.exec(executable)
  if (!begin) return code
  const preamble = executable.slice(0, begin.index)
  const body = executable.slice(begin.index + begin[0].length)
  if (!/\\(?:tikzset|usetikzlibrary)\b|\\usepackage(?:\[[^\]]*\])?\s*\{[^}]*\btikz\b/.test(preamble)) return code
  if (/\bpadding\s*\/\.(?:style|code|style\s+args|code\s+args)\b/.test(preamble)) return code
  if (!/\[[^\]]*\bpadding\s*=/s.test(body)) return code
  return `${code.slice(0, begin.index)}\\tikzset{padding/.style={inner sep=#1}}\n${code.slice(begin.index)}`
}

// Babel's Spanish angle-bracket shortcuts break TikZ arrows when an answer is
// read now but expanded later by the legacy collection's \soluciones macro.
export function ensureShortAnswerTikzCompatibility(source) {
  const code = String(source || '')
  const executable = executableLatex(code)
  const begin = /\\begin\s*\{document\}/.exec(executable)
  if (!begin) return code
  const preamble = executable.slice(0, begin.index)
  const body = executable.slice(begin.index + begin[0].length)
  if (/\\neopeReadLsol\b/.test(preamble) || !/\\g@addto@macro/.test(preamble)) return code
  if (!/\\def\s*\\sol\s*#1/.test(preamble) || !/\\def\s*\\lsol\s*#1/.test(preamble)) return code
  if (!/\\(?:sol|lsol|esol|csol)\s*\{/.test(body) || !/\\(?:tikz\b|begin\s*\{tikzpicture\})/.test(body) || !/(?:->|<-|>=|<=)/.test(body)) return code
  const fix = String.raw`\ifdefined\shorthandoff
\let\neopeOriginalSol\sol
\def\sol{\begingroup\shorthandoff{<>}\neopeReadSol}
\long\def\neopeReadSol#1{\neopeOriginalSol{#1}\endgroup}
\let\neopeOriginalLsol\lsol
\def\lsol{\begingroup\shorthandoff{<>}\neopeReadLsol}
\long\def\neopeReadLsol#1{\neopeOriginalLsol{#1}\endgroup}
\ifdefined\csol
\let\neopeOriginalCsol\csol
\def\csol{\begingroup\shorthandoff{<>}\neopeReadCsol}
\long\def\neopeReadCsol#1{\neopeOriginalCsol{#1}\endgroup}
\fi
\ifdefined\esol
\let\neopeOriginalEsol\esol
\def\esol{\begingroup\shorthandoff{<>}\neopeReadEsol}
\long\def\neopeReadEsol#1{\neopeOriginalEsol{#1}\endgroup}
\fi
\fi
`
  return `${code.slice(0, begin.index)}${fix}${code.slice(begin.index)}`
}
export function splitFinalDocumentCode(code, fallbackPreamble = '') {
  const activeMatch = (match) => !/^\s*%/.test(code.slice(code.lastIndexOf('\n', match.index) + 1, match.index))
  const begin = [...code.matchAll(/\\begin\s*\{document\}/g)].find(activeMatch)
  const end = [...code.matchAll(/\\end\s*\{document\}/g)].filter(activeMatch).at(-1)
  if (!begin || !end || end.index < begin.index) throw new Error('El código final debe contener \\begin{document} y \\end{document}.')
  const preamble = code.slice(0, begin.index).replace(/^\s*\\input\s*\{[^}]+\}\s*$/gm, '').trim()
  const usesExternalPreamble = /^\s*\\input\s*\{[^}]+\}/m.test(code.slice(0, begin.index))
  return { preamble: usesExternalPreamble ? `${fallbackPreamble}\n${preamble}` : preamble, body: code.slice(begin.index + begin[0].length, end.index).trim() }
}
