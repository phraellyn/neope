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
export function splitFinalDocumentCode(code, fallbackPreamble = '') {
  const activeMatch = (match) => !/^\s*%/.test(code.slice(code.lastIndexOf('\n', match.index) + 1, match.index))
  const begin = [...code.matchAll(/\\begin\s*\{document\}/g)].find(activeMatch)
  const end = [...code.matchAll(/\\end\s*\{document\}/g)].filter(activeMatch).at(-1)
  if (!begin || !end || end.index < begin.index) throw new Error('El código final debe contener \\begin{document} y \\end{document}.')
  const preamble = code.slice(0, begin.index).replace(/^\s*\\input\s*\{[^}]+\}\s*$/gm, '').trim()
  const usesExternalPreamble = /^\s*\\input\s*\{[^}]+\}/m.test(code.slice(0, begin.index))
  return { preamble: usesExternalPreamble ? `${fallbackPreamble}\n${preamble}` : preamble, body: code.slice(begin.index + begin[0].length, end.index).trim() }
}
