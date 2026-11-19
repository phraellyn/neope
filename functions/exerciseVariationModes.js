export function exerciseVariationMode(value) {
  return value === 'concepts' ? 'concepts' : value === 'original' ? 'original' : 'legacy'
}

export function validateConceptVariation(source) {
  const code = String(source || '')
  const issues = []
  if ((code.match(/\\ej\b/g) || []).length !== 1) issues.push('Debe haber exactamente un comando \\ej.')
  const total = code.match(/\\M\s*\{\s*([\d.,]+)\s*\}/)
  if (!total || !(Number(total[1].replace(',', '.')) > 0)) issues.push('El ejercicio necesita una puntuación total positiva en \\M{...}.')
  const parts = code.split(/\\ap\b/).slice(1)
  if (parts.length && !/\\begin\s*\{apartadosc?\}/.test(code)) issues.push('Los apartados deben estar dentro de un entorno apartados o apartadosc.')
  const points = parts.map((part) => part.match(/\\p\s*\{\s*([\d.,]+)\s*\}/))
  if (points.some((point) => !point || !(Number(point[1].replace(',', '.')) > 0))) issues.push('Cada apartado necesita una puntuación positiva en \\p{...}.')
  if (parts.length && total && points.every(Boolean)) {
    const sum = points.reduce((value, point) => value + Number(point[1].replace(',', '.')), 0)
    if (Math.abs(sum - Number(total[1].replace(',', '.'))) > 0.001) issues.push('La suma de los apartados debe coincidir con la puntuación total.')
  }
  if (parts.length && parts.some((part) => !/\\begin\s*\{solucion\}[\s\S]+?\\end\s*\{solucion\}/.test(part))) issues.push('Cada apartado debe incluir su propia solución desarrollada.')
  if (!parts.length && !/\\begin\s*\{solucion\}[\s\S]+?\\end\s*\{solucion\}/.test(code)) issues.push('El ejercicio necesita una solución desarrollada.')
  const ids = [...code.matchAll(/^[ \t]*%[ \t]*neope:part[ \t]+id=([A-Za-z0-9_-]+)/gm)].map((match) => match[1])
  if (new Set(ids).size !== ids.length) issues.push('Los identificadores de apartados no pueden repetirse.')
  return issues
}

export function validReferenceCriteria(criteria, totalPoints) {
  return Array.isArray(criteria) && criteria.length > 0 && criteria.length <= 30
    && criteria.every((item) => typeof item?.description === 'string' && item.description.trim() && Number(item.points) > 0)
    && Math.abs(criteria.reduce((sum, item) => sum + Number(item.points), 0) - Number(totalPoints)) < 0.001
}

export function applyReferenceCriterionPoints(generated, reference) {
  if (!Array.isArray(generated) || generated.length !== reference.length) return null
  return generated.map((criterion, index) => ({ ...criterion, points: reference[index].points }))
}
