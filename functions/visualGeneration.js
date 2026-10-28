import { HttpsError } from 'firebase-functions/v2/https'

let catalogCache = null
let catalogPromise = null
const text = (value, limit = 6000) => typeof value === 'string' ? value.trim().slice(0, limit) : ''

async function routerRequest(path, apiKey, { body, timeout = 30000 } = {}) {
  let response
  try {
    response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://neope.web.app', 'X-Title': 'Neope' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout),
    })
  } catch (error) {
    throw new HttpsError(error?.name === 'TimeoutError' ? 'deadline-exceeded' : 'unavailable', error?.name === 'TimeoutError' ? 'La generación visual ha tardado demasiado. Vuelve a intentarlo.' : 'No se ha podido conectar con el proveedor de imágenes.')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpsError('unavailable', text(payload.error?.message, 700) || `OpenRouter ha respondido con HTTP ${response.status}.`)
  return payload
}

export async function visualModelCatalog(apiKey) {
  if (catalogCache && Date.now() - catalogCache.time < 10 * 60_000) return catalogCache.models
  if (!catalogPromise) catalogPromise = (async () => {
    const [chat, image] = await Promise.all([
      routerRequest('models?output_modalities=all', apiKey),
      routerRequest('images/models', apiKey),
    ])
    const models = new Map()
    for (const entry of chat.data || []) models.set(entry.id, {
      id: entry.id, name: entry.name || entry.id,
      inputModalities: entry.architecture?.input_modalities || [],
      outputModalities: entry.architecture?.output_modalities || [],
      imageApi: false,
      imageReferences: Boolean(entry.architecture?.output_modalities?.includes('image') && entry.architecture?.input_modalities?.includes('image')),
      imageReferenceLimit: entry.architecture?.input_modalities?.includes('image') ? 4 : 0,
    })
    for (const entry of image.data || []) models.set(entry.id, {
      ...models.get(entry.id), id: entry.id, name: entry.name || entry.id,
      inputModalities: [...new Set([...(models.get(entry.id)?.inputModalities || []), ...(entry.architecture?.input_modalities || [])])],
      outputModalities: [...new Set([...(models.get(entry.id)?.outputModalities || []), ...(entry.architecture?.output_modalities || ['image'])])],
      imageApi: true, imageReferences: Boolean(entry.supported_parameters?.input_references),
      imageReferenceLimit: Number(entry.supported_parameters?.input_references?.max) || 0,
      rasterOutput: !entry.supported_parameters?.output_format?.values?.length
        || entry.supported_parameters.output_format.values.some((format) => ['png', 'jpeg', 'jpg', 'webp'].includes(format)),
      parameters: entry.supported_parameters || {},
    })
    catalogCache = { time: Date.now(), models: [...models.values()] }
    return catalogCache.models
  })().finally(() => { catalogPromise = null })
  return catalogPromise
}

export function visualReferenceImages(value) {
  const files = Array.isArray(value) ? value : []
  if (files.length > 4) throw new HttpsError('invalid-argument', 'Puedes enviar hasta cuatro imágenes de referencia.')
  let total = 0
  return files.map((file) => {
    const dataUrl = text(file?.dataUrl, 8_000_000)
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
    if (!match) throw new HttpsError('invalid-argument', 'Las referencias deben ser imágenes PNG, JPEG o WebP.')
    const size = Buffer.byteLength(match[2].replace(/[\r\n]/g, ''), 'base64')
    total += size
    if (size > 5_000_000 || total > 6_000_000) throw new HttpsError('invalid-argument', 'Las imágenes de referencia superan el tamaño permitido (6 MB en total).')
    return { name: text(file.name, 120), dataUrl }
  })
}

export function visualMessageContent(message, files) {
  if (!files.length) return message
  return [{ type: 'text', text: message }, ...files.flatMap((file) => [{ type: 'text', text: `Referencia visual: ${file.name || 'imagen'}` }, { type: 'image_url', image_url: { url: file.dataUrl } }])]
}

export async function prepareVisualVariation(data, model, apiKey) {
  if (!data.visualGeneration) return null
  const files = visualReferenceImages(data.referenceImages)
  const catalog = files.length ? await visualModelCatalog(apiKey) : []
  const selected = catalog.find((entry) => entry.id === model)
  if (selected && !selected.outputModalities.includes('text')) throw new HttpsError('failed-precondition', 'Elige un modelo que genere texto para redactar el ejercicio; el generador de imágenes se selecciona aparte.')
  if (files.length && !selected?.inputModalities.includes('image')) throw new HttpsError('failed-precondition', 'El modelo seleccionado no tiene comprensión de imágenes verificada. Selecciona un modelo con la etiqueta «Comprende imágenes».')
  const mode = ['auto', 'required', 'none'].includes(data.imageMode) ? data.imageMode : 'auto'
  const output = data.imageOutput === 'tikz' ? 'tikz' : 'raster'
  return {
    files, mode, output,
    instruction: `PLAN VISUAL OBLIGATORIO: devuelve también imagePlan con needed (booleano), prompt (texto), alt (texto). ${mode === 'none' ? 'No incluyas imágenes externas ni llamadas a includegraphics: redacta un ejercicio autosuficiente.' : output === 'tikz' ? `${mode === 'required' ? 'Debes incluir una figura nueva.' : 'Si el original depende de una figura, o una figura ayuda al ejercicio, incluye una figura nueva.'} Dibújala directamente en un entorno tikzpicture completo, con instrucciones TikZ estándar, adaptada a los datos de la variante. No uses imágenes externas, includegraphics ni bibliotecas adicionales que no estén cargadas. Usa siempre imagePlan.needed=false, prompt y alt vacíos.` : mode === 'required' ? 'Genera una ilustración nueva: needed=true y usa exactamente \\includegraphics[width=0.8\\linewidth]{neope_generated_1} en el lugar de la imagen.' : 'Si el original depende de una imagen adjunta, genera una imagen nueva coherente para la variante. Si una ilustración ayuda de forma relevante puedes crearla aunque el original no la tenga. Para gráficas y geometría exactas prioriza TikZ/pgfplots; si ya has dibujado la figura en TikZ, needed=false. Para una imagen externa nueva usa needed=true y exactamente \\includegraphics[width=0.8\\linewidth]{neope_generated_1}.'} Describe en prompt todos los datos, etiquetas, medidas, relaciones y restricciones del dibujo nuevo, en coherencia con el enunciado y las soluciones; la imagen de referencia solo sirve de contexto y no debes copiar sus valores anteriores. Si needed=false, prompt y alt pueden estar vacíos. Nunca menciones archivos externos inventados. Indicaciones opcionales: ${text(data.imageInstructions, 1500) || 'sin indicaciones adicionales'}`,
  }
}

export const visualVariationFormat = {
  type: 'json_schema', json_schema: { name: 'visual_exercise_variation', strict: true, schema: {
    type: 'object', properties: {
      enunciado: { type: 'string' },
      imagePlan: { type: 'object', properties: { needed: { type: 'boolean' }, prompt: { type: 'string' }, alt: { type: 'string' } }, required: ['needed', 'prompt', 'alt'], additionalProperties: false },
    }, required: ['enunciado', 'imagePlan'], additionalProperties: false,
  } },
}

export async function generateExerciseRaster(data, apiKey) {
  const model = text(data.imageModel, 180)
  const catalog = await visualModelCatalog(apiKey)
  const configuration = catalog.find((entry) => entry.id === model && entry.outputModalities.includes('image') && entry.rasterOutput !== false)
  if (!configuration) throw new HttpsError('invalid-argument', 'Selecciona un generador de imágenes disponible en el catálogo.')
  const files = visualReferenceImages(data.referenceImages)
  if (files.length && !configuration.imageReferences) throw new HttpsError('failed-precondition', 'Este generador no admite imágenes de referencia. Elige uno con «Admite referencias».')
  if (files.length > configuration.imageReferenceLimit) throw new HttpsError('failed-precondition', `Este generador admite hasta ${configuration.imageReferenceLimit} imagen(es) de referencia. Selecciona un generador que admita al menos ${files.length}.`)
  const statement = text(data.enunciado, 60000)
  if (!statement) throw new HttpsError('invalid-argument', 'Falta el enunciado al que debe corresponder la imagen.')
  const prompt = [
    'Ilustración educativa para un ejercicio de Matemáticas. Respeta estrictamente los datos, medidas, etiquetas y relaciones del enunciado. Si las referencias o la especificación histórica difieren del enunciado actual, utiliza los datos del enunciado actual. No cambies las cantidades ni muestres soluciones que no deban conocer los alumnos. La ilustración debe ser clara, legible e imprimible.',
    `ENUNCIADO QUE DEBES ILUSTRAR:\n${statement}`,
    `ESPECIFICACIÓN DE LA FIGURA:\n${text(data.imagePrompt, 9000) || 'Recrea la figura de referencia respetando el enunciado.'}`,
    `INDICACIONES DEL PROFESOR (mantén los datos matemáticos del enunciado):\n${text(data.instructions, 2000) || 'Trazo limpio, fondo blanco, sin adornos innecesarios.'}`,
  ].join('\n\n')
  const body = { model, prompt }
  if (configuration.parameters?.n) body.n = 1
  if (configuration.parameters?.output_format?.values?.includes('png')) body.output_format = 'png'
  if (configuration.parameters?.resolution?.values?.includes('1K')) body.resolution = '1K'
  if (files.length) body.input_references = files.map((file) => ({ type: 'image_url', image_url: { url: file.dataUrl } }))
  const result = configuration.imageApi
    ? await routerRequest('images', apiKey, { body, timeout: 210000 })
    : await routerRequest('chat/completions', apiKey, { timeout: 210000, body: {
      model, modalities: configuration.outputModalities.includes('text') ? ['text', 'image'] : ['image'],
      messages: [{ role: 'user', content: visualMessageContent(prompt, files) }],
      provider: { data_collection: 'deny' },
    } })
  const message = result.choices?.[0]?.message
  const dataUrl = message?.images?.[0]?.image_url?.url
    || (Array.isArray(message?.content) ? message.content.find((part) => part.type === 'image_url')?.image_url?.url : '')
  const inline = typeof dataUrl === 'string' ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl) : null
  const image = configuration.imageApi ? result.data?.[0] : inline ? { media_type: inline[1], b64_json: inline[2] } : null
  const bytes = image?.b64_json
  if (typeof bytes !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(bytes) || Buffer.byteLength(bytes, 'base64') > 6_000_000) throw new HttpsError('internal', 'El proveedor no ha devuelto una imagen de tamaño válido.')
  const mimeType = image.media_type || (/^iVBOR/.test(bytes) ? 'image/png' : /^\/9j\//.test(bytes) ? 'image/jpeg' : '')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new HttpsError('failed-precondition', 'El generador debe devolver una imagen PNG, JPEG o WebP. Selecciona otro modelo.')
  return { dataUrl: `data:${mimeType};base64,${bytes}`, mimeType, model, prompt, instructions: text(data.instructions, 2000), createdAt: new Date().toISOString() }
}

export async function regenerateTikzFigure(data, apiKey, modelConfiguration) {
  const figure = text(data.figureCode, 30000)
  const createFigure = data.createFigure === true
  if (!createFigure && (!/^\\begin\s*\{tikzpicture\}/.test(figure) || !/\\end\s*\{tikzpicture\}\s*$/.test(figure))) throw new HttpsError('invalid-argument', 'Selecciona una figura TikZ completa.')
  const files = visualReferenceImages(data.referenceImages)
  const catalog = await visualModelCatalog(apiKey)
  const supportsVision = catalog.find((entry) => entry.id === modelConfiguration.id)?.inputModalities.includes('image')
  if (createFigure && files.length && !supportsVision) throw new HttpsError('failed-precondition', 'Selecciona uno de tus modelos con comprensión de imágenes para recrear la figura de referencia.')
  const result = await routerRequest('chat/completions', apiKey, { timeout: 150000, body: {
    model: modelConfiguration.id,
    messages: [
      { role: 'system', content: `${createFigure ? 'Crea una figura TikZ para el ejercicio recibido o recrea la imagen de referencia indicada.' : 'Mejora únicamente la figura TikZ recibida según las indicaciones del profesor.'} Conserva sus datos matemáticos, etiquetas, medidas, escala y relaciones con el enunciado. Usa instrucciones TikZ estándar y no requieras bibliotecas adicionales. Devuelve exclusivamente un entorno tikzpicture completo, sin Markdown, sin preámbulo y sin cambiar ninguna otra parte del ejercicio.` },
      { role: 'user', content: visualMessageContent(`ENUNCIADO:\n${text(data.enunciado, 60000)}\n\nFIGURA:\n${figure || text(data.imageName, 120) || 'Nueva figura acorde con el enunciado'}\n\nINDICACIONES:\n${text(data.instructions, 2000) || 'Mejora la claridad, el equilibrio y la legibilidad.'}`, supportsVision ? files : []) },
    ], max_tokens: 8000, provider: { data_collection: 'deny' },
  } })
  const content = result.choices?.[0]?.message?.content
  const code = text(typeof content === 'string' ? content : '', 40000).replace(/^```(?:latex|tex)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!/^\\begin\s*\{tikzpicture\}/.test(code) || !/\\end\s*\{tikzpicture\}\s*$/.test(code) || /\\(?:documentclass|input|includegraphics|write18)\b|\\(?:begin|end)\s*\{document\}/.test(code)) throw new HttpsError('internal', 'La IA no ha devuelto una figura TikZ independiente válida.')
  return { kind: 'tikz', code, model: modelConfiguration.id, instructions: text(data.instructions, 2000), createdAt: new Date().toISOString() }
}
