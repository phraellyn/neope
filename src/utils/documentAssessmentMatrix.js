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

// Los criterios pertenecen al ejercicio original; el documento puede asignar
// otra puntuación al mismo apartado. Repartimos cuartos de punto según los
// pesos relativos, conservando los IDs y la suma total del apartado.
function documentPoints(achievements, metric) {
  if (metric === undefined || metric === null || metric === '') return achievements
  const target = Number(metric)
  const total = achievements.reduce((sum, item) => sum + Math.max(0, Number(item.points) || 0), 0)
  if (!Number.isFinite(target) || target < 0 || !total) return achievements
  const units = Math.round(target * 4)
  const shares = achievements.map((item) => Math.max(0, Number(item.points) || 0) / total * units)
  const rounded = shares.map(Math.floor)
  const remaining = units - rounded.reduce((sum, value) => sum + value, 0)
  const indices = shares.map((share, index) => ({ index, fraction: share - rounded[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let i = 0; i < remaining; i += 1) rounded[indices[i].index] += 1
  return achievements.map((item, index) => ({ ...item, points: rounded[index] / 4 }))
}

export function assessmentExerciseModel({ exerciseId, sourceBlockId = '', version = 0, structure = {}, assessment = {}, metrics = null, order = 0, label: exerciseLabel = '', selectivityQuestionThree = false }) {
  const parts = Array.isArray(structure.apartados) ? structure.apartados : []
  const label = exerciseLabel || `Ejercicio ${order + 1}`
  const feedbackKey = (section) => JSON.stringify([sourceBlockId || `${exerciseId}:${version}:${order}`, section])

  if (!parts.length) {
    const achievements = achievementRows(
      documentPoints(assessmentAchievements(assessment, 'exercise', structure.gradingCriteria), metrics?.puntuacion),
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
        feedbackKey: feedbackKey('general'),
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
    const partLabel = `Apartado ${selectivityQuestionThree && parts.length === 3 ? ['a', 'b1', 'b2'][index] : String.fromCharCode(97 + index)}`
    return {
      key: partKey,
      feedbackKey: feedbackKey(partKey),
      kind: 'part',
      label: partLabel,
      pdf: text(part.pdfsolucion),
      achievements: achievementRows(
        documentPoints(assessmentAchievements(assessment, partKey, part.gradingCriteria), metrics?.apartados?.[index]?.puntuacion),
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
