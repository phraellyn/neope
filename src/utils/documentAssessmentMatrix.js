function text(value) {
  return String(value || '').trim()
}

function achievementRows(achievements, exerciseId, version, sectionKey, sectionLabel) {
  return (Array.isArray(achievements) ? achievements : []).map((achievement, index) => ({
    ...achievement,
    key: `${exerciseId}:${version}:${sectionKey}:${achievement.id || index}`,
    section: sectionLabel,
  }))
}

/**
 * Convierte la estructura normalizada de un ejercicio en las filas que usa la
 * matriz de evaluación. Mantener esta decisión en una función pura evita que
 * la vista previa del documento y el cuaderno representen el examen de forma
 * diferente.
 */
export function assessmentExerciseModel({ exerciseId, version = 0, structure = {}, order = 0 }) {
  const parts = Array.isArray(structure.apartados) ? structure.apartados : []
  const label = `Ejercicio ${order + 1}`

  if (!parts.length) {
    const achievements = achievementRows(structure.achievements, exerciseId, version, 'general', 'Ejercicio')
    return {
      exerciseId,
      version,
      order,
      key: `${exerciseId}:${version}`,
      label,
      rows: [{
        key: 'general',
        kind: 'exercise',
        label: 'Ejercicio resuelto',
        pdf: text(structure.pdfsolucioncompleto || structure.pdfsolucion),
        achievements,
      }],
      achievements,
    }
  }

  const partRows = parts.map((part, index) => {
    const partKey = part.id || `part-${index}`
    const partLabel = `Apartado ${String.fromCharCode(97 + index)}`
    return {
      key: partKey,
      kind: 'part',
      label: partLabel,
      pdf: text(part.pdfsolucion),
      achievements: achievementRows(part.achievements, exerciseId, version, partKey, partLabel),
    }
  })
  const rows = [{
    key: 'statement',
    kind: 'statement',
    label: 'Enunciado',
    // En ejercicios con apartados la primera fila representa solo el bloque
    // común anterior a \begin{apartados}; el PDF completo repetiría debajo
    // todos los enunciados segmentados.
    pdf: text(structure.pdfenunciado || structure.pdfenunciadocompleto),
    achievements: [],
  }, ...partRows]

  return {
    exerciseId,
    version,
    order,
    key: `${exerciseId}:${version}`,
    label,
    rows,
    achievements: partRows.flatMap((row) => row.achievements),
  }
}
