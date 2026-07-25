export const mathCurriculum = Object.freeze([
  { course: '1ºESO', subjects: [{ id: '1eso-matematicas', title: 'Matemáticas' }] },
  { course: '2ºESO', subjects: [{ id: '2eso-matematicas', title: 'Matemáticas' }] },
  { course: '3ºESO', subjects: [{ id: '3eso-matematicas', title: 'Matemáticas' }] },
  {
    course: '4ºESO',
    subjects: [
      { id: '4eso-matematicas-a', title: 'Matemáticas A' },
      { id: '4eso-matematicas-b', title: 'Matemáticas B' },
    ],
  },
  {
    course: '1ºBTO',
    stageStart: true,
    subjects: [
      { id: '1bto-matematicas-i', title: 'Matemáticas I' },
      { id: '1bto-matematicas-ccss-i', title: 'Matemáticas CC.SS. I' },
    ],
  },
  {
    course: '2ºBTO',
    subjects: [
      { id: '2bto-matematicas-ii', title: 'Matemáticas II' },
      { id: '2bto-matematicas-ccss-ii', title: 'Matemáticas CC.SS. II' },
    ],
  },
])

export const mathSubjects = Object.freeze(mathCurriculum.flatMap((row) => (
  row.subjects.map((subject) => ({ ...subject, course: row.course }))
)))

export function normalizeHierarchySelection(nodes, selectedIds) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const normalizedIds = new Set()
  selectedIds.forEach((selectedId) => {
    let currentId = nodesById.has(selectedId) ? selectedId : null
    while (currentId) {
      normalizedIds.add(currentId)
      currentId = nodesById.get(currentId)?.parentId || null
    }
  })
  return [...normalizedIds]
}

export function toggleHierarchySelection(nodes, selectedIds, nodeId) {
  const nextIds = new Set(selectedIds)
  if (nextIds.has(nodeId)) {
    const removedIds = new Set([nodeId])
    let foundDescendants = true
    while (foundDescendants) {
      foundDescendants = false
      nodes.forEach((node) => {
        if (!removedIds.has(node.id) && removedIds.has(node.parentId)) {
          removedIds.add(node.id)
          foundDescendants = true
        }
      })
    }
    removedIds.forEach((id) => nextIds.delete(id))
    return [...nextIds]
  }
  return normalizeHierarchySelection(nodes, [...nextIds, nodeId])
}
