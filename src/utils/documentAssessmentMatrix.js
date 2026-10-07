function text(value) {
  return String(value || '').trim()
}

function achievementRows(achievements, exerciseId, version, sectionKey, sectionLabel, sourceBlockId = '') {
  return (Array.isArray(achievements) ? achievements : []).map((achievement, index) => ({
    ...achievement,
    key: `${exerciseId}:${version}:${sectionKey}:${achievement.id || index}`,
    exerciseId,
    sourceBlockId,
    version,
    segmentId: sectionKey === 'general' ? 'exercise' : sectionKey,
    section: sectionLabel,
  }))
}

/**
 * Convierte la estructura normalizada de un ejercicio en las filas que usa la
 * matriz de evaluación. Mantener esta decisión en una función pura evita que
 * la vista previa del documento y el cuaderno representen el examen de forma
 * diferente.
 */
function assessmentAchievements(assessment, segmentId, gradingCriteria = []) {
  const aligned = assessment?.segments?.[segmentId]
  if (Array.isArray(aligned)) return aligned
  return (Array.isArray(gradingCriteria) ? gradingCriteria : []).map((criterion) => ({
    ...criterion,
    alignment: { criterionIds: [], descriptorEvidence: [], source: 'manual' },
  }))
}

export function assessmentExerciseModel({ exerciseId, sourceBlockId = '', version = 0, structure = {}, assessment = {}, order = 0 }) {
  const parts = Array.isArray(structure.apartados) ? structure.apartados : []
  const label = `Ejercicio ${order + 1}`

  if (!parts.length) {
    const achievements = achievementRows(
      assessmentAchievements(assessment, 'exercise', structure.gradingCriteria),
      exerciseId,
      version,
      'general',
      'Ejercicio',
      sourceBlockId,
    )
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
      achievements: achievementRows(
        assessmentAchievements(assessment, partKey, part.gradingCriteria),
        exerciseId,
        version,
        partKey,
        partLabel,
        sourceBlockId,
      ),
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
