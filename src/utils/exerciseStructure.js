const PART_MARKER_PATTERN = /%\s*neope:part\s+id=([A-Za-z0-9_-]+)/i

function text(value) {
  return typeof value === 'string' ? value : ''
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))]
}

function normalizeEvidenceStrength(value) {
  return ['weak', 'medium', 'strong'].includes(value) ? value : null
}

export function normalizeExerciseAchievements(achievements = []) {
  return (Array.isArray(achievements) ? achievements : [])
    .filter((achievement) => achievement && typeof achievement === 'object')
    .map((achievement) => {
      const alignment = achievement.alignment || {}
      const descriptorEvidence = (Array.isArray(alignment.descriptorEvidence) ? alignment.descriptorEvidence : [])
        .map((evidence) => ({
          descriptorId: text(evidence?.descriptorId).trim(),
          strength: normalizeEvidenceStrength(evidence?.strength),
        }))
        .filter((evidence) => evidence.descriptorId && evidence.strength)
        .filter((evidence, index, values) => values.findIndex((candidate) => candidate.descriptorId === evidence.descriptorId) === index)
      return {
        id: text(achievement.id).trim() || createExercisePartId(),
        description: text(achievement.description).trim(),
        points: Math.max(0, number(achievement.points)),
        alignment: {
          criterionIds: unique(alignment.criterionIds),
          descriptorEvidence,
          source: alignment.source === 'ai' ? 'ai' : 'manual',
          ...(text(alignment.model).trim() ? { model: text(alignment.model).trim() } : {}),
        },
      }
    })
}

function numberText(value) {
  const parsed = number(value)
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace('.', ',')
}

export function createExercisePartId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(8)
  globalThis.crypto?.getRandomValues?.(bytes)
  let result = ''
  for (let index = 0; index < 8; index += 1) {
    const fallback = Math.floor(Math.random() * alphabet.length)
    result += alphabet[(bytes[index] || fallback) % alphabet.length]
  }
  return result
}

function escaped(source, index) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function skipComment(source, index) {
  const newline = source.indexOf('\n', index)
  return newline === -1 ? source.length : newline + 1
}

function skipSpaces(source, index) {
  let cursor = index
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
  return cursor
}

function readControlSequence(source, index) {
  if (source[index] !== '\\') return null
  const word = source.slice(index + 1).match(/^([A-Za-z@]+\*?)/)?.[1]
  if (word) return { name: word, start: index, end: index + 1 + word.length }
  return source[index + 1]
    ? { name: source[index + 1], start: index, end: index + 2 }
    : null
}

function readBalanced(source, openingIndex, opening = '{', closing = '}') {
  if (source[openingIndex] !== opening) return null
  let depth = 0
  for (let cursor = openingIndex; cursor < source.length; cursor += 1) {
    if (source[cursor] === '%' && !escaped(source, cursor)) {
      cursor = skipComment(source, cursor) - 1
      continue
    }
    if (escaped(source, cursor)) continue
    if (source[cursor] === opening) depth += 1
    if (source[cursor] === closing) depth -= 1
    if (depth === 0) {
      return {
        start: openingIndex,
        end: cursor + 1,
        content: source.slice(openingIndex + 1, cursor),
      }
    }
  }
  return null
}

function readCommandArgument(source, commandEnd) {
  const opening = skipSpaces(source, commandEnd)
  return readBalanced(source, opening)
}

function environmentToken(source, index) {
  const command = readControlSequence(source, index)
  if (!command || !['begin', 'end'].includes(command.name)) return null
  const argument = readCommandArgument(source, command.end)
  if (!argument) return null
  return {
    type: command.name,
    name: argument.content.trim(),
    start: index,
    end: argument.end,
  }
}

function topLevelCommands(source, names) {
  const accepted = new Set(names)
  const result = []
  const environments = []
  let braceDepth = 0
  for (let cursor = 0; cursor < source.length;) {
    const character = source[cursor]
    if (character === '%' && !escaped(source, cursor)) {
      cursor = skipComment(source, cursor)
      continue
    }
    if (character === '{' && !escaped(source, cursor)) {
      braceDepth += 1
      cursor += 1
      continue
    }
    if (character === '}' && !escaped(source, cursor)) {
      braceDepth = Math.max(0, braceDepth - 1)
      cursor += 1
      continue
    }
    if (character !== '\\' || escaped(source, cursor)) {
      cursor += 1
      continue
    }
    const environment = environmentToken(source, cursor)
    if (environment) {
      if (environment.type === 'begin') environments.push(environment.name)
      else if (environments.at(-1) === environment.name) environments.pop()
      cursor = environment.end
      continue
    }
    const command = readControlSequence(source, cursor)
    if (!command) {
      cursor += 1
      continue
    }
    if (braceDepth === 0 && environments.length === 0 && accepted.has(command.name)) {
      const argument = readCommandArgument(source, command.end)
      result.push({ ...command, argument, fullEnd: argument?.end || command.end })
    }
    cursor = command.end
  }
  return result
}

function findEnvironment(source, acceptedNames) {
  const accepted = new Set(acceptedNames)
  const stack = []
  for (let cursor = 0; cursor < source.length;) {
    if (source[cursor] === '%' && !escaped(source, cursor)) {
      cursor = skipComment(source, cursor)
      continue
    }
    if (source[cursor] !== '\\' || escaped(source, cursor)) {
      cursor += 1
      continue
    }
    const token = environmentToken(source, cursor)
    if (!token) {
      cursor += 1
      continue
    }
    if (token.type === 'begin') {
      stack.push(token)
    } else {
      const opening = stack.pop()
      if (opening?.name === token.name && stack.length === 0 && accepted.has(token.name)) {
        return {
          name: token.name,
          start: opening.start,
          contentStart: opening.end,
          contentEnd: token.start,
          end: token.end,
          content: source.slice(opening.end, token.start),
        }
      }
    }
    cursor = token.end
  }
  return null
}

function removeRanges(source, ranges) {
  let result = source
  ;[...ranges]
    .sort((left, right) => right.start - left.start)
    .forEach((range) => { result = `${result.slice(0, range.start)}${result.slice(range.end)}` })
  return result
}

function parseSegment(source) {
  let working = text(source).trim()
  const solutions = []
  while (true) {
    const solution = findEnvironment(working, ['solucion'])
    if (!solution) break
    solutions.push(solution.content.trim())
    working = removeRanges(working, [solution])
  }
  const answerCommands = topLevelCommands(working, ['lsol', 'sol', 'esol', 'csol'])
    .filter((command) => command.argument)
  const answers = answerCommands.map((command) => command.argument.content.trim()).filter(Boolean)
  working = removeRanges(working, answerCommands.map((command) => ({ start: command.start, end: command.fullEnd })))
  return {
    enunciado: working.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n').trim(),
    respuesta: answers.join('\n').trim(),
    solucion: solutions.join('\n\n').trim(),
  }
}

function stripLeadingExerciseCommand(source) {
  let working = text(source).trim()
  const exercise = working.match(/^\\ej\b/)
  if (exercise) working = working.slice(exercise[0].length).trimStart()
  let puntuacion = 0
  let tiempo = 0
  let consumed = true
  while (consumed) {
    consumed = false
    const command = working.match(/^\\([MPT])\s*/)
    if (!command) break
    const argument = readCommandArgument(working, command[0].length)
    if (!argument) break
    if (['M', 'P'].includes(command[1])) puntuacion = number(argument.content)
    if (command[1] === 'T') tiempo = number(argument.content)
    working = working.slice(argument.end).trimStart()
    consumed = true
  }
  working = working.replace(/^\\\\\s*/, '')
  return { working: working.trim(), puntuacion, tiempo }
}

function parsePart(source, markerId = '') {
  let working = text(source).trim()
  const marker = working.match(PART_MARKER_PATTERN)
  if (marker) working = working.replace(marker[0], '').trimStart()
  working = working.replace(/^\\ap\b/, '').trimStart()
  let puntuacion = 0
  let tiempo = 0
  let consumed = true
  while (consumed) {
    consumed = false
    const command = working.match(/^\\([pt])\s*/)
    if (!command) break
    const argument = readCommandArgument(working, command[0].length)
    if (!argument) break
    if (command[1] === 'p') puntuacion = number(argument.content)
    if (command[1] === 't') tiempo = number(argument.content)
    working = working.slice(argument.end).trimStart()
    consumed = true
  }
  return {
    id: markerId || marker?.[1] || createExercisePartId(),
    ...parseSegment(working),
    puntuacion,
    tiempo,
    achievements: [],
    contenidos: [],
    pdfenunciado: null,
    pdfsolucion: null,
  }
}

function partDescriptors(body) {
  const commands = topLevelCommands(body, ['ap'])
  return commands.map((command, index) => {
    const prefixStart = index === 0 ? 0 : commands[index - 1].start
    const prefix = body.slice(prefixStart, command.start)
    const marker = [...prefix.matchAll(new RegExp(PART_MARKER_PATTERN.source, 'gi'))].at(-1)
    return {
      start: marker ? command.start - (prefix.length - (marker.index || 0)) : command.start,
      commandStart: command.start,
      id: marker?.[1] || '',
    }
  })
}

function extractInfo(source) {
  const commands = topLevelCommands(source, ['info']).filter((command) => command.argument)
  const command = commands.at(-1)
  if (!command) return { source: text(source), info: '' }
  return {
    source: removeRanges(source, [{ start: command.start, end: command.fullEnd }]).trim(),
    info: command.argument.content.trim(),
  }
}

export function parseExerciseLatex(value = '') {
  const infoResult = extractInfo(text(value))
  const leading = stripLeadingExerciseCommand(infoResult.source)
  const partsEnvironment = findEnvironment(leading.working, ['apartados', 'apartadosc'])
  const mainSource = partsEnvironment ? leading.working.slice(0, partsEnvironment.start) : leading.working
  const final = partsEnvironment ? leading.working.slice(partsEnvironment.end).trim() : ''
  const main = parseSegment(mainSource)
  const descriptors = partsEnvironment ? partDescriptors(partsEnvironment.content) : []
  const apartados = descriptors.map((descriptor, index) => {
    const end = descriptors[index + 1]?.start ?? partsEnvironment.content.length
    return parsePart(partsEnvironment.content.slice(descriptor.start, end), descriptor.id)
  })
  return {
    ...main,
    puntuacion: leading.puntuacion,
    tiempo: leading.tiempo,
    apartados,
    apartadosEnv: partsEnvironment?.name || null,
    partsEnvironment: partsEnvironment?.name || null,
    final,
    info: infoResult.info,
    achievements: [],
    contenidosGenerales: [],
    contenidos: [],
    pdfenunciado: null,
    pdfsolucion: null,
    pdfenunciadocompleto: null,
    pdfsolucioncompleto: null,
    _hasPartMarkers: descriptors.length > 0 && descriptors.every((descriptor) => Boolean(descriptor.id)),
    _partMarkerIds: descriptors.map((descriptor) => descriptor.id).filter(Boolean),
  }
}

export function pdfReference(value) {
  if (!value) return null
  if (typeof value === 'string') return { downloadUrl: value }
  if (typeof value !== 'object') return null
  const storagePath = text(value.storagePath || value.path)
  const downloadUrl = text(value.downloadUrl || value.url)
  if (!storagePath && !downloadUrl) return null
  const width = number(value.width || value.pageWidth)
  const height = number(value.height || value.pageHeight)
  const aspectRatio = number(value.aspectRatio || value.pageAspectRatio)
    || (width > 0 && height > 0 ? width / height : 0)
  return {
    ...(storagePath ? { storagePath } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(value.sourceHash ? { sourceHash: value.sourceHash } : {}),
    ...(Number(value.revision) ? { revision: Number(value.revision) } : {}),
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(aspectRatio > 0 ? { aspectRatio } : {}),
  }
}

export function pdfReferenceUrl(value) {
  if (typeof value === 'string') return value
  return text(value?.downloadUrl || value?.url)
}

export function pdfReferenceAspectRatio(value) {
  if (!value || typeof value !== 'object') return 0
  const ratio = number(value.aspectRatio || value.pageAspectRatio)
  if (ratio > 0) return ratio
  const width = number(value.width || value.pageWidth)
  const height = number(value.height || value.pageHeight)
  return width > 0 && height > 0 ? width / height : 0
}

function modernBlock(block) {
  if (!block || typeof block !== 'object') return { latex: '', pdf: null }
  return { latex: text(block.latex), pdf: pdfReference(block.pdf) }
}

export function exerciseStructureFromDocument(document = {}) {
  const statement = modernBlock(document.statement)
  const answer = modernBlock(document.answer)
  const workedSolution = modernBlock(document.workedSolution)
  return {
    enunciado: statement.latex,
    respuesta: answer.latex,
    solucion: workedSolution.latex,
    puntuacion: number(document.points),
    tiempo: number(document.durationMinutes),
    apartadosEnv: document.partsEnvironment || null,
    partsEnvironment: document.partsEnvironment || null,
    apartados: (Array.isArray(document.parts) ? document.parts : []).map((part) => {
      const partStatement = modernBlock(part.statement)
      const partAnswer = modernBlock(part.answer)
      const partSolution = modernBlock(part.workedSolution)
      return {
        id: part.id || createExercisePartId(),
        enunciado: partStatement.latex,
        respuesta: partAnswer.latex,
        solucion: partSolution.latex,
        puntuacion: number(part.points),
        tiempo: number(part.durationMinutes),
        achievements: normalizeExerciseAchievements(part.achievements),
        contenidos: unique(part.contenidos || part.contentIds),
        pdfenunciado: pdfReferenceUrl(partStatement.pdf),
        pdfsolucion: pdfReferenceUrl(partSolution.pdf),
      }
    }),
    final: text(document.final),
    info: text(document.info),
    achievements: normalizeExerciseAchievements(document.achievements),
    contenidosGenerales: unique(document.contenidosGenerales || document.generalContentIds),
    contenidos: unique(document.contenidos || document.contentIds),
    pdfenunciado: pdfReferenceUrl(statement.pdf),
    pdfsolucion: pdfReferenceUrl(workedSolution.pdf),
    pdfenunciadocompleto: pdfReferenceUrl(document.pdf?.statement || document.pdf?.enunciado),
    pdfsolucioncompleto: pdfReferenceUrl(document.pdf?.solved || document.pdf?.resuelto),
    _hasPartMarkers: true,
    _partMarkerIds: (document.parts || []).map((part) => part.id).filter(Boolean),
  }
}

function previousStructure(previous = {}) {
  return Number(previous.schemaVersion) >= 3 && previous.statement
    ? exerciseStructureFromDocument(previous)
    : previous?.structure || previous || {}
}

function mergePart(parsed, previous = {}, keepPreviousId = false) {
  return {
    ...previous,
    ...parsed,
    id: keepPreviousId ? previous.id : (parsed.id || previous.id || createExercisePartId()),
    achievements: normalizeExerciseAchievements(parsed.achievements?.length ? parsed.achievements : previous.achievements),
    contenidos: unique(parsed.contenidos?.length ? parsed.contenidos : previous.contenidos),
    pdfenunciado: parsed.pdfenunciado || previous.pdfenunciado || null,
    pdfsolucion: parsed.pdfsolucion || previous.pdfsolucion || null,
  }
}

export function mergeExerciseStructure(parsedValue = {}, previousValue = {}) {
  const parsed = parsedValue || parseExerciseLatex('')
  const previous = previousStructure(previousValue)
  const previousParts = Array.isArray(previous.apartados) ? previous.apartados : []
  const byId = new Map(previousParts.filter((part) => part.id).map((part) => [part.id, part]))
  const allowPositionFallback = !parsed._hasPartMarkers
  const apartados = (parsed.apartados || []).map((part, index) => {
    const matchedById = byId.get(part.id)
    const matchedByPosition = allowPositionFallback ? previousParts[index] : null
    const matched = matchedById || matchedByPosition || {}
    return mergePart(part, matched, Boolean(matchedByPosition && !matchedById))
  })
  return aggregateExerciseStructure({
    ...previous,
    ...parsed,
    apartados,
    apartadosEnv: parsed.apartadosEnv || parsed.partsEnvironment || null,
    partsEnvironment: parsed.apartadosEnv || parsed.partsEnvironment || null,
    achievements: normalizeExerciseAchievements(parsed.achievements?.length ? parsed.achievements : previous.achievements),
    contenidosGenerales: unique(parsed.contenidosGenerales?.length ? parsed.contenidosGenerales : previous.contenidosGenerales),
    contenidos: unique(parsed.contenidos?.length ? parsed.contenidos : previous.contenidos),
    pdfenunciado: parsed.pdfenunciado || previous.pdfenunciado || null,
    pdfsolucion: parsed.pdfsolucion || previous.pdfsolucion || null,
    pdfenunciadocompleto: parsed.pdfenunciadocompleto || previous.pdfenunciadocompleto || previous.pdf?.enunciado || null,
    pdfsolucioncompleto: parsed.pdfsolucioncompleto || previous.pdfsolucioncompleto || previous.pdf?.resuelto || null,
  })
}

export function aggregateExerciseStructure(value = {}) {
  const structure = { ...value }
  structure.apartados = Array.isArray(value.apartados) ? value.apartados.map((part) => ({ ...part })) : []
  structure.achievements = normalizeExerciseAchievements(value.achievements)
  structure.contenidosGenerales = unique(value.contenidosGenerales)
  structure.apartados.forEach((part) => {
    part.achievements = normalizeExerciseAchievements(part.achievements)
    part.contenidos = unique([...structure.contenidosGenerales, ...unique(part.contenidos)])
  })
  structure.contenidos = structure.apartados.length
    ? unique(structure.apartados.flatMap((part) => part.contenidos))
    : unique([...structure.contenidosGenerales, ...unique(value.contenidos)])
  if (structure.apartados.length) {
    structure.puntuacion = structure.apartados.reduce((sum, part) => sum + number(part.puntuacion), 0)
    structure.tiempo = structure.apartados.reduce((sum, part) => sum + number(part.tiempo), 0)
  } else {
    structure.puntuacion = number(structure.puntuacion)
    structure.tiempo = number(structure.tiempo)
  }
  return structure
}

function answerCommand(answer, index) {
  const value = text(answer).trim()
  return value ? `\\${index === 0 ? 'lsol' : 'sol'}{${value}}` : ''
}

function solutionEnvironment(solution) {
  const value = text(solution).trim()
  return value ? `\\begin{solucion}\n${value}\n\\end{solucion}` : ''
}

function scoreCommand(command, value) {
  return number(value) > 0 ? `\\${command}{${numberText(value)}}` : ''
}

export function buildExerciseLatex(value = {}, options = {}) {
  const structure = aggregateExerciseStructure(value)
  const includeSolutions = options.includeSolutions !== false
  const includeAnswers = options.includeAnswers !== false
  const includeDurationMetadata = options.includeDurationMetadata !== false
  const preserveEnvironment = options.preserveApartadosEnvironment !== false && options.preservePartsEnvironment !== false
  const exerciseMetadata = [
    scoreCommand('M', structure.puntuacion),
    includeDurationMetadata ? scoreCommand('T', structure.tiempo) : '',
  ].filter(Boolean).join(' ')
  const firstLine = `\\ej${exerciseMetadata ? ` ${exerciseMetadata}\\\\` : ''}`
  const chunks = [firstLine]
  if (text(structure.enunciado).trim()) chunks.push(structure.enunciado.trim())
  if (!structure.apartados.length && includeAnswers && text(structure.respuesta).trim()) {
    chunks.push(answerCommand(structure.respuesta, 0))
  }
  if (includeSolutions && text(structure.solucion).trim()) chunks.push(solutionEnvironment(structure.solucion))
  if (structure.apartados.length) {
    const stored = structure.apartadosEnv === 'apartadosc' ? 'apartadosc' : 'apartados'
    const environment = includeSolutions && !preserveEnvironment ? 'apartados' : stored
    const parts = structure.apartados.map((part, index) => {
      const partMetadata = [
        scoreCommand('p', part.puntuacion),
        includeDurationMetadata ? scoreCommand('t', part.tiempo) : '',
      ].filter(Boolean).join(' ')
      return [
        `% neope:part id=${part.id || createExercisePartId()}`,
        `\\ap${partMetadata ? ` ${partMetadata}` : ''}${text(part.enunciado).trim() ? ` ${part.enunciado.trim()}` : ''}`,
        includeAnswers ? answerCommand(part.respuesta, index) : '',
        includeSolutions ? solutionEnvironment(part.solucion) : '',
      ].filter(Boolean).join('\n')
    })
    chunks.push(`\\begin{${environment}}\n${parts.join('\n\n')}\n\\end{${environment}}`)
  }
  if (text(structure.final).trim()) chunks.push(structure.final.trim())
  if (text(structure.info).trim()) chunks.push(`\\info{${structure.info.trim()}}`)
  return chunks.filter(Boolean).join('\n\n')
}

function centeredStatement(statement = '') {
  const value = text(statement).trim()
  if (!/^\\(?:tikz\b|begin\s*\{tikzpicture\}|includegraphics\b)/.test(value)) return value
  return `\\begin{center}\n${value}\n\\end{center}`
}

export function buildExercisePartLatex(value = {}, partReference = null, options = {}) {
  const structure = aggregateExerciseStructure(value)
  const includeSolutions = options.includeSolutions === true
  if (partReference === null || partReference === undefined) {
    return [
      centeredStatement(structure.enunciado),
      includeSolutions ? solutionEnvironment(structure.solucion) : '',
    ].filter(Boolean).join('\n\n')
  }
  const index = typeof partReference === 'number'
    ? partReference
    : structure.apartados.findIndex((part) => part.id === partReference)
  const part = structure.apartados[index]
  if (!part) return ''
  return [
    centeredStatement(part.enunciado),
    includeSolutions ? solutionEnvironment(part.solucion) : '',
  ].filter(Boolean).join('\n\n')
}

function structuredBlock(latex, pdf = null, required = false) {
  const value = text(latex).trim()
  if (!required && !value) return null
  return { latex: value, pdf: pdfReference(pdf) }
}

function persistedPdfReference(current, previous) {
  if (!current) return pdfReference(previous)
  if (typeof current === 'string' && current === pdfReferenceUrl(previous)) return pdfReference(previous)
  return pdfReference(current)
}

export function exerciseDocumentStructure(value = {}, previousDocument = {}, revision = 0) {
  const structure = aggregateExerciseStructure(value)
  const previous = Number(previousDocument.schemaVersion) >= 3
    ? previousDocument
    : { ...previousDocument, ...exerciseDocumentStructureFromLegacy(previousDocument) }
  const previousParts = new Map((previous.parts || []).map((part) => [part.id, part]))
  const hasSolutions = Boolean(text(structure.solucion).trim() || structure.apartados.some((part) => text(part.solucion).trim()))
  return {
    schemaVersion: 3,
    revision: number(revision),
    statement: structuredBlock(structure.enunciado, persistedPdfReference(structure.pdfenunciado, previous.statement?.pdf), true),
    answer: structuredBlock(structure.respuesta, previous.answer?.pdf),
    workedSolution: structuredBlock(structure.solucion, persistedPdfReference(structure.pdfsolucion, previous.workedSolution?.pdf)),
    points: number(structure.puntuacion),
    durationMinutes: number(structure.tiempo),
    achievements: normalizeExerciseAchievements(structure.achievements),
    partsEnvironment: structure.apartados.length ? (structure.apartadosEnv === 'apartadosc' ? 'apartadosc' : 'apartados') : null,
    parts: structure.apartados.map((part) => {
      const old = previousParts.get(part.id) || {}
      return {
        id: part.id || createExercisePartId(),
        statement: structuredBlock(part.enunciado, persistedPdfReference(part.pdfenunciado, old.statement?.pdf), true),
        answer: structuredBlock(part.respuesta, old.answer?.pdf),
        workedSolution: structuredBlock(part.solucion, persistedPdfReference(part.pdfsolucion, old.workedSolution?.pdf)),
        points: number(part.puntuacion),
        durationMinutes: number(part.tiempo),
        achievements: normalizeExerciseAchievements(part.achievements),
        contenidos: unique(part.contenidos),
      }
    }),
    pdf: {
      statement: persistedPdfReference(structure.pdfenunciadocompleto, previous.pdf?.statement || previous.pdf?.enunciado),
      solved: hasSolutions
        ? persistedPdfReference(structure.pdfsolucioncompleto, previous.pdf?.solved || previous.pdf?.resuelto)
        : null,
    },
    info: text(structure.info).trim(),
    final: text(structure.final).trim(),
    contenidosGenerales: unique(structure.contenidosGenerales),
    contenidos: unique(structure.contenidos),
  }
}

function exerciseDocumentStructureFromLegacy(previous = {}) {
  const legacy = previous.structure || previous
  return {
    statement: structuredBlock(legacy.enunciado, legacy.pdfenunciado, true),
    answer: structuredBlock(legacy.respuesta),
    workedSolution: structuredBlock(legacy.solucion, legacy.pdfsolucion),
    achievements: normalizeExerciseAchievements(legacy.achievements),
    parts: (legacy.apartados || []).map((part) => ({
      id: part.id,
      statement: structuredBlock(part.enunciado, part.pdfenunciado, true),
      answer: structuredBlock(part.respuesta),
      workedSolution: structuredBlock(part.solucion, part.pdfsolucion),
      achievements: normalizeExerciseAchievements(part.achievements),
    })),
    pdf: {
      statement: pdfReference(legacy.pdfenunciadocompleto || previous.pdf?.enunciado),
      solved: pdfReference(legacy.pdfsolucioncompleto || previous.pdf?.resuelto),
    },
  }
}

export function exercisePdfStoragePaths(document = {}) {
  const paths = new Set()
  const visit = (reference) => {
    const path = pdfReference(reference)?.storagePath
    if (path) paths.add(path)
  }
  visit(document.pdf?.statement)
  visit(document.pdf?.solved)
  visit(document.statement?.pdf)
  visit(document.answer?.pdf)
  visit(document.workedSolution?.pdf)
  for (const part of document.parts || []) {
    visit(part.statement?.pdf)
    visit(part.answer?.pdf)
    visit(part.workedSolution?.pdf)
  }
  return [...paths]
}

function balancedLatex(source) {
  const environmentStack = []
  let braceDepth = 0
  for (let cursor = 0; cursor < source.length;) {
    if (source[cursor] === '%' && !escaped(source, cursor)) {
      cursor = skipComment(source, cursor)
      continue
    }
    if (source[cursor] === '{' && !escaped(source, cursor)) braceDepth += 1
    if (source[cursor] === '}' && !escaped(source, cursor)) {
      braceDepth -= 1
      if (braceDepth < 0) return false
    }
    if (source[cursor] === '\\' && !escaped(source, cursor)) {
      const environment = environmentToken(source, cursor)
      if (environment) {
        if (environment.type === 'begin') environmentStack.push(environment.name)
        else if (environmentStack.pop() !== environment.name) return false
        cursor = environment.end
        continue
      }
    }
    cursor += 1
  }
  return braceDepth === 0 && environmentStack.length === 0
}

export function analyzeExerciseLatex(value = '', previousValue = {}) {
  const source = text(value)
  const valid = balancedLatex(source)
  if (!valid) return { structure: previousValue, valid: false, ambiguous: false }
  const structure = parseExerciseLatex(source)
  const markerIds = structure._partMarkerIds || []
  const duplicateMarkers = new Set(markerIds).size !== markerIds.length
  const previous = previousStructure(previousValue)
  const previousIds = (previous.apartados || []).map((part) => part.id).filter(Boolean)
  const markersRemoved = previousIds.length > 0 && structure.apartados.length > 0 && !structure._hasPartMarkers
  return {
    structure,
    valid: true,
    ambiguous: duplicateMarkers || markersRemoved,
  }
}
