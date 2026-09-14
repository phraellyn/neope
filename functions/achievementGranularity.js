function normalizedCourse(course) {
  return String(course || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isLowerSecondaryCourse(course) {
  return /(?:^|\s)[123]\s*(?:\.?[ºo])?\s*ESO(?:\s|$)/i.test(normalizedCourse(course))
}

export function achievementGranularityInstructions(course) {
  const normalized = normalizedCourse(course)

  if (isLowerSecondaryCourse(normalized)) {
    return `GRANULARIDAD DE LOS LOGROS PARA ${normalized || '1.º–3.º ESO'}:
- En 1.º, 2.º y 3.º ESO descompón cada procedimiento en las destrezas matemáticas observables y corregibles que lo forman. En estos cursos interesa distinguir dónde se produce el error, no resumir todo el procedimiento en un único logro.
- Si una tarea contiene varias operaciones cognitivas independientes, crea un logro para cada una. No unas en una misma descripción acciones como plantear, reducir, operar, comprobar o simplificar.
- Una descripción que coordine con «y» dos acciones evaluables distintas es una señal de que debes separarla.
- Para una suma de fracciones valorada en 1 punto que exija común denominador, operación y simplificación, el desglose esperado es: «Reduce a común denominador» (0,25), «Opera correctamente» (0,50) y «Simplifica el resultado» (0,25).
- Como orientación, una tarea de al menos 0,75 puntos con dos o más pasos matemáticos separables suele requerir entre 2 y 4 logros. No fragmentes gestos puramente mecánicos sin valor evaluativo ni puntúes dos veces la misma evidencia.
- Prefiere repartos sencillos en cuartos de punto cuando la puntuación total lo permita. La suma debe seguir coincidiendo exactamente con la puntuación del segmento.`
  }

  if (/4\s*(?:\.?[ºo])?\s*ESO|BTO|BACHILLERATO/i.test(normalized)) {
    return `GRANULARIDAD DE LOS LOGROS PARA ${normalized || '4.º ESO o Bachillerato'}:
- En 4.º ESO y Bachillerato utiliza logros más integrados, asociados a etapas matemáticas sustantivas de la resolución. No disecciones de forma artificial cada manipulación algebraica elemental.
- Separa los logros cuando el enunciado pida tareas independientes o cuando haya decisiones, planteamientos, cálculos o conclusiones que aporten evidencias claramente distintas. Como orientación suelen bastar entre 1 y 3 logros por segmento.
- Ningún logro debe mezclar tareas explícitamente independientes ni puntuar dos veces la misma evidencia. La suma debe coincidir exactamente con la puntuación del segmento.`
  }

  return `GRANULARIDAD DE LOS LOGROS:
- Ajusta el desglose al nivel del curso. Separa las operaciones cognitivas que puedan corregirse de forma independiente, sin fragmentar gestos mecánicos ni puntuar dos veces la misma evidencia.
- Ningún logro debe mezclar tareas explícitamente independientes. La suma debe coincidir exactamente con la puntuación del segmento.`
}
