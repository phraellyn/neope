export function documentAssessmentNavigation(exercises = []) {
  return exercises.flatMap((exercise, exerciseIndex) => {
    const number = String(exercise.label || `Ejercicio ${exerciseIndex + 1}`).replace(/^(?:ejercicio|pregunta)\s+/i, '').trim()
    const items = [{ key: `${exerciseIndex}:exercise`, label: number, title: exercise.label || `Ejercicio ${number}`, exerciseIndex, rowKey: null }]
    for (const row of exercise.rows || []) {
      if (row.kind !== 'part') continue
      const part = String(row.label || '').replace(/^apartado\s+/i, '').trim().toLocaleUpperCase('es-ES')
      items.push({ key: `${exerciseIndex}:${row.key}`, label: `${number}${part}`, title: `${exercise.label} · ${row.label}`, exerciseIndex, rowKey: row.key })
    }
    return items
  })
}
