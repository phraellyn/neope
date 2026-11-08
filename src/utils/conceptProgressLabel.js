export function conceptProgressLabel(entry) {
  if (!entry || !entry.worked) return 'No trabajado'
  const percentage = `${Math.round(entry.percentage)} %`
  if (entry.childCount) return `${percentage} · ${entry.workedChildCount}/${entry.childCount} contenidos trabajados${entry.provisional ? ' · provisional' : ''}`
  return `${percentage} · ${entry.count}/5 intentos${entry.provisional ? ' · provisional' : ''}`
}

// The server supplies the latest five attempts per concept. Parent evidence
// is deliberately ignored: a broad tag does not identify a practiced leaf.
export function calculateConceptProgress(nodes, evidence) {
  const children = new Map(nodes.map((node) => [node.id, []]))
  for (const node of nodes) {
    if (children.has(node.parentId) && node.parentId !== node.id) children.get(node.parentId).push(node.id)
  }
  const progress = new Map()
  function calculate(id, visiting = new Set()) {
    if (progress.has(id)) return progress.get(id)
    if (visiting.has(id)) return { percentage: 0, worked: false, provisional: false }
    const descendants = children.get(id) || []
    let result
    if (!descendants.length) {
      const source = evidence[id]
      const worked = Boolean(source && source.count > 0 && Number.isFinite(source.percentage))
      result = { ...source, count: worked ? source.count : 0, worked, provisional: worked && source.provisional, percentage: worked ? source.percentage : 0, childCount: 0, workedChildCount: 0 }
    } else {
      const next = new Set(visiting).add(id)
      const values = descendants.map((child) => calculate(child, next))
      result = { percentage: values.reduce((sum, child) => sum + child.percentage, 0) / values.length, worked: values.some((child) => child.worked), provisional: values.some((child) => child.provisional), childCount: values.length, workedChildCount: values.filter((child) => child.worked).length }
    }
    progress.set(id, result)
    return result
  }
  nodes.forEach((node) => calculate(node.id))
  return Object.fromEntries(progress)
}
