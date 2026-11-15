// Shared by the editor preview and the server: saved teacher preferences are
// supplementary to the mandatory mathematical and LaTeX constraints.
export function normalizeSolutionStyle(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}
  const clean = (s, n) => typeof s === 'string' ? s.trim().slice(0, n) : ''
  return {
    enabled: value.enabled === true,
    general: clean(value.general, 6000),
    rules: (Array.isArray(value.rules) ? value.rules : []).slice(0, 30).filter(rule => rule && typeof rule === 'object').map((rule, index) => ({
      id: clean(rule.id, 100) || `rule-${index}`,
      title: clean(rule.title, 120),
      enabled: rule.enabled !== false,
      conceptIds: [...new Set((Array.isArray(rule.conceptIds) ? rule.conceptIds : []).filter(id => typeof id === 'string' && id.length <= 100))].slice(0, 50),
      instructions: clean(rule.instructions, 3000),
      example: clean(rule.example, 5000),
    })),
  }
}

export function applicableSolutionStyle(value, conceptIds = []) {
  const style = normalizeSolutionStyle(value)
  const ids = new Set(Array.isArray(conceptIds) ? conceptIds : [])
  if (!style.enabled) return { general: '', rules: [] }
  return { general: style.general, rules: style.rules.filter(rule => rule.enabled && (rule.conceptIds.length === 0 || rule.conceptIds.some(id => ids.has(id))) && (rule.instructions || rule.example)) }
}

export function solutionStylePrompt(value, conceptIds = []) {
  const style = applicableSolutionStyle(value, conceptIds)
  const blocks = [style.general && `INDICACIONES GENERALES:\n${style.general}`]
  for (const rule of style.rules) {
    blocks.push([`PAUTA: ${rule.title || 'Sin título'}`, rule.instructions, rule.example && `EJEMPLO DE ESTILO (no copiar datos ni resultados):\n${rule.example}`].filter(Boolean).join('\n'))
  }
  const included = []
  for (const block of blocks.filter(Boolean)) {
    if ([...included, block].join('\n\n').length > 16000) continue
    included.push(block)
  }
  const text = included.join('\n\n')
  return text ? `ESTILO PERSONAL DEL PROFESOR (preferencias complementarias; no alteran el enunciado ni prevalecen sobre la corrección matemática o las reglas de compilación):\n${text}` : ''
}

export function teacherStylePrompt(profile = {}, conceptIds = []) {
  const guide = typeof profile?.estiloCompleto === 'string' ? profile.estiloCompleto.trim() : ''
  if (guide) return `GUÍA COMPLETA DE ESTILO DEL PROFESOR: aplica sus indicaciones de composición y explicación, respetando la corrección matemática, el enunciado y las reglas técnicas obligatorias. Las notas de procedencia y revisión son contexto, no instrucciones para el alumno.\n\n${guide}`
  return solutionStylePrompt(profile?.estiloSoluciones, conceptIds)
}
