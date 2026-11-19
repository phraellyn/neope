const fallbackStrategy = 'ANÁLISIS DIDÁCTICO: realiza internamente un análisis del ejercicio base antes de proponer la variante. Mantén las destrezas, la dificultad, las puntuaciones y la estructura exigida. Diseña una transformación matemática sustancial que no sea solo un cambio numérico, respeta las indicaciones del profesor y comprueba que la nueva solución sea coherente.'

export function variationStrategyFromAnalysis(content) {
  let analysis
  try { analysis = JSON.parse(String(content || '')) } catch { return { strategy: fallbackStrategy, usedFallback: true } }
  const text = (value, max = 1200) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const list = (value) => Array.isArray(value) ? value.map((item) => text(item, 400)).filter(Boolean).slice(0, 8) : []
  const core = text(analysis?.core), difficulty = text(analysis?.difficulty)
  const outline = text(analysis?.solutionOutline), plan = text(analysis?.transformationPlan)
  const skills = list(analysis?.skills), invariants = list(analysis?.invariants)
  if (!core || !difficulty || !outline || !plan || !skills.length || !invariants.length) return { strategy: fallbackStrategy, usedFallback: true }
  return {
    strategy: `ANÁLISIS DIDÁCTICO DEL EJERCICIO BASE:\n- Núcleo: ${core}\n- Destrezas: ${skills.join('; ')}\n- Dificultad: ${difficulty}\n- Esquema de solución: ${outline}\n- Elementos que deben mantenerse: ${invariants.join('; ')}\n\nPLAN OBLIGATORIO DE TRANSFORMACIÓN ESTRUCTURAL:\n${plan}\n\nNo hagas un cambio cosmético ni solo numérico. Aplica ese plan y comprueba que el resultado sea claramente distinto al original, pero de dificultad y extensión comparables.`,
    usedFallback: false,
  }
}
