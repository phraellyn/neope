import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'

const openRouterApiKey = defineSecret('OPENROUTER_API_KEY')

const aiModels = Object.freeze({
  'openai/gpt-5-mini': { reasoningEffort: 'minimal', label: 'GPT-5 Mini' },
  'google/gemini-3-flash-preview': { reasoningEffort: 'minimal', label: 'Gemini 3 Flash' },
  'openai/gpt-5.6-luna': { reasoningEffort: 'minimal', label: 'GPT-5.6 Luna' },
  'openai/gpt-5.6-terra': { reasoningEffort: 'minimal', label: 'GPT-5.6 Terra' },
  'openai/gpt-5.6-sol': { reasoningEffort: 'minimal', label: 'GPT-5.6 Sol' },
  'moonshotai/kimi-k3': { reasoningEffort: 'minimal', label: 'Kimi K3' },
})

const variationResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_variation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        enunciado: { type: 'string', minLength: 1, maxLength: 60_000 },
      },
      required: ['enunciado'],
      additionalProperties: false,
    },
  },
}

const solutionResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'solved_exercise',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        enunciado: { type: 'string', minLength: 1, maxLength: 60_000 },
      },
      required: ['enunciado'],
      additionalProperties: false,
    },
  },
}

const exerciseAnalysisResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'exercise_variation_strategy',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        core: { type: 'string' },
        skills: { type: 'array', items: { type: 'string' } },
        difficulty: { type: 'string' },
        solutionOutline: { type: 'string' },
        transformationPlan: { type: 'string' },
        invariants: { type: 'array', items: { type: 'string' } },
      },
      required: ['core', 'skills', 'difficulty', 'solutionOutline', 'transformationPlan', 'invariants'],
      additionalProperties: false,
    },
  },
}

const analysisSystemPrompt = String.raw`Analiza un ejercicio de Matemáticas de Secundaria o Bachillerato diseñado por un profesor. No redactes una variación ni LaTeX: extrae una estrategia de diseño para crear después una variante pedagógicamente sustancial.

Identifica la estructura matemática esencial, las destrezas evaluadas, la dificultad, el esquema de solución y los elementos que deben preservarse. Propón un plan de transformación que cambie de manera estructural el objeto, la restricción, la magnitud, la representación o la pregunta, sin reducir la dificultad ni convertirlo en un simple cambio de datos. El nuevo ejercicio deberá poder resolverse con un esquema de razonamiento comparable, pero no ser clónico del original.`

const systemPrompt = String.raw`Eres un profesor de Matemáticas de Secundaria y Bachillerato que redacta ejercicios rigurosos en LaTeX.

Genera UNA variación pedagógicamente sustancial del ejercicio recibido. Debe evaluar los mismos conceptos y destrezas, conservar dificultad y extensión comparables, pero cambiar de manera razonable los datos, el enfoque, la representación o lo que se pide. No te limites a sustituir números.

Contrato obligatorio de salida:
- Devuelve exclusivamente un fragmento LaTeX compilable: sin Markdown, sin explicaciones, sin preámbulo y sin \begin{document} ni \end{document}.
- Respeta exactamente los comandos y la estructura indicados en el contrato que acompaña al ejercicio: \ej, \M, \ap, \p, \info, \begin{apartados} y los demás que estén presentes. No los conviertas en texto ordinario. Si el contrato fija el contenido de \info, respétalo literalmente.
- Ignora por completo los comandos heredados \sol y \lsol: no los copies, no los generes y no añadas \soluciones. Las soluciones solo se conservan si aparecen explícitamente dentro de \begin{solucion} ... \end{solucion}.
- Antes de responder, comprueba mentalmente que todas las variables están definidas, los datos son compatibles, cada apartado tiene respuesta y las puntuaciones suman de forma coherente.
- En cualquier solución de geometría vectorial que conserves o generes, no hagas álgebra con puntos: usa vectores posición respecto de un origen, por ejemplo \Vec{OB}=\Vec{OA}+\Vec{AB}, y no B=A+\Vec{AB}.
- Si el ejercicio pide razonar a partir de una gráfica o figura, trata la gráfica como la única fuente de información: no uses ni menciones la expresión analítica, parámetros, coordenadas de control o comandos internos de TikZ/pgfplots, salvo que estén mostrados explícitamente al alumno. Toda afirmación de la solución debe poder inferirse visualmente de la gráfica proporcionada.
- Conserva todas las barras invertidas, equilibra llaves y entornos, y usa & únicamente dentro de pmatrix, matrizp, matrix, array, aligned, align o tabular.
- Si hay un entorno solucion, reescribe una solución completa y correcta para los nuevos datos; si no lo hay, no inventes soluciones.
- Las reglas de diseño de 8 cm se aplican SOLO dentro de \begin{solucion}...\end{solucion}; no alteres el enunciado para adaptarte a ellas. En cada solución deja una línea en blanco antes de \begin{solucion}, usa matrizp, detp y sistemap en lugar de matrices estándar, compón las cadenas largas con aligned solo cuando lo necesiten y no pongas dos matrices compactas en una misma fila de aligned. Si la solución incluye una figura, sigue las mismas reglas de composición con TikZ. No uses nunca \begin{center} ni \end{center} dentro de una solución: para centrar un tikzpicture usa \noindent\hfill antes y \hfill\mbox{}\par después. Todo símbolo o comando matemático debe estar dentro de $...$ o de $$...$$; en particular, no escribas \text, \mathrm, \frac, \sqrt, ^, _ ni variables matemáticas en texto normal. Comprueba que cada $ tiene su pareja antes de responder. En problemas de geometría o modelización espacial que describan una construcción, transformación o relación entre figuras, el TikZ explicativo es obligatorio.
- Evita copiar literalmente el enunciado original y las variaciones anteriores.`

const solutionSystemPrompt = String.raw`Eres un profesor de Matemáticas de Secundaria y Bachillerato. Incorpora al ejercicio recibido una solución completa, rigurosa y pedagógica.

Contrato obligatorio de salida:
- Devuelve exclusivamente el EJERCICIO COMPLETO como fragmento LaTeX compilable: sin Markdown, sin explicaciones externas, sin preámbulo y sin \begin{document} ni \end{document}. Conserva el enunciado, comandos, apartados y puntuaciones; añade solamente las soluciones y coloca \info al final según la regla indicada por el usuario.
- Ignora por completo \sol, \lsol y \soluciones: no los copies ni los generes.
- Si el ejercicio tiene apartados (\ap), añade exactamente un entorno \begin{solucion} ... \end{solucion} completo después del contenido de CADA apartado y antes del siguiente \ap o de \end{apartados}. Si no hay \ap, añade un único entorno \begin{solucion} ... \end{solucion} al final del ejercicio, antes de \info.
- Deja siempre una línea en blanco real entre el final del enunciado o apartado y cada \begin{solucion}. Es decir, debe haber dos saltos de línea antes de iniciar ese entorno; no basta con una nueva línea sangrada.
- Resuelve todos los apartados con cálculos, justificaciones y resultados correctos. No dejes marcadores pendientes ni afirmaciones sin justificar.
- En geometría vectorial, no hagas álgebra con puntos: nunca escribas B=A+\Vec{AB}. Formula las relaciones con vectores posición respecto de un origen, por ejemplo \Vec{OB}=\Vec{OA}+\Vec{AB}, y distingue con precisión puntos, vectores y coordenadas.
- Cuando el enunciado pida razonar sobre una gráfica o figura, la solución debe usar exclusivamente la información visible para el alumno: no deduzcas ni emplees la fórmula analítica, parámetros, puntos de control o comandos internos de TikZ/pgfplots que aparezcan en el código fuente. Justifica límites, continuidad, crecimiento, valores o tangencias solo a partir de lo que se lee en la gráfica.
- Usa únicamente LaTeX compilable, con llaves y entornos equilibrados. No uses \[ ... \]; para matemáticas destacadas usa siempre $$ ... $$. Todo comando o símbolo matemático (incluidos \text, \mathrm, \frac, \sqrt, ^ y _) debe estar dentro de $...$ o $$...$$; revisa que cada signo $ quede emparejado, también en las etiquetas de TikZ.
- Para matrices, determinantes y sistemas usa SIEMPRE los entornos compactos que ya define la plantilla: \begin{matrizp} ... \end{matrizp}, \begin{detp} ... \end{detp} y \begin{sistemap} ... \end{sistemap}. No uses pmatrix, bmatrix, matrix, vmatrix, Vmatrix, cases ni array para ellos. Para un vector de dos componentes usa \c{a}{b}.
- Actúa también como un diseñador editorial: la columna útil mide 8 cm y debes anticipar la anchura REAL compuesta, no aplicar reglas mecánicas según el número de signos. Antes de responder, revisa visualmente cada bloque matemático y asegúrate de que ninguna fila puede exceder esos 8 cm.
- Usa aligned solo cuando mejore la composición. Divide una cadena de igualdades o implicaciones en filas cuando no quepa con comodidad; entonces mantén una transformación legible por fila, por ejemplo A&=B=\\ &=C=\\ &=D=E, o A&\implies B\implies\\ \implies{}&C\implies D. No dejes nunca líneas en blanco dentro de aligned: cada línea física debe contener una fila matemática o el separador \\. No fragmentes una cadena simbólica corta que sí cabe, como C^6&=C^3\cdot C^3=I.
- No pongas dos matrices, determinantes o sistemas compactos en una misma fila de aligned: incluso compactos, dos 3×3 se salen de la columna. En esos casos usa nombres intermedios y una composición vertical, por ejemplo C^2&=C\cdot C\\ &=\begin{matrizp}...\end{matrizp}. Una fila puede contener como máximo una matriz compacta.
- Cuando un dibujo, esquema geométrico, gráfica, diagrama de árbol o representación visual ayude de forma relevante a justificar o entender la solución, inclúyelo con TikZ. En problemas de geometría o modelización espacial que describan una construcción, transformación o relación entre figuras, es OBLIGATORIO incluir un TikZ explicativo antes de plantear las ecuaciones. Por ejemplo, para una cartulina que se pliega en un cilindro, dibuja de forma compacta el rectángulo y/o el cilindro resultante, etiqueta qué lado es la altura h y qué lado se convierte en la circunferencia 2\pi r. El dibujo debe ser matemáticamente correcto, sobrio y compacto, caber en la columna útil de 8 cm y aportar información: no uses TikZ como mero adorno ni repitas una figura ya suficiente en el enunciado. Importante: no uses \begin{center}, \end{center}, figure ni otros entornos flotantes. Para centrar un dibujo utiliza exactamente \noindent\hfill antes de \begin{tikzpicture} y \hfill\mbox{}\par después de \end{tikzpicture}.
- Usa & únicamente dentro de un entorno de alineación o matriz.`

const alignedEnvironments = new Set([
  'align', 'align*', 'aligned', 'array', 'bmatrix', 'matrix', 'matriz', 'matrizp', 'detp', 'sistemap',
  'pmatrix', 'smallmatrix', 'tabular', 'tabular*', 'vmatrix', 'Vmatrix',
])

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length
}

function choiceContent(choice) {
  const rawContent = choice?.message?.content
  return typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
      : ''
}

function stripLegacySolutionCommands(text) {
  const commandPattern = /\\(?:sol|lsol)\s*\{/g
  let result = ''
  let cursor = 0

  for (const match of text.matchAll(commandPattern)) {
    const openingBrace = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let end = openingBrace + 1
    for (; end < text.length && depth > 0; end += 1) {
      if (text[end] === '{') depth += 1
      if (text[end] === '}') depth -= 1
    }
    if (depth !== 0) break
    result += text.slice(cursor, match.index)
    cursor = end
  }

  return `${result}${text.slice(cursor)}`.replace(/\n{3,}/g, '\n\n').trim()
}

function splitAlignedRows(body) {
  const rows = []
  const tokenPattern = /\\begin\s*\{[^}]+\}|\\end\s*\{[^}]+\}|\\\\/g
  let nestedDepth = 0
  let rowStart = 0

  for (const token of body.matchAll(tokenPattern)) {
    if (token[0] === '\\\\') {
      if (nestedDepth === 0) {
        rows.push(body.slice(rowStart, token.index))
        rowStart = token.index + token[0].length
      }
    } else if (token[0].startsWith('\\begin')) {
      nestedDepth += 1
    } else {
      nestedDepth = Math.max(0, nestedDepth - 1)
    }
  }
  rows.push(body.slice(rowStart))
  return rows
}

function removeBlankLinesInsideAligned(text) {
  return text.replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => (
    `\\begin{aligned}${body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')}\\end{aligned}`
  ))
}

function compactAlignedChains(text) {
  return removeBlankLinesInsideAligned(text).replace(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g, (match, body) => {
    const normalizedBody = body.replace(/\r?\n[ \t]*(?:\r?\n[ \t]*)+/g, '\n')
    const rows = splitAlignedRows(normalizedBody).flatMap((row) => {
      const equalityCount = countMatches(row, /=/g)
      const equalityMatch = equalityCount > 2 && row.length > 72 && row.match(/^([\s\S]*?&\s*=\s*)([\s\S]*)$/)
      if (equalityMatch) {
        const terms = equalityMatch[2].split('=').map((term) => term.trim()).filter(Boolean)
        if (terms.length >= 3) {
          const formatted = [`${equalityMatch[1]}${terms[0]}=`]
          for (let index = 1; index < terms.length - 2; index += 1) formatted.push(`&=${terms[index]}=`)
          formatted.push(`&=${terms.at(-2)}=${terms.at(-1)}`)
          return formatted
        }
      }

      const implicationCount = countMatches(row, /\\implies\b/g)
      const implicationMatch = implicationCount > 2 && row.length > 72 && row.match(/^([\s\S]*?&\s*\\implies\s*)([\s\S]*)$/)
      if (implicationMatch) {
        const terms = implicationMatch[2].split(/\\implies\b/).map((term) => term.trim()).filter(Boolean)
        if (terms.length >= 3) {
          const formatted = [`${implicationMatch[1]}${terms[0]} \\implies`]
          for (let index = 1; index < terms.length - 2; index += 1) formatted.push(`\\implies{}&${terms[index]} \\implies`)
          formatted.push(`\\implies{}&${terms.at(-2)} \\implies ${terms.at(-1)}`)
          return formatted
        }
      }

      return [row]
    })
    return `\\begin{aligned}${rows.join('\\\\\n')}\\end{aligned}`
  })
}

function infoContent(text) {
  const match = text.match(/\\info\s*\{([^{}]*)\}/)
  return match?.[1]?.trim() || ''
}

function validateLatexVariation(original, variation, expectedInfo = '') {
  const issues = []
  const requiredPatterns = [
    ['\\ej', /\\ej\b/g],
    ['\\M', /\\M\s*\{/g],
    ['\\ap', /\\ap\b/g],
    ['\\p', /\\p\s*\{/g],
    ['\\info', /\\info\s*\{/g],
    ['apartados', /\\begin\s*\{apartados\}/g],
    ['solucion', /\\begin\s*\{solucion\}/g],
  ]

  for (const [label, pattern] of requiredPatterns) {
    const originalCount = countMatches(original, pattern)
    if (!originalCount) continue
    const variationCount = countMatches(variation, pattern)
    if (variationCount !== originalCount) {
      issues.push(`Debe conservar ${originalCount} aparición(es) de ${label}; contiene ${variationCount}.`)
    }
  }

  if (expectedInfo && countMatches(original, /\\info\s*\{/g) && !variation.includes(`\\info{${expectedInfo}}`)) {
    issues.push(`El contenido de \\info debe ser exactamente "${expectedInfo}".`)
  }

  const originalSolutionEnvironments = [...original.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  if (originalSolutionEnvironments.length) {
    const generatedSolutionEnvironments = [...variation.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
    if (generatedSolutionEnvironments.some((match) => !match[1].trim())) {
      issues.push('Los entornos solucion no pueden estar vacíos.')
    }
  }

  const environmentStack = []
  const tokenPattern = /\\(begin|end)\s*\{([^}]+)\}/g
  for (const match of variation.matchAll(tokenPattern)) {
    if (match[1] === 'begin') {
      environmentStack.push(match[2])
    } else if (match[1] === 'end') {
      const openEnvironment = environmentStack.pop()
      if (openEnvironment !== match[2]) {
        issues.push(`Entornos desordenados: se cierra ${match[2]} pero estaba abierto ${openEnvironment || 'ninguno'}.`)
        break
      }
    }
  }
  if (environmentStack.length) issues.push(`Falta cerrar el entorno ${environmentStack.at(-1)}.`)

  let braceDepth = 0
  for (let index = 0; index < variation.length; index += 1) {
    const character = variation[index]
    if (character !== '{' && character !== '}') continue
    let slashCount = 0
    for (let cursor = index - 1; cursor >= 0 && variation[cursor] === '\\'; cursor -= 1) slashCount += 1
    if (slashCount % 2) continue
    braceDepth += character === '{' ? 1 : -1
    if (braceDepth < 0) break
  }
  if (braceDepth !== 0) issues.push('Las llaves no están equilibradas.')

  return [...new Set(issues)]
}

function validateSolvedExercise(original, solvedExercise, expectedInfo) {
  const issues = validateLatexVariation(original, solvedExercise, expectedInfo)
  const partCount = countMatches(original, /\\ap\b/g)
  const solutionCount = countMatches(solvedExercise, /\\begin\s*\{solucion\}/g)

  if (partCount ? solutionCount !== partCount : solutionCount !== 1) {
    issues.push(partCount
      ? `Debe haber una solución por apartado (${partCount}); hay ${solutionCount}.`
      : `El ejercicio debe contener un único entorno solucion; hay ${solutionCount}.`)
  }
  if (countMatches(solvedExercise, /\\info\s*\{/g) !== 1) {
    issues.push('El ejercicio resuelto debe contener una única orden \\info.')
  }
  if (partCount) {
    const solvedParts = [...solvedExercise.matchAll(/\\ap\b([\s\S]*?)(?=\\ap\b|\\end\s*\{apartados\})/g)]
    if (solvedParts.length !== partCount || solvedParts.some((part) => !/\\begin\s*\{solucion\}[\s\S]*?\\end\s*\{solucion\}/.test(part[1]))) {
      issues.push('Cada apartado debe contener su propio entorno solucion antes del siguiente apartado.')
    }
  }
  if (/\\\[|\\\]/.test(solvedExercise)) {
    issues.push('Usa $$ ... $$ en lugar de \\[ ... \\].')
  }
  const generatedSolutions = [...solvedExercise.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  const missingSolutionSpacing = [...solvedExercise.matchAll(/\\begin\s*\{solucion\}/g)].some((solution) => (
    !/\n[ \t]*\n[ \t]*$/.test(solvedExercise.slice(0, solution.index))
  ))
  if (missingSolutionSpacing) {
    issues.push('Debe haber una línea en blanco antes de cada entorno solucion.')
  }
  const standardMatrix = /\\begin\s*\{(?:pmatrix|bmatrix|matrix|vmatrix|Vmatrix|cases)\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (standardMatrix) {
    issues.push('Las soluciones deben usar matrizp, detp o sistemap en lugar de matrices estándar.')
  }
  const overloadedMatrixRow = generatedSolutions.some((solution) => (
    [...solution[1].matchAll(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g)].some((aligned) => (
      splitAlignedRows(aligned[1]).some((row) => countMatches(row, /\\begin\s*\{(?:matrizp|detp|sistemap)\}/g) > 1)
    ))
  ))
  if (overloadedMatrixRow) {
    issues.push('Una fila de aligned no puede contener dos matrices o determinantes compactos.')
  }
  if (!new RegExp(`\\\\info\\s*\\{${expectedInfo.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\}\\s*$`).test(solvedExercise.trim())) {
    issues.push('\\info debe ser el último comando del ejercicio.')
  }

  return [...new Set(issues)]
}

function validateSolutionLayout(fragment) {
  const issues = []
  const generatedSolutions = [...fragment.matchAll(/\\begin\s*\{solucion\}([\s\S]*?)\\end\s*\{solucion\}/g)]
  if (!generatedSolutions.length) return issues

  const missingSolutionSpacing = [...fragment.matchAll(/\\begin\s*\{solucion\}/g)].some((solution) => (
    !/\n[ \t]*\n[ \t]*$/.test(fragment.slice(0, solution.index))
  ))
  if (missingSolutionSpacing) issues.push('Debe haber una línea en blanco antes de cada entorno solucion.')

  const standardMatrix = /\\begin\s*\{(?:pmatrix|bmatrix|matrix|vmatrix|Vmatrix|cases)\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (standardMatrix) issues.push('Las soluciones deben usar matrizp, detp o sistemap en lugar de matrices estándar.')

  const centerEnvironment = /\\(?:begin|end)\s*\{center\}/.test(generatedSolutions.map((solution) => solution[1]).join('\n'))
  if (centerEnvironment) issues.push('No se puede usar el entorno center dentro de una solución.')

  const overloadedMatrixRow = generatedSolutions.some((solution) => (
    [...solution[1].matchAll(/\\begin\s*\{aligned\}([\s\S]*?)\\end\s*\{aligned\}/g)].some((aligned) => (
      splitAlignedRows(aligned[1]).some((row) => countMatches(row, /\\begin\s*\{(?:matrizp|detp|sistemap)\}/g) > 1)
    ))
  ))
  if (overloadedMatrixRow) issues.push('Una fila de aligned no puede contener dos matrices o determinantes compactos.')

  const unescapedDollars = (fragment.replace(/\\\$/g, '').match(/\$/g) || []).length
  if (unescapedDollars % 2 !== 0) issues.push('Todos los delimitadores $ de modo matemático deben estar emparejados.')

  return issues
}

export const generateExerciseVariation = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  const startedAt = Date.now()
  const enunciado = typeof request.data?.enunciado === 'string' ? request.data.enunciado.trim() : ''
  const tags = Array.isArray(request.data?.tags) ? request.data.tags.filter((tag) => typeof tag === 'string').slice(0, 40) : []
  const variaciones = Array.isArray(request.data?.variaciones)
    ? request.data.variaciones.filter((variation) => typeof variation === 'string').slice(-8).map(stripLegacySolutionCommands)
    : []
  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  const experimental = request.data?.experimental === true

  if (!enunciado || enunciado.length > 60_000) {
    throw new HttpsError('invalid-argument', 'El enunciado es obligatorio y no puede superar 60.000 caracteres.')
  }
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }
  const exerciseForGeneration = stripLegacySolutionCommands(enunciado)
  const modelLabel = aiModels[model].label

  try {
    console.info('OpenRouter variation request started', {
      model,
      inputCharacters: exerciseForGeneration.length,
      previousVariations: variaciones.length,
    })
    const solutionEnvironmentCount = countMatches(exerciseForGeneration, /\\begin\s*\{solucion\}/g)
    const solutionRequirement = solutionEnvironmentCount
      ? `REQUISITO DE SOLUCIONES: conserva y recalcula ${solutionEnvironmentCount} entorno(s) solucion. Ninguna solución puede estar vacía.`
      : 'REQUISITO DE SOLUCIONES: el original no contiene soluciones; no añadas ninguna.'
    const expectedInfo = experimental ? `Variación experimental -- ${modelLabel}` : `Generado por ${modelLabel}`
    const infoRequirement = experimental
      ? `REGLA DE \\info: añade exactamente \\info{${expectedInfo}} como último comando del ejercicio.`
      : countMatches(exerciseForGeneration, /\\info\s*\{/g)
      ? `REGLA DE \\info: escribe exactamente \\info{${expectedInfo}}.`
      : 'REGLA DE \\info: no añadas este comando si el original no lo contiene.'
    const structureSummary = [
      ['\\ej', /\\ej\b/g],
      ['\\M', /\\M\s*\{/g],
      ['\\ap', /\\ap\b/g],
      ['\\p', /\\p\s*\{/g],
      ['\\info', /\\info\s*\{/g],
      ['apartados', /\\begin\s*\{apartados\}/g],
    ].map(([name, pattern]) => `${name}: ${countMatches(exerciseForGeneration, pattern)}`).join(', ')
    let experimentalStrategy = ''
    if (experimental) {
      console.info('OpenRouter experimental variation analysis started', { model })
      const analysisResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            { role: 'system', content: analysisSystemPrompt },
            { role: 'user', content: exerciseForGeneration },
          ],
          response_format: exerciseAnalysisResponseFormat,
          provider: { require_parameters: true, data_collection: 'deny' },
          max_tokens: 1_500,
        }),
        signal: AbortSignal.timeout(Math.max(1, 40_000 - (Date.now() - startedAt))),
      })
      const analysisPayload = await analysisResponse.json().catch(() => ({}))
      const analysisContent = analysisResponse.ok ? choiceContent(analysisPayload.choices?.[0]) : ''
      if (!analysisContent) {
        throw new HttpsError('unavailable', analysisPayload.error?.message || 'La IA no ha podido analizar el ejercicio base.')
      }
      const analysis = JSON.parse(analysisContent)
      experimentalStrategy = `ANÁLISIS DIDÁCTICO DEL EJERCICIO BASE:\n- Núcleo: ${analysis.core}\n- Destrezas: ${analysis.skills.join('; ')}\n- Dificultad: ${analysis.difficulty}\n- Esquema de solución: ${analysis.solutionOutline}\n- Elementos que deben mantenerse: ${analysis.invariants.join('; ')}\n\nPLAN OBLIGATORIO DE TRANSFORMACIÓN ESTRUCTURAL:\n${analysis.transformationPlan}\n\nNo hagas un cambio cosmético ni solo numérico. Aplica ese plan y comprueba que el resultado sea claramente distinto al original, pero de dificultad y extensión comparables.`
    }
    const originalRequest = [
      `ETIQUETAS: ${tags.length ? tags.join(', ') : 'sin etiquetas'}`,
      `CONTRATO DE ESTRUCTURA: ${structureSummary}. Conserva exactamente esas cantidades cuando sean mayores que cero.`,
      solutionRequirement,
      infoRequirement,
      experimentalStrategy,
      'EJERCICIO ORIGINAL:',
      exerciseForGeneration,
      variaciones.length ? `VARIACIONES YA EXISTENTES (no repetir):\n${variaciones.join('\n\n---\n\n')}` : '',
    ].filter(Boolean).join('\n\n')
    let variation = null
    let validationIssues = []

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const repairRequest = attempt === 2
        ? String.raw`CORRIGE EL SIGUIENTE BORRADOR. No simplifiques ni elimines comandos LaTeX.

PROBLEMAS DETECTADOS:
${validationIssues.join('\n')}

BORRADOR INVÁLIDO:
${variation?.enunciado || ''}`
        : ''
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [originalRequest, repairRequest].filter(Boolean).join('\n\n') },
          ],
          response_format: variationResponseFormat,
          provider: {
            require_parameters: true,
            data_collection: 'deny',
          },
          max_tokens: 6_000,
        }),
        signal: AbortSignal.timeout(Math.max(1, 105_000 - (Date.now() - startedAt))),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        console.error('OpenRouter variation request rejected', {
          model,
          attempt,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          providerMessage: payload.error?.message,
        })
        throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
      }

      const choice = payload.choices?.[0]
      const rawContent = choice?.message?.content
      const content = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
          : ''
      variation = content ? JSON.parse(content) : null
      if (!variation?.enunciado?.trim()) {
        console.error('OpenRouter variation response had no usable content', {
          model,
          attempt,
          elapsedMs: Date.now() - startedAt,
          finishReason: choice?.finish_reason,
          contentType: Array.isArray(rawContent) ? 'array' : typeof rawContent,
          reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
          completionTokens: payload.usage?.completion_tokens,
        })
        throw new HttpsError('internal', 'La IA terminó sin generar el ejercicio. Prueba de nuevo o selecciona otro modelo.')
      }

      variation.enunciado = compactAlignedChains(stripLegacySolutionCommands(variation.enunciado.trim()))
      validationIssues = validateLatexVariation(exerciseForGeneration, variation.enunciado, expectedInfo)
      if (experimental && !variation.enunciado.includes(`\\info{${expectedInfo}}`)) {
        validationIssues.push(`La variación experimental debe terminar con \\info{${expectedInfo}}.`)
      }
      if (solutionEnvironmentCount) validationIssues.push(...validateSolutionLayout(variation.enunciado))
      validationIssues = [...new Set(validationIssues)]
      if (!validationIssues.length) break
      console.warn('OpenRouter variation failed LaTeX validation', {
        model,
        attempt,
        elapsedMs: Date.now() - startedAt,
        issues: validationIssues,
      })
    }

    if (validationIssues.length) {
      throw new HttpsError('internal', `La IA no ha conservado la estructura LaTeX: ${validationIssues[0]}`)
    }

    console.info('OpenRouter variation request completed', {
      model,
      elapsedMs: Date.now() - startedAt,
      outputCharacters: variation.enunciado.length,
    })

    return {
      enunciado: variation.enunciado.trim(),
      model,
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') {
      console.error('OpenRouter variation request timed out', { model, elapsedMs: Date.now() - startedAt })
      throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en responder. Prueba de nuevo o selecciona otro modelo.')
    }
    console.error('OpenRouter variation generation failed', { model, elapsedMs: Date.now() - startedAt, error })
    throw new HttpsError('internal', 'No se ha podido generar la variación con IA.')
  }
})

export const generateExerciseSolution = onCall({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memory: '512MiB',
  secrets: [openRouterApiKey],
  enforceAppCheck: true,
}, async (request) => {
  const startedAt = Date.now()
  const enunciado = typeof request.data?.enunciado === 'string' ? request.data.enunciado.trim() : ''
  const model = typeof request.data?.model === 'string' ? request.data.model : 'google/gemini-3-flash-preview'
  const previousAttempt = typeof request.data?.previousAttempt === 'string' ? request.data.previousAttempt.trim().slice(0, 60_000) : ''
  const compileError = typeof request.data?.compileError === 'string' ? request.data.compileError.trim().slice(0, 2_000) : ''

  if (!enunciado || enunciado.length > 60_000) {
    throw new HttpsError('invalid-argument', 'El enunciado es obligatorio y no puede superar 60.000 caracteres.')
  }
  if (!Object.hasOwn(aiModels, model)) {
    throw new HttpsError('invalid-argument', 'El modelo de IA seleccionado no está permitido.')
  }
  if (/\\begin\s*\{solucion\}/.test(enunciado)) {
    throw new HttpsError('failed-precondition', 'Esta variante ya tiene una solución.')
  }

  const exerciseForSolution = stripLegacySolutionCommands(enunciado)
  const expectedInfo = infoContent(exerciseForSolution) || `Generado por ${aiModels[model].label}`
  try {
    console.info('OpenRouter solution request started', { model, inputCharacters: exerciseForSolution.length })
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey.value()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neope.web.app',
        'X-Title': 'Neope',
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
        messages: [
          { role: 'system', content: solutionSystemPrompt },
          {
            role: 'user',
            content: `REGLA OBLIGATORIA PARA \\info: usa exactamente \\info{${expectedInfo}} y sitúalo como último comando del ejercicio.\n\nEJERCICIO A RESOLVER:\n\n${exerciseForSolution}${previousAttempt ? `\n\nINTENTO ANTERIOR NO COMPILABLE: corrige este intento, conservando el enunciado y su solución matemática, pero reescribiendo el LaTeX defectuoso. No expliques el error; devuelve solamente el ejercicio completo compilable.\nERROR DEL COMPILADOR:\n${compileError || 'Error de sintaxis LaTeX.'}\n\nINTENTO A REPARAR:\n${previousAttempt}` : ''}`,
          },
        ],
        response_format: solutionResponseFormat,
        provider: {
          require_parameters: true,
          data_collection: 'deny',
        },
        max_tokens: 6_000,
      }),
      signal: AbortSignal.timeout(105_000),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('OpenRouter solution request rejected', {
        model,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        providerMessage: payload.error?.message,
      })
      throw new HttpsError('unavailable', payload.error?.message || `OpenRouter ha respondido con HTTP ${response.status}.`)
    }

    const content = choiceContent(payload.choices?.[0])
    let solvedExercise = content ? compactAlignedChains(stripLegacySolutionCommands(JSON.parse(content)?.enunciado?.trim() || '')) : ''
    if (!solvedExercise) {
      throw new HttpsError('internal', 'La IA terminó sin generar el ejercicio resuelto.')
    }
    let latexIssues = [...new Set([
      ...validateSolvedExercise(exerciseForSolution, solvedExercise, expectedInfo),
      ...validateSolutionLayout(solvedExercise),
    ])]
    const needsLayoutRepair = latexIssues.includes('Una fila de aligned no puede contener dos matrices o determinantes compactos.')
      || latexIssues.includes('No se puede usar el entorno center dentro de una solución.')
      || latexIssues.includes('Todos los delimitadores $ de modo matemático deben estar emparejados.')
    if (needsLayoutRepair) {
      console.info('OpenRouter solution layout repair started', { model })
      const repairResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterApiKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://neope.web.app',
          'X-Title': 'Neope',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: aiModels[model].reasoningEffort, exclude: true },
          messages: [
            {
              role: 'system',
              content: String.raw`Eres un maquetador profesional de ejercicios de Matemáticas. Devuelve el ejercicio LaTeX completo que recibes, preservando literalmente su enunciado, sus resultados, los entornos solucion y la orden final \info. Solo corrige su composición para una columna útil de 8 cm: dentro de aligned nunca pueden aparecer dos matrices, determinantes o sistemas en una misma fila; reescribe los productos largos mediante nombres intermedios y una sola matriz resultado por fila. Conserva los entornos compactos matrizp, detp y sistemap. Dentro de solucion no uses center, figure ni flotantes: si hay tikzpicture, céntralo con \noindent\hfill antes y \hfill\mbox{}\par después. Todo comando matemático debe estar dentro de $...$ o $$...$$ y cada $ debe estar emparejado, también dentro de TikZ. Devuelve solo LaTeX, sin Markdown.`,
            },
            { role: 'user', content: `RECOMPÓN ESTE EJERCICIO. Defectos detectados: ${latexIssues.join(' ')}\n\n${solvedExercise}` },
          ],
          response_format: solutionResponseFormat,
          provider: { require_parameters: true, data_collection: 'deny' },
          max_tokens: 6_000,
        }),
        signal: AbortSignal.timeout(45_000),
      })
      const repairPayload = await repairResponse.json().catch(() => ({}))
      const repairContent = repairResponse.ok ? choiceContent(repairPayload.choices?.[0]) : ''
      const repairedExercise = repairContent ? compactAlignedChains(stripLegacySolutionCommands(JSON.parse(repairContent)?.enunciado?.trim() || '')) : ''
      if (repairedExercise) {
        solvedExercise = repairedExercise
        latexIssues = [...new Set([
          ...validateSolvedExercise(exerciseForSolution, solvedExercise, expectedInfo),
          ...validateSolutionLayout(solvedExercise),
        ])]
      }
    }
    if (latexIssues.length) {
      throw new HttpsError('internal', `El ejercicio resuelto generado no cumple el formato: ${latexIssues[0]}`)
    }

    console.info('OpenRouter solution request completed', {
      model,
      elapsedMs: Date.now() - startedAt,
      outputCharacters: solvedExercise.length,
    })
    return { enunciado: solvedExercise, model }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error?.name === 'TimeoutError') {
      console.error('OpenRouter solution request timed out', { model, elapsedMs: Date.now() - startedAt })
      throw new HttpsError('deadline-exceeded', 'La IA ha tardado demasiado en generar la solución.')
    }
    console.error('OpenRouter solution generation failed', { model, elapsedMs: Date.now() - startedAt, error })
    throw new HttpsError('internal', 'No se ha podido generar la solución con IA.')
  }
})
