export const DOCUMENT_CONTENT_SCHEMA_VERSION = 2

export const DOCUMENT_CONTENT_SOURCE_TYPES = Object.freeze({
  EXERCISE_BANK: 'exercise-bank',
  LATEX: 'latex',
  IMAGE: 'image',
  PDF: 'pdf',
  CURRICULUM: 'curriculum',
})

const sourceTypes = new Set(Object.values(DOCUMENT_CONTENT_SOURCE_TYPES))

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value) {
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.') : value)
  return Number.isFinite(parsed) ? parsed : 0
}

function positiveInteger(value, fallback = 1) {
  const parsed = Math.floor(finiteNumber(value))
  return parsed > 0 ? parsed : fallback
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function clonePlain(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function fallbackBlockId(block, index) {
  const reference = text(block.exerciseId || block.toolId).replace(/[^A-Za-z0-9_-]/g, '-') || 'block'
  return `${block.toolId ? 'tool' : 'exercise'}:${reference}:${index + 1}`
}

export function createDocumentBlockId(prefix = 'block') {
  const safePrefix = text(prefix).replace(/[^A-Za-z0-9_-]/g, '-') || 'block'
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${safePrefix}:${uuid}`
  return `${safePrefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return undefined
  return {
    puntuacion: Math.max(0, finiteNumber(metrics.puntuacion)),
    tiempo: Math.max(0, finiteNumber(metrics.tiempo)),
    apartados: (Array.isArray(metrics.apartados) ? metrics.apartados : []).map((part) => ({
      puntuacion: Math.max(0, finiteNumber(part?.puntuacion)),
      tiempo: Math.max(0, finiteNumber(part?.tiempo)),
    })),
  }
}

function normalizeExerciseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return undefined
  const cloned = clonePlain(snapshot, null)
  return cloned && typeof cloned === 'object' ? cloned : undefined
}

export function normalizeDocumentBlock(block, index = 0) {
  const input = plainObject(block)
  const blockId = text(input.blockId) || fallbackBlockId(input, index)

  if (text(input.toolId) || input.type === 'tool') {
    const toolId = text(input.toolId)
    if (!toolId) return null
    return {
      type: 'tool',
      blockId,
      toolId,
      args: clonePlain(plainObject(input.args), {}),
      section: input.section === 'optional' ? 'optional' : 'required',
    }
  }

  const exerciseId = text(input.exerciseId)
  if (!exerciseId) return null
  const metrics = normalizeMetrics(input.metrics)
  const snapshot = normalizeExerciseSnapshot(input.snapshot)
  return {
    type: 'exercise',
    blockId,
    exerciseId,
    version: Math.max(0, Math.floor(finiteNumber(input.version))),
    ...(input.pageBreakBefore ? { pageBreakBefore: true } : {}),
    ...(positiveInteger(input.sourcePage, 0) ? { sourcePage: positiveInteger(input.sourcePage, 1) } : {}),
    ...(metrics ? { metrics } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(input.generated ? { generated: true } : {}),
    section: input.section === 'optional' ? 'optional' : 'required',
  }
}

export function normalizeDocumentBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => normalizeDocumentBlock(block, index))
    .filter(Boolean)
}

function normalizeSource(source = {}) {
  const input = plainObject(source)
  const type = sourceTypes.has(input.type) ? input.type : DOCUMENT_CONTENT_SOURCE_TYPES.EXERCISE_BANK
  return {
    type,
    revision: positiveInteger(input.revision),
    ...(Object.keys(plainObject(input.options)).length ? { options: clonePlain(input.options, {}) } : {}),
  }
}

export function replaceDocumentContentSource(content, source, { touch = true } = {}) {
  const normalized = createDocumentContent(content)
  const nextSource = normalizeSource(source)
  return {
    ...normalized,
    source: {
      ...nextSource,
      revision: touch
        ? normalized.source.revision + 1
        : nextSource.revision,
    },
  }
}

export function createDocumentContent({ source, blocks, beforeExercisesLatex, afterExercisesLatex } = {}) {
  return {
    schemaVersion: DOCUMENT_CONTENT_SCHEMA_VERSION,
    source: normalizeSource(source),
    blocks: normalizeDocumentBlocks(blocks),
    beforeExercisesLatex: text(beforeExercisesLatex),
    afterExercisesLatex: text(afterExercisesLatex),
  }
}

export function replaceDocumentSurroundingLatex(content, { beforeExercisesLatex = '', afterExercisesLatex = '' } = {}) {
  const normalized = createDocumentContent(content)
  return {
    ...normalized,
    beforeExercisesLatex: text(beforeExercisesLatex),
    afterExercisesLatex: text(afterExercisesLatex),
  }
}

export function replaceDocumentContentBlocks(content, blocks, { touch = false } = {}) {
  const normalized = createDocumentContent(content)
  return {
    ...normalized,
    source: {
      ...normalized.source,
      revision: normalized.source.revision + (touch ? 1 : 0),
    },
    blocks: normalizeDocumentBlocks(blocks),
  }
}

export function touchDocumentContent(content) {
  const normalized = createDocumentContent(content)
  return {
    ...normalized,
    source: { ...normalized.source, revision: normalized.source.revision + 1 },
  }
}

export function createExerciseDocumentBlock(exerciseId, {
  version = 0,
  metrics,
  snapshot,
  generated = false,
  section = 'required',
  pageBreakBefore = false,
  sourcePage = 0,
} = {}) {
  return normalizeDocumentBlock({
    type: 'exercise',
    blockId: createDocumentBlockId('exercise'),
    exerciseId,
    version,
    metrics,
    snapshot,
    generated,
    section,
    pageBreakBefore,
    sourcePage,
  })
}

export function createToolDocumentBlock(toolId, { args = {}, section = 'required' } = {}) {
  return normalizeDocumentBlock({
    type: 'tool',
    blockId: createDocumentBlockId('tool'),
    toolId,
    args,
    section,
  })
}

export function documentContentFromRecord(record = {}) {
  const stored = plainObject(record.content || record.documentContent)
  const legacyBlocks = Array.isArray(record.bloques) ? record.bloques : record.ejercicios
  return createDocumentContent({
    source: Object.keys(stored).length
      ? stored.source
      : { type: DOCUMENT_CONTENT_SOURCE_TYPES.EXERCISE_BANK, revision: 1 },
    blocks: Array.isArray(stored.blocks) ? stored.blocks : legacyBlocks,
    beforeExercisesLatex: stored.beforeExercisesLatex,
    afterExercisesLatex: stored.afterExercisesLatex,
  })
}

export function serializeDocumentContent(content) {
  return clonePlain(createDocumentContent(content), createDocumentContent())
}
