// Resumen operativo del currículo vigente en la Comunidad de Madrid.
// Fuentes: Decreto 65/2022 (ESO), Decreto 64/2022 (Bachillerato) y
// Decreto 59/2024, que modifica ambos. El objetivo no es reproducir la norma,
// sino convertirla en límites didácticos breves y útiles para los prompts.

export const curriculumSources = Object.freeze({
  eso: 'Decreto 65/2022, de 20 de julio, de la Comunidad de Madrid',
  bachillerato: 'Decreto 64/2022, de 20 de julio, de la Comunidad de Madrid',
  amendment: 'Decreto 59/2024, de 12 de junio, de la Comunidad de Madrid',
})

const profiles = {
  '1eso-matematicas': {
    course: '1ºESO',
    subject: 'Matemáticas',
    age: '12-13 años',
    source: curriculumSources.eso,
    scope: [
      'números naturales, enteros, fracciones y decimales; representación, orden, estimación y operaciones',
      'divisibilidad, factorización, máximo común divisor, mínimo común múltiplo, potencias de exponente natural y raíces cuadradas exactas',
      'razones, proporcionalidad directa, porcentajes y problemas cotidianos sencillos',
      'iniciación al lenguaje algebraico, patrones y ecuaciones lineales elementales',
      'medidas, perímetros, áreas, ángulos, figuras planas y cuerpos geométricos básicos',
      'tablas, gráficas sencillas, estadística descriptiva elemental y probabilidad intuitiva o mediante la regla de Laplace en casos simples',
    ],
    pedagogy: 'Enunciados claros, relaciones directas y pocos pasos. Introduce cada símbolo y evita exigir abstracciones no asentadas.',
    avoid: 'No uses trigonometría formal, logaritmos, matrices, vectores analíticos, límites, derivadas, integrales ni técnicas propias de cursos posteriores.',
  },
  '2eso-matematicas': {
    course: '2ºESO',
    subject: 'Matemáticas',
    age: '13-14 años',
    source: curriculumSources.eso,
    scope: [
      'enteros, fracciones, decimales, raíces y notación científica; estimación y jerarquía de operaciones',
      'proporcionalidad directa e inversa, repartos, porcentajes encadenados, escalas y educación financiera cotidiana',
      'expresiones algebraicas, identidades sencillas, ecuaciones de primer y segundo grado elementales y sistemas lineales sencillos',
      'semejanza, teorema de Pitágoras, áreas y volúmenes de figuras y cuerpos habituales',
      'relaciones funcionales, tablas y gráficas; funciones lineales y afines en contextos accesibles',
      'estadística unidimensional y probabilidad de experimentos simples y compuestos muy sencillos',
    ],
    pedagogy: 'Admite problemas de varios pasos moderados, siempre con datos interpretables y procedimientos propios del primer ciclo de ESO.',
    avoid: 'No uses trigonometría avanzada, logaritmos como técnica de cálculo, matrices, geometría vectorial, límites, derivadas ni integrales.',
  },
  '3eso-matematicas': {
    course: '3ºESO',
    subject: 'Matemáticas',
    age: '14-15 años',
    source: curriculumSources.eso,
    scope: [
      'números reales, intervalos, notación científica, error absoluto y relativo, radicales, potencias de exponente entero e introducción a logaritmos',
      'polinomios, identidades, ecuaciones e inecuaciones, sistemas lineales y sucesiones o patrones',
      'proporcionalidad, porcentajes sucesivos e interés en contextos cotidianos',
      'geometría plana y espacial, semejanza, transformaciones, coordenadas y resolución métrica de problemas',
      'funciones lineales, cuadráticas y otras familias elementales; interpretación y representación mediante propiedades visibles',
      'estadística de una y dos variables, recuento, frecuencia, probabilidad condicionada elemental y diagramas de árbol',
    ],
    pedagogy: 'Puede exigir razonamiento encadenado y justificación, pero debe mantener una carga algebraica y un grado de abstracción propios de 3ºESO.',
    avoid: 'No resuelvas mediante cálculo diferencial o integral, matrices, geometría analítica vectorial de Bachillerato ni resultados formales avanzados.',
  },
  '4eso-matematicas-a': {
    course: '4ºESO',
    subject: 'Matemáticas A',
    age: '15-16 años',
    source: curriculumSources.eso,
    scope: [
      'números reales, proporcionalidad, porcentajes, intereses y resolución numérica en contextos aplicados',
      'álgebra funcional para ecuaciones, inecuaciones y sistemas vinculados a situaciones reales',
      'semejanza, trigonometría básica, medida y geometría aplicada',
      'funciones elementales y a trozos; interpretación de dominio, crecimiento, extremos y tasas de variación desde tablas y gráficas',
      'estadística, correlación elemental, recuento y probabilidad en situaciones cotidianas',
      'modelización, interpretación crítica y uso razonable de herramientas digitales',
    ],
    pedagogy: 'Prioriza resolución de problemas, investigación e interpretación de situaciones de la vida cotidiana sobre el formalismo algebraico.',
    avoid: 'No uses límites formales, derivadas, integrales, matrices ni geometría vectorial de Bachillerato como método de resolución.',
  },
  '4eso-matematicas-b': {
    course: '4ºESO',
    subject: 'Matemáticas B',
    age: '15-16 años',
    source: curriculumSources.eso,
    scope: [
      'números reales, radicales, potencias racionales, logaritmos, intervalos y cálculo algebraico riguroso',
      'polinomios, ecuaciones, inecuaciones y sistemas; modelización algebraica en contextos matemáticos y científicos',
      'trigonometría, teoremas del seno y coseno, semejanza y geometría analítica elemental en el plano',
      'funciones polinómicas, racionales, exponenciales, logarítmicas y a trozos; propiedades, representación y tasa de variación media',
      'combinatoria, estadística, correlación y probabilidad simple, compuesta y condicionada',
      'conjeturas, generalización y argumentación con un nivel preacadémico, sin adelantar cálculo infinitesimal',
    ],
    pedagogy: 'Admite mayor profundidad algebraica, geométrica y estadística que Matemáticas A, pero conserva métodos accesibles al final de ESO.',
    avoid: 'No uses límites formales, derivadas, integrales, matrices, determinantes ni geometría vectorial de Bachillerato.',
  },
  '1bto-matematicas-i': {
    course: '1ºBTO',
    subject: 'Matemáticas I',
    age: '16-17 años',
    source: curriculumSources.bachillerato,
    scope: [
      'números reales y complejos, radicales y logaritmos; vectores en el plano',
      'trigonometría completa, resolución de triángulos, teoremas del seno y coseno e identidades trigonométricas',
      'geometría analítica afín y métrica del plano: rectas, posiciones, ángulos, distancias, simetrías y lugares geométricos sencillos',
      'ecuaciones, inecuaciones y sistemas; funciones polinómicas, racionales, irracionales, exponenciales, logarítmicas, trigonométricas y a trozos',
      'límites, continuidad, asíntotas, derivada y sus aplicaciones a tangentes, crecimiento y extremos relativos',
      'estadística bidimensional, regresión, probabilidad condicionada, probabilidad total y Bayes',
    ],
    pedagogy: 'Usa razonamiento y lenguaje formal de Bachillerato, con contextos científicos y tecnológicos y desarrollos de dificultad propia de primer curso.',
    avoid: 'No uses matrices, determinantes, geometría analítica tridimensional, regla de L’Hôpital, integración ni contenidos específicos de Matemáticas II.',
  },
  '2bto-matematicas-ii': {
    course: '2ºBTO',
    subject: 'Matemáticas II',
    age: '17-18 años',
    source: curriculumSources.bachillerato,
    scope: [
      'vectores y matrices, determinantes, rango, matriz inversa, sistemas lineales, Rouché-Frobenius y regla de Cramer',
      'geometría analítica tridimensional: rectas, planos, posiciones relativas, ángulos, distancias, simetrías y productos escalar, vectorial y mixto',
      'límites, continuidad, derivabilidad, regla de L’Hôpital, representación de funciones, optimización y teoremas de Bolzano, Rolle y valor medio',
      'primitivas, integral definida, regla de Barrow, áreas y volúmenes de revolución; integración elemental por sustitución y por partes',
      'probabilidad condicionada, total y Bayes; distribuciones binomial y normal y aproximación normal',
      'modelización rigurosa en contextos científicos y tecnológicos',
    ],
    pedagogy: 'Admite razonamientos formales, problemas largos y conexiones entre álgebra lineal, geometría, análisis y probabilidad al nivel final de Bachillerato.',
    avoid: 'No introduzcas teoría universitaria: diagonalización general, espacios vectoriales abstractos, cálculo multivariable, ecuaciones diferenciales o inferencia avanzada.',
  },
  '1bto-matematicas-ccss-i': {
    course: '1ºBTO',
    subject: 'Matemáticas Aplicadas a las Ciencias Sociales I',
    age: '16-17 años',
    source: curriculumSources.bachillerato,
    scope: [
      'números reales, potencias, raíces, logaritmos y matemática financiera',
      'ecuaciones, inecuaciones y sistemas; modelización de situaciones sociales y económicas',
      'funciones polinómicas, racionales, irracionales, exponenciales, logarítmicas y a trozos',
      'límites, continuidad, asíntotas, derivada, tangente, crecimiento y extremos relativos en contextos de ciencias sociales',
      'estadística unidimensional y bidimensional, regresión y correlación',
      'combinatoria, probabilidad condicionada, probabilidad total, Bayes y distribuciones binomial y normal con apoyo tecnológico',
    ],
    pedagogy: 'Prioriza interpretación, modelización y toma de decisiones en contextos económicos, demográficos y sociales, con rigor de primer curso.',
    avoid: 'No uses trigonometría científica avanzada, geometría vectorial, integración, programación lineal ni técnicas específicas de segundo curso salvo que el original las exija explícitamente.',
  },
  '2bto-matematicas-ccss-ii': {
    course: '2ºBTO',
    subject: 'Matemáticas Aplicadas a las Ciencias Sociales II',
    age: '17-18 años',
    source: curriculumSources.bachillerato,
    scope: [
      'matrices, determinantes, inversa, rango y sistemas lineales; Rouché-Frobenius y Cramer en dimensión moderada',
      'programación lineal de dos variables y modelización matricial de situaciones sociales',
      'límites, continuidad, derivabilidad, regla de L’Hôpital, representación, optimización y teoremas básicos del análisis',
      'primitivas inmediatas, integral definida, regla de Barrow y cálculo de áreas',
      'probabilidad condicionada, total y Bayes; distribuciones binomial y normal',
      'interpretación y modelización de problemas económicos, demográficos y sociales',
    ],
    pedagogy: 'Exige argumentación y lectura crítica de resultados, manteniendo el enfoque aplicado a ciencias sociales propio del final de Bachillerato.',
    avoid: 'No uses geometría vectorial tridimensional, trigonometría científica avanzada, volúmenes de revolución, álgebra abstracta ni cálculo universitario.',
  },
}

export const curriculumProfiles = Object.freeze(Object.fromEntries(
  Object.entries(profiles).map(([id, profile]) => [id, Object.freeze({
    ...profile,
    scope: Object.freeze([...profile.scope]),
  })]),
))

function cleanConceptPaths(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map((path) => (
    Array.isArray(path)
      ? path.slice(0, 8).map((part) => String(part || '').trim().slice(0, 100)).filter(Boolean)
      : []
  )).filter((path) => path.length)
}

export function curriculumPromptContext(value) {
  const subjectId = typeof value?.subjectId === 'string' ? value.subjectId : ''
  const profile = curriculumProfiles[subjectId]
  if (!profile) return ''

  const paths = cleanConceptPaths(value?.conceptPaths)
  const concepts = paths.length
    ? paths.map((path) => `- ${path.join(' > ')}`).join('\n')
    : '- No se han especificado conceptos concretos; usa el ejercicio original como foco dentro de este currículo.'

  return `MARCO CURRICULAR OBLIGATORIO
Curso y materia: ${profile.course} — ${profile.subject}.
Edad orientativa: ${profile.age}.
Referencia normativa: ${profile.source}, con las modificaciones vigentes.
Contenidos y técnicas disponibles en este nivel:
${profile.scope.map((item) => `- ${item}`).join('\n')}
Orientación didáctica: ${profile.pedagogy}
Límite de nivel: ${profile.avoid}
Conceptos seleccionados por el profesor (foco prioritario):
${concepts}

REGLAS DE NIVEL:
- El curso y la materia son una restricción, no una sugerencia. No introduzcas conocimientos, notación, teoremas ni métodos de cursos posteriores.
- Los conceptos seleccionados delimitan el foco; utiliza únicamente los prerrequisitos razonables ya adquiridos en ese curso o en cursos anteriores.
- Mantén la dificultad del original solo dentro de estos límites. Si el original admite varios métodos, elige el método habitual más elemental y pedagógico disponible para este alumnado.
- Ajusta vocabulario, longitud de los razonamientos, grado de abstracción y autonomía esperada a la edad indicada.`
}
