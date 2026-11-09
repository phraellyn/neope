import { jsPDF } from 'jspdf'

const COLUMNS = 5
const ROWS = 6
const PAGE_CAPACITY = COLUMNS * ROWS
const CODE_PATTERN = /^[A-HJ-NP-Za-km-z1-9]{6}$/

// All input comes from the gradebook's local state. No network or server API is
// used to associate names and codes or to construct the PDF.
export function createStudentAccessCardsPdf(students, fontBase64) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  pdf.addFileToVFS('DejaVuSans.ttf', fontBase64)
  pdf.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal')
  pdf.setFont('DejaVuSans', 'normal')
  const font = pdf.internal.getFont().metadata
  const cards = []
  const omitted = []
  for (const student of Array.isArray(students) ? students : []) {
    let code = ''
    try {
      code = typeof student?.id === 'string' ? student.id : ''
      const name = typeof student?.nombre === 'string' ? student.nombre.trim().normalize('NFC') : ''
      const supported = name && [...name].every((character) => {
        const codePoint = character.codePointAt(0)
        return codePoint >= 32 && codePoint <= 0xffff && font.characterToGlyph(codePoint) > 0
      })
      if (!CODE_PATTERN.test(code) || !name || name === code || !supported) {
        omitted.push(code || '(sin código)')
        continue
      }
      let lines = []
      let size = 10
      for (; size >= 5; size -= 0.5) {
        pdf.setFontSize(size)
        lines = pdf.splitTextToSize(name, 34)
        if (lines.length * size * 1.2 * 25.4 / 72 <= 19) break
      }
      if (size < 5) { omitted.push(code); continue }
      cards.push({ code, lines, size })
    } catch {
      omitted.push(code || '(sin código)')
    }
  }
  if (!cards.length) return { pdf: null, omitted, count: 0 }

  const marginX = 10
  const marginY = 12
  const width = (210 - 2 * marginX) / COLUMNS
  const height = (297 - 2 * marginY) / ROWS
  cards.forEach((card, index) => {
    const position = index % PAGE_CAPACITY
    if (index > 0 && position === 0) pdf.addPage('a4', 'portrait')
    const x = marginX + (position % COLUMNS) * width
    const y = marginY + Math.floor(position / COLUMNS) * height
    pdf.setDrawColor(184, 195, 207)
    pdf.setLineWidth(0.12)
    pdf.rect(x, y, width, height)
    pdf.setTextColor(37, 54, 75)
    pdf.setFontSize(card.size)
    pdf.text(card.lines, x + width / 2, y + 7, { align: 'center', lineHeightFactor: 1.2 })
    pdf.setTextColor(100, 113, 130)
    pdf.setFontSize(7)
    pdf.text('Código de acceso', x + width / 2, y + 32, { align: 'center' })
    pdf.setTextColor(30, 64, 105)
    pdf.setFontSize(15)
    pdf.text(card.code, x + width / 2, y + 39, { align: 'center' })
  })
  return { pdf, omitted, count: cards.length }
}
