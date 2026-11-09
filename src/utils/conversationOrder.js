const priority = { pending: 0, waiting: 0, resolved: 1, dismissed: 2 }

export function orderedConversations(messages) {
  return [...(Array.isArray(messages) ? messages : [])].sort((a, b) => {
    const stateDifference = (priority[a?.status] ?? 0) - (priority[b?.status] ?? 0)
    if (stateDifference) return stateDifference
    return String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''))
      || String(b?.id || '').localeCompare(String(a?.id || ''))
  })
}
