import { readFileSync } from 'node:fs'
import { readDocumentTemplate, renderTemplateWrapper, splitFinalDocumentCode } from '../src/utils/documentTemplate.js'
import { repairNestedLegacyDocument } from '../src/utils/latexDocumentSource.js'

const origin = 'http://51.170.57.25:5000/v1'
const values = { level: '2ºBTO', subject: 'Matemáticas II', title: 'Prueba de plantilla', date: '12/10/26', course: '2ºBTO B' }
const assets = { 'logo.png': { data: readFileSync('public/brand/neope-logo.png').toString('base64') } }
let failed = false
const checkLegacySource = process.argv.includes('--legacy-source')
for (const file of checkLegacySource ? ['apuntes.tex'] : ['ejercicios.tex', 'teoria.tex', 'examen-resuelto.tex', 'examenes.tex', 'apuntes.tex']) {
  const source = readFileSync(`templates/${file}`, 'utf8')
  const metadata = readDocumentTemplate(source)
  const name = `neope-check-${Date.now()}-${file}`
  const body = metadata.content === 'exercises' ? String.raw`\begin{ejercicios}
\ej \M{1}\\ Calcula $1+1$.
\end{ejercicios}` : 'Texto de ejemplo: $1+1=2$.'
  const legacyBody = String.raw`\input{../teoria}
\begin{document}
\begin{preview}
Texto de ejemplo: $1+1=2$.
\end{preview}
\end{document}`
  const code = repairNestedLegacyDocument([source, renderTemplateWrapper(metadata.before, metadata, (field) => values[field.key] || ''), checkLegacySource ? legacyBody : body, renderTemplateWrapper(metadata.after, metadata, (field) => values[field.key] || '')].join('\n'))
  const split = splitFinalDocumentCode(code)
  try {
    const saved = await fetch(`${origin}/preambles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: split.preamble }), signal: AbortSignal.timeout(30_000) })
    if (!saved.ok) throw new Error(`Guardar: HTTP ${saved.status}`)
    const compiled = await fetch(`${origin}/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preamble_name: name, code: split.body, assets }), signal: AbortSignal.timeout(45_000) })
    if (!compiled.ok) throw new Error(await compiled.text())
    const pdf = Buffer.from(await compiled.arrayBuffer())
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('El compilador no devolvió un PDF.')
    console.log(`${file}: PDF correcto (${pdf.length} bytes)`)
  } catch (error) {
    failed = true
    console.error(`${file}: ${error.message}`)
  } finally {
    await fetch(`${origin}/preambles/${name}`, { method: 'DELETE', signal: AbortSignal.timeout(15_000) }).catch(() => {})
  }
}
if (failed) process.exitCode = 1
