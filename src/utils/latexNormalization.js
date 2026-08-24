// Convierte los antiguos delimitadores de display sin tocar saltos de fila
// con separación opcional, por ejemplo `\\[5pt]` dentro de matrices.
export function normalizeDisplayMathDelimiters(text) {
  return String(text || '').replace(
    /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,
    (_, body) => `$$${body.trim()}$$`,
  )
}
