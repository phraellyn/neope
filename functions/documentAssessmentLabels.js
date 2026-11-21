/** Etiquetas de la matriz derivadas de las herramientas del documento. */
export function documentAssessmentLabels(document = {}, references = []) {
  const templates = document.plantillas?.length ? document.plantillas : [document.plantilla || {}]
  const selectivity = templates.some((template) => /selectividad/i.test(`${template?.archivo || ''} ${template?.nombre || ''} ${template?.name || ''} ${template?.metadata?.name || ''}`))
  if (!selectivity) return references.map((_, order) => ({ label: `Ejercicio ${order + 1}`, selectivityQuestionThree: false }))
  const blocks = document.content?.blocks || document.bloques || []
  const labels = []
  let required = 0
  const visit = (items, optional = null) => {
    let index = 0
    for (const block of Array.isArray(items) ? items : []) {
      if (block.type === 'tool' || block.toolId) {
        const match = String(block.toolId || '').match(/^selectividad-pregunta-([45])$/)
        if (match) visit(block.children, match[1])
        else visit(block.children, optional)
      } else if (block.exerciseId) {
        const number = optional ? `${optional}.${++index}` : String(++required)
        labels.push({ blockId: block.blockId || '', exerciseId: block.exerciseId, label: `Pregunta ${number}`, selectivityQuestionThree: !optional && number === '3' })
      }
    }
  }
  visit(blocks)
  return references.map((reference, order) => {
    const match = (reference.blockId && labels.find((entry) => entry.blockId === reference.blockId)) || labels[order]
    return match ? { label: match.label, selectivityQuestionThree: match.selectivityQuestionThree } : { label: `Ejercicio ${order + 1}`, selectivityQuestionThree: false }
  })
}
