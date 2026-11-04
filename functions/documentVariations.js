import { HttpsError } from 'firebase-functions/v2/https'
import { buildExerciseLatex } from './exerciseCompilation.js'
import { planDocumentVariation, uniqueConceptIds } from './documentVariationPlan.js'
import { graphicReferences } from './exerciseVisualsShared.js'
import { visualReferenceImages, visualMessageContent, visualModelCatalog } from './visualGeneration.js'
import { ensureAlignedInDisplayMath, normalizeDisplayMathDelimiters, normalizeLatexTextAccents } from './solutionLayout.js'

const clean = (value, length = 60000) => typeof value === 'string' ? value.trim().slice(0, length) : ''
const ids = (value) => uniqueConceptIds(value).slice(0, 240)
const schema = (name, properties, required = Object.keys(properties)) => ({ type: 'json_schema', json_schema: { name, strict: true, schema: { type: 'object', properties, required, additionalProperties: false } } })
const stringList = { type: 'array', items: { type: 'string' } }

// Column breaks are layout instructions, so keep their environment and part
// position from the original even when the model rewrites the exercise text.
export function columnBreakSignature(code) {
  const source = String(code || '').replace(/(^|[^\\])(?:\\\\)*%[^\r\n]*/g, (match) => ' '.repeat(match.length))
  const stack = []
  let part = 0
  const signature = []
  for (const match of source.matchAll(/\\(?:begin|end)\s*\{[^}]+\}|\\(?:ap|newcolumn|columnbreak)\b/g)) {
    const environment = /^\\(begin|end)\s*\{([^}]+)\}/.exec(match[0])
    if (environment) {
      if (environment[1] === 'begin') stack.push(environment[2])
      else stack.pop()
    } else if (match[0] === '\\ap') part += 1
    else signature.push(`${match[0]}:${part}:${stack.join('/')}`)
  }
  return signature.join('|')
}

function exerciseConcepts(exercise) {
  return ids([...(exercise.curriculum?.conceptIds || []), ...(exercise.contenidos || []), ...(exercise.contentIds || []), ...(exercise.parts || []).flatMap((part) => part.contenidos || part.contentIds || []), ...(exercise.structure?.contenidos || [])])
}
function sourceLatex(exercise) {
  return clean(exercise.codigo || exercise.enunciado || exercise.latex)
    || (exercise.statement ? buildExerciseLatex(exercise, { includeSolutions: true, includeAnswers: true, includeCriteria: true }) : '')
}
function catalogFrom(data) {
  return (Array.isArray(data.concepts) ? data.concepts : []).slice(0, 1000).map((node) => ({ id: clean(node.id, 180), title: clean(node.title, 300), path: clean(node.path, 1000), parentId: clean(node.parentId, 180) })).filter((node) => node.id)
}

export function documentVariationHandlers({ db, resolveModel, apiKey, requestModel, choiceContent, validateVariation }) {
  return {
    async plan(request) {
      const data = request.data || {}
      const model = await resolveModel(request, data.model)
      const mode = data.mode === 'variant' ? 'variant' : 'cloned'
      const slots = (Array.isArray(data.slots) ? data.slots : []).map((slot) => ({
        slotId: clean(slot.slotId, 180), sourceExerciseId: clean(slot.sourceExerciseId, 180),
        latex: clean(slot.latex), conceptIds: ids(slot.conceptIds), partCount: Math.max(0, Number(slot.partCount) || 0),
      }))
      if (!slots.length || slots.length > 40 || slots.some((slot) => !slot.slotId || !slot.latex) || new Set(slots.map((slot) => slot.slotId)).size !== slots.length) throw new HttpsError('invalid-argument', 'El documento debe contener entre 1 y 40 ejercicios identificados.')
      const concepts = catalogFrom(data)
      let conceptIds = ids(data.conceptIds)
      if (mode === 'variant' && !conceptIds.length && !slots.some((slot) => slot.conceptIds.length)) {
        if (!concepts.length) throw new HttpsError('failed-precondition', 'Selecciona la asignatura para identificar el mapa de conceptos del documento.')
        const { payload } = await requestModel({ model: model.id, modelLabel: model.label, deadlineAt: Date.now() + 150000, body: {
          model: model.id, messages: [
            { role: 'system', content: 'Identifica los contenidos matemáticos que evalúa cada ejercicio. Elige exclusivamente identificadores del catálogo y conserva todos los slotId. Usa los conceptos más específicos disponibles. No redactes ejercicios.' },
            { role: 'user', content: JSON.stringify({ slots, concepts, course: data.course, subjectId: data.subjectId }) },
          ], response_format: schema('document_concept_map', { slots: { type: 'array', items: { type: 'object', properties: { slotId: { type: 'string' }, conceptIds: stringList }, required: ['slotId', 'conceptIds'], additionalProperties: false } } }),
          max_tokens: 5000, provider: { require_parameters: true, data_collection: 'deny' },
        } })
        const mapped = JSON.parse(choiceContent(payload.choices?.[0]) || '{}')
        const allowed = new Set(concepts.map((node) => node.id))
        slots.forEach((slot) => { slot.conceptIds = ids(mapped.slots?.find((entry) => entry.slotId === slot.slotId)?.conceptIds).filter((id) => allowed.has(id)) })
        conceptIds = ids(slots.flatMap((slot) => slot.conceptIds))
        if (!conceptIds.length) throw new HttpsError('internal', 'No se ha podido identificar el mapa de conceptos. Añade los contenidos al documento antes de generar la variante.')
      }
      let candidates = []
      if (mode === 'variant') {
        const subjectId = clean(data.subjectId, 180)
        if (!subjectId) throw new HttpsError('invalid-argument', 'Selecciona la asignatura para buscar ejercicios del banco.')
        // Query the entire subject bank rather than the browser's paginated cards.
        const bank = await db.collection('ejercicios').where('curriculum.subjectId', '==', subjectId).get()
        candidates = bank.docs.flatMap((document) => {
          const exercise = document.data()
          return [exercise, ...(exercise.variaciones || [])].flatMap((version, index) => {
            const code = sourceLatex(version)
            if (!code) return []
            return [{ exerciseId: document.id, version: index, variationId: index > 0 ? version.id || null : null,
              conceptIds: ids([...exerciseConcepts(exercise), ...exerciseConcepts(version)]),
              partCount: version.parts?.length || version.structure?.apartados?.length || (code.match(/\\ap\b/g) || []).length,
              label: clean(version.titulo || exercise.titulo || code.replace(/\\[A-Za-z]+(?:\{[^}]*\})?/g, ' ').replace(/\s+/g, ' '), 180) }]
          })
        })
      }
      const plan = planDocumentVariation({ mode, slots, candidates, conceptIds, excludedIds: ids(data.excludedIds), concepts })
      return { ...plan, inferredConcepts: !ids(data.conceptIds).length, candidateCount: candidates.length }
    },

    async generate(request) {
      const data = request.data || {}
      const model = await resolveModel(request, data.model)
      const contract = clean(data.latex)
      if (!contract || !/\\ej\b/.test(contract)) throw new HttpsError('invalid-argument', 'Falta la estructura del ejercicio original.')
      const requiredConceptIds = ids(data.requiredConceptIds)
      const contractCriteria = (Array.isArray(data.contractCriteria) ? data.contractCriteria : []).slice(0, 240).map((criterion) => ({ partId: clean(criterion.partId, 180), points: Number(criterion.points) || 0, description: clean(criterion.description, 2000) }))
      const concepts = catalogFrom(data)
      let reference = contract
      if (data.origin === 'bank') {
        const exerciseId = clean(data.exerciseId, 180)
        if (!exerciseId || exerciseId.includes('/')) throw new HttpsError('invalid-argument', 'Ejercicio de referencia no válido.')
        const stored = await db.doc(`ejercicios/${exerciseId}`).get()
        if (!stored.exists) throw new HttpsError('not-found', 'El ejercicio elegido ya no existe. Vuelve a planificar la variante.')
        const root = stored.data()
        const version = data.variationId ? root.variaciones?.find((entry) => entry.id === data.variationId)
          : Number(data.version) > 0 ? root.variaciones?.[Number(data.version) - 1] : root
        if (!version) throw new HttpsError('not-found', 'La variante elegida del banco ya no está disponible.')
        reference = sourceLatex(version)
      }
      const files = visualReferenceImages(data.referenceImages)
      if (files.length) {
        const known = (await visualModelCatalog(apiKey())).find((entry) => entry.id === model.id)
        if (!known?.inputModalities.includes('image') || !known.outputModalities.includes('text')) throw new HttpsError('failed-precondition', 'Selecciona uno de tus modelos con comprensión de imágenes para variar este ejercicio.')
      }
      const task = data.origin === 'new' ? 'Diseña un ejercicio NUEVO que cubra todos los conceptos requeridos.'
        : data.origin === 'bank' ? 'Genera una variante nueva del EJERCICIO DEL BANCO, adaptándola a la estructura del puesto original del documento.'
          : 'Clona didácticamente el ejercicio original: crea una variante nueva de la misma dificultad y con las mismas destrezas, cambiando datos y contexto.'
      const prompt = { task, contract, reference: data.origin === 'new' ? '' : reference,
        course: clean(data.course, 80), subjectId: clean(data.subjectId, 180), requiredConceptIds,
        concepts: concepts.filter((node) => requiredConceptIds.includes(node.id)), contractCriteria, instructions: clean(data.instructions, 3000),
        previousProposals: (data.previousProposals || []).slice(-3).map((code) => clean(code, 20000)), latexCapabilities: data.latexCapabilities || {}, }
      prompt.criteriaInstruction = 'En criteria devuelve exactamente los criterios de contractCriteria, con los mismos partId y puntos, pero adaptando las descripciones al ejercicio nuevo. Si contractCriteria está vacío, criteria también debe estar vacío. En partConcepts indica los conceptos requeridos que evalúa cada apartado, usando sus identificadores % neope:part como partId. En las descripciones, escribe toda expresión matemática entre $...$. Conserva los espacios y las cajas para responder y una extensión comparable al original.'
      prompt.columnInstruction = 'No añadas, elimines ni desplaces los comandos \\newcolumn o \\columnbreak: conserva cada uno en el mismo apartado y dentro de los mismos entornos que en contract.'
      let generated
      let issues = []
      const deadlineAt = Date.now() + 245000
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { payload } = await requestModel({ model: model.id, modelLabel: model.label, deadlineAt, body: {
          model: model.id, reasoning: { effort: model.reasoningEffort, exclude: true },
          messages: [
            { role: 'system', content: `Eres un profesor de Matemáticas. Devuelve JSON con enunciado (un ejercicio Neope completo) y coveredConceptIds. El contract fija la ESTRUCTURA, no los datos que debes copiar. Conserva exactamente un \\ej, el número y orden de apartados, su entorno apartados/apartadosc, los identificadores % neope:part y TODOS los valores literales de \\M, \\P, \\p, \\T y \\t. No añadas ni elimines apartados, instrucciones estructurales, saltos de página o entornos exteriores del documento. Recalcula las respuestas y soluciones, con el mismo número de entornos solucion y comandos sol/lsol que el original; adapta también los criterios a los nuevos datos conservando sus puntuaciones. Conserva \\info exactamente cuando exista. No devuelvas preámbulo ni begin/end document o ejercicios. No copies las propuestas previas. Usa UTF-8 y matemáticas destacadas $$...$$; aligned siempre dentro de matemáticas y sin líneas vacías. Comprueba que las premisas sean ciertas y la solución sea coherente con el enunciado nuevo. Cubre TODOS los conceptos requeridos y enuméralos en coveredConceptIds. Las imágenes relevantes deben redibujarse en TikZ estándar compatible con latexCapabilities; no uses includegraphics ni nombres de archivos externos. El contenido fuera de los ejercicios lo mantiene Neope.` },
            { role: 'user', content: visualMessageContent(JSON.stringify({ ...prompt, ...(issues.length ? { invalidDraft: generated, repairIssues: issues } : {}) }), files) },
          ], response_format: schema('document_exercise_variation', {
            enunciado: { type: 'string' }, coveredConceptIds: stringList,
            criteria: { type: 'array', items: { type: 'object', properties: { partId: { type: 'string' }, description: { type: 'string' }, points: { type: 'number' } }, required: ['partId', 'description', 'points'], additionalProperties: false } },
            partConcepts: { type: 'array', items: { type: 'object', properties: { partId: { type: 'string' }, conceptIds: stringList }, required: ['partId', 'conceptIds'], additionalProperties: false } },
          }),
          max_tokens: 14000, provider: { require_parameters: true, data_collection: 'deny' },
        } })
        generated = JSON.parse(choiceContent(payload.choices?.[0]) || '{}')
        generated.enunciado = normalizeLatexTextAccents(ensureAlignedInDisplayMath(normalizeDisplayMathDelimiters(clean(generated.enunciado))))
        issues = validateVariation(contract, generated.enunciado)
        if (columnBreakSignature(contract) !== columnBreakSignature(generated.enunciado)) issues.push('Conserva los saltos \\newcolumn y \\columnbreak en los mismos apartados y entornos que el ejercicio original; elimina los que hayas añadido.')
        const count = (code, expression) => (code.match(expression) || []).length
        for (const expression of [/\\ej\b/g, /\\ap\b/g, /\\(?:begin|end)\s*\{apartadosc?\}/g, /\\begin\s*\{solucion\}/g, /\\(?:lsol|sol|esol|info|criterios)\s*\{/g, /\\(?:salto|newpage|clearpage)\b/g]) {
          if (count(contract, expression) !== count(generated.enunciado, expression)) issues.push(`Se ha alterado la estructura requerida: ${expression.source}.`)
        }
        if (graphicReferences(generated.enunciado).length || /\\(?:begin|end)\s*\{(?:document|ejercicios)\}|\\documentclass\b/.test(generated.enunciado)) issues.push('Devuelve solo un ejercicio, con las figuras en TikZ y sin entornos exteriores.')
        if (generated.enunciado === contract || (data.previousProposals || []).includes(generated.enunciado)) issues.push('Genera una variante distinta de las anteriores.')
        if (requiredConceptIds.some((id) => !generated.coveredConceptIds?.includes(id))) issues.push('Faltan conceptos requeridos en el ejercicio generado.')
        const criterionSignature = (values) => values.map((criterion) => `${criterion.partId}:${Number(criterion.points) || 0}`).sort().join('|')
        if (criterionSignature(contractCriteria) !== criterionSignature(generated.criteria || []) || (generated.criteria || []).some((criterion) => !clean(criterion.description))) issues.push('Conserva en criteria todos los segmentos, el número de criterios y sus puntuaciones de contractCriteria; adapta sus descripciones al ejercicio nuevo.')
        if (!issues.length) break
      }
      if (issues.length) throw new HttpsError('internal', `La propuesta no respeta el documento: ${issues[0]}`)
      return { enunciado: generated.enunciado, coveredConceptIds: requiredConceptIds, criteria: generated.criteria || [],
        partConcepts: (generated.partConcepts || []).map((part) => ({ partId: clean(part.partId, 180), conceptIds: ids(part.conceptIds).filter((id) => requiredConceptIds.includes(id)) })), model: model.id, origin: data.origin || 'cloned' }
    },
  }
}
