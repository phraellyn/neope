export function cleanGenerationInstructions(value) {
  return typeof value === 'string' ? value.trim().slice(0, 3000) : ''
}

export function documentGenerationInstructions(mode, sourceType, value) {
  return mode === 'generate' && sourceType === 'curriculum' ? cleanGenerationInstructions(value) : ''
}

export function solutionGenerationInstruction(value) {
  const instructions = cleanGenerationInstructions(value)
  return instructions ? `INDICACIONES DEL PROFESOR PARA LA RESOLUCIÓN (aplícalas a la solución sin cambiar el enunciado y siempre que sean compatibles con la corrección matemática y las reglas técnicas):\n${instructions}` : ''
}
