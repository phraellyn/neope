export { graphicReferences, imageAssetsSignature, imageReferenceName, referencedImageFiles, replaceGraphicReference, tikzFigures, versionImageFiles } from '../../functions/exerciseVisualsShared.js'

export function modelCapabilitiesOption(option, catalog = []) {
  const known = catalog.find((entry) => entry.id === option.value)
  const canReadImages = Boolean(known?.inputModalities.includes('image') && known?.outputModalities.includes('text'))
  const canGenerateImages = Boolean(known?.outputModalities.includes('image'))
  const labels = known ? [canReadImages ? 'Comprende imágenes' : '', canGenerateImages ? 'Genera imágenes' : '', !canReadImages && !canGenerateImages ? 'Texto' : ''].filter(Boolean) : ['Capacidades sin verificar']
  return { ...option, canReadImages, canGenerateImages, capabilitiesKnown: Boolean(known), subtitle: [labels.join(' · '), option.subtitle].filter(Boolean).join(' — ') }
}

export function exerciseImageAssets(files = []) {
  return Object.fromEntries(files.filter((file) => file.compilerName && (file.url || file.pendingDataUrl)).map((file) => [file.compilerName, file.pendingDataUrl ? { data: file.pendingDataUrl.split(',')[1] } : { url: file.url }]))
}

export function imageGenerationMetadata(value = {}) {
  return {
    model: String(value.model || '').slice(0, 180), prompt: String(value.prompt || '').slice(0, 12000),
    instructions: String(value.instructions || '').slice(0, 2000), createdAt: String(value.createdAt || '').slice(0, 50),
  }
}

export function archivedImage(file, replacementId = '') {
  if (!file || file.pendingDataUrl || String(file.url || '').startsWith('blob:')) return null
  return {
    id: file.id || '', path: file.path || '', url: file.url || '', compilerName: file.compilerName || '',
    latexName: file.latexName || '', type: file.type || 'image/png', size: file.size || 0,
    variantId: file.variantId || '', replacementId,
    generation: { ...imageGenerationMetadata(file.generation), prompt: '' },
  }
}

export async function generatedImageFile(response, { latexName, variantId }) {
  const source = await fetch(response.dataUrl)
  let blob = await source.blob()
  let type = blob.type
  if (!['image/png', 'image/jpeg'].includes(type)) {
    const bitmap = await createImageBitmap(blob)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No se ha podido convertir la imagen generada.')), 'image/png'))
      type = 'image/png'
    } finally { bitmap.close() }
  }
  if (blob.size > 6_000_000) throw new Error('La imagen generada es demasiado grande para el ejercicio.')
  const extension = type === 'image/jpeg' ? 'jpg' : 'png'
  const id = crypto.randomUUID()
  const pendingDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se ha podido preparar la imagen generada.'))
    reader.readAsDataURL(blob)
  })
  return {
    id, nombre: `${latexName}.${extension}`, originalName: `Imagen generada.${extension}`,
    latexName, compilerName: `${latexName}.${extension}`, path: `pending/${id}`, url: URL.createObjectURL(blob),
    pendingDataUrl, type, size: blob.size, variantId, generated: true, generation: imageGenerationMetadata(response),
  }
}

export function revokePendingImage(file) {
  if (file?.pendingDataUrl && file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url)
}
