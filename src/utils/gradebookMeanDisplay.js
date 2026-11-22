const modes = new Set(['decimal', 'nearest', 'truncate', 'up'])

export function normalizeMeanDisplay(value = {}) {
  return { mode: modes.has(value?.mode) ? value.mode : 'decimal', showBoth: value?.showBoth === true }
}

export function formatGradebookMean(value, options = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return { primary: '', precise: '' }
  const number = Number(value)
  const { mode, showBoth } = normalizeMeanDisplay(options)
  const precise = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
  if (mode === 'decimal') return { primary: precise, precise: '' }
  const rounded = mode === 'nearest' ? Math.round(number) : mode === 'truncate' ? Math.trunc(number) : Math.ceil(number)
  return { primary: String(rounded), precise: showBoth ? precise : '' }
}
