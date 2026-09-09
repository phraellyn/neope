const modelLabels = Object.freeze({
  'google/gemini-3-flash-preview': 'Gemini 3 Flash',
  'google/gemini-3.7-flash': 'Gemini 3.7 Flash',
  'google/gemini-3.8-flash': 'Gemini 3.8 Flash',
  'openai/gpt-5-mini': 'GPT-5 Mini',
  'openai/gpt-5.6-luna': 'GPT-5.6 Luna',
  'openai/gpt-5.6-terra': 'GPT-5.6 Terra',
  'openai/gpt-5.6-sol': 'GPT-5.6 Sol',
  'openai/gpt-6-astra': 'GPT-6 Astra',
  'anthropic/claude-fable-5.1': 'Claude Fable 5.1',
  'moonshotai/kimi-k3': 'Kimi K3',
})

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function exerciseVersion(exercise, versionIndex = 0) {
  if (!exercise) return null
  return versionIndex > 0 ? exercise.variaciones?.[versionIndex - 1] || exercise : exercise
}

export function exerciseStatementText(exercise = {}) {
  const structure = exercise.structure || exercise
  const parts = structure.parts || structure.apartados || []
  return [
    text(structure.statement?.latex || structure.enunciado),
    ...parts.map((part) => text(part.statement?.latex || part.enunciado)),
  ].filter(Boolean).join('\n')
}

export function exerciseModelLabel(model = '') {
  const value = text(model)
  if (!value) return ''
  if (modelLabels[value]) return modelLabels[value]
  return value.split('/').at(-1).replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function generatedAuthorFromInfo(info = '') {
  const match = text(info).match(/^(?:Generado por|Variaci[oó]n experimental\s*--?)\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function versionInfo(version = {}) {
  return text(version.info || version.structure?.info)
}

export function versionHasWorkedSolution(version = {}) {
  if (text(version.enunciado || version.codigo || version.latex).match(/\\begin\s*\{solucion\}/)) return true
  if (text(version.workedSolution?.latex || version.structure?.solucion)) return true
  const parts = version.parts || version.structure?.apartados || []
  return parts.some((part) => text(part.workedSolution?.latex || part.solucion))
}

export function exerciseVersionAuthors(exercise, versionIndex = 0, humanAuthor = 'Carlos Sánchez Catalá') {
  const version = exerciseVersion(exercise, versionIndex) || {}
  const generatedAuthor = generatedAuthorFromInfo(versionInfo(version))
  const modelAuthor = exerciseModelLabel(version.modelo)
  const isVariation = versionIndex > 0
  const statement = isVariation ? modelAuthor || generatedAuthor || 'IA' : generatedAuthor || humanAuthor

  let solution = 'Sin resolver'
  if (versionHasWorkedSolution(version)) {
    solution = isVariation || version.solucionIA || generatedAuthor
      ? modelAuthor || generatedAuthor || 'IA'
      : humanAuthor
  }
  return { statement, solution }
}

function conceptAncestors(conceptId, nodesById) {
  const ids = []
  let current = nodesById.get(conceptId)
  while (current) {
    ids.push(current.id)
    current = current.parentId ? nodesById.get(current.parentId) : null
  }
  return ids
}

export function compactExerciseConceptLabel(conceptIds = [], nodes = []) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const selected = [...new Set(conceptIds)].filter((id) => nodesById.has(id) && id !== 'matematicas')
  const terminal = selected.filter((id) => !selected.some((otherId) => (
    otherId !== id && conceptAncestors(otherId, nodesById).includes(id)
  )))
  const paths = terminal.map((id) => {
    const titles = []
    let current = nodesById.get(id)
    while (current && current.id !== 'matematicas') {
      titles.unshift(current.title)
      current = current.parentId ? nodesById.get(current.parentId) : null
    }
    if (titles.length < 2) return titles[0] || ''
    return `${titles[0]} · ${titles.at(-1)}`
  }).filter(Boolean)
  return paths.join(' / ') || 'Sin conceptos'
}
