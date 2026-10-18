import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { migrateDocumentTemplate, isInternalTemplate, readDocumentTemplate } from '../src/utils/documentTemplate.js'

const require = createRequire(import.meta.url)
const auth = require('firebase-tools/lib/auth')
const account = auth.getProjectDefaultAccount(process.cwd())
if (!account) throw new Error('Inicia sesión con Firebase CLI antes de actualizar las plantillas.')
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform'])
const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }
const project = JSON.parse((await import('node:fs')).readFileSync('.firebaserc', 'utf8')).projects.default
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  if (!response.ok) throw new Error(`Firestore HTTP ${response.status}: ${result.error?.message || 'error desconocido'}`)
  return result
}
const documents = []
let pageToken = ''
do {
  const page = await request(`${base}/plantillas?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`)
  documents.push(...(page.documents || []))
  pageToken = page.nextPageToken || ''
} while (pageToken)
if (process.argv.includes('--verify-internal')) {
  const previous = JSON.parse(readFileSync('Recursos de desarrollo/backups/plantillas-actuales.json', 'utf8'))
  const internalBefore = previous.find((document) => isInternalTemplate({ archivo: document.fields.archivo?.stringValue }))
  const internalAfter = documents.find((document) => isInternalTemplate({ archivo: document.fields.archivo?.stringValue }))
  if (!isDeepStrictEqual(internalBefore, internalAfter)) throw new Error(`ejercicio.tex ha cambiado desde la copia anterior (${internalBefore?.updateTime} -> ${internalAfter?.updateTime}).`)
  console.log('Verificado: ejercicio.tex permanece idéntica, incluidos los metadatos de Firestore.')
}
if (process.argv.includes('--export')) {
  mkdirSync('Recursos de desarrollo/backups', { recursive: true })
  writeFileSync('Recursos de desarrollo/backups/plantillas-actuales.json', JSON.stringify(documents, null, 2))
  console.log('Copia local: Recursos de desarrollo/backups/plantillas-actuales.json')
}
const updates = []
for (const document of documents) {
  const fields = document.fields || {}
  const template = { archivo: fields.archivo?.stringValue || '', nombre: fields.nombre?.stringValue || '', codigo: fields.codigo?.stringValue || '' }
  if (process.argv.includes('--configure') && !isInternalTemplate(template)) {
    // One-time preparation of the project's existing templates. Ordinary loads
    // leave explicit version 2 declarations alone.
    template.codigo = template.codigo.replace(/^\s*%\s*neope:document\s+(\{.*\})\s*$/m, (_, json) => `% neope:document ${JSON.stringify({ ...JSON.parse(json), version: 1 })}`)
    template.codigo = template.codigo.replace(/^\s*%%%\s*(?:previo|final):[^\r\n]*$/gmi, '')
    // An accidentally uncommented line from the editor's help example opens
    // a macro whose body is entirely commented out.
    template.codigo = template.codigo.replace(/^\\newcommand\{\\logo\}\[4\]\{\r?\n(?=%\s+\\textbf\{#1\})/m, '% \\newcommand{\\logo}[4]{\n')
  }
  const upgraded = migrateDocumentTemplate(template)
  const metadata = isInternalTemplate(template) ? null : readDocumentTemplate(upgraded.codigo)
  console.log(`${template.nombre} (${template.archivo}): ${metadata ? `${metadata.content}, ${metadata.fields.map((field) => field.key).join(', ')}` : 'interna, sin cambios'}${upgraded.migrated ? ' [pendiente]' : ''}`)
  if (upgraded.codigo !== fields.codigo?.stringValue) updates.push({ document, codigo: upgraded.codigo })
  if (process.argv.includes('--export') && !isInternalTemplate(template)) {
    mkdirSync('templates', { recursive: true })
    const fileName = template.archivo.replace(/[^A-Za-z0-9_.-]/g, '-')
    writeFileSync(`templates/${fileName}`, upgraded.codigo)
  }
  if (process.argv.includes('--sync-compiler') && !isInternalTemplate(template)) {
    const response = await fetch('http://51.170.57.25:5000/v1/preambles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: template.archivo, content: upgraded.codigo }), signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Servidor LaTeX (${template.archivo}): HTTP ${response.status}`)
    console.log(`Sincronizada con LaTeX: ${template.archivo}`)
  }
}
if (process.argv.includes('--apply') && updates.length) {
  mkdirSync('Recursos de desarrollo/backups', { recursive: true })
  const backupPath = `Recursos de desarrollo/backups/plantillas-${Date.now()}.json`
  writeFileSync(backupPath, JSON.stringify(updates.map(({ document }) => document), null, 2))
  for (const { document, codigo } of updates) {
    await request(`https://firestore.googleapis.com/v1/${document.name}?updateMask.fieldPaths=codigo&updateMask.fieldPaths=templateFormatVersion&currentDocument.updateTime=${encodeURIComponent(document.updateTime)}`, {
      method: 'PATCH', body: JSON.stringify({ fields: { codigo: { stringValue: codigo }, templateFormatVersion: { integerValue: '2' } } }),
    })
    console.log(`Actualizada: ${document.fields.nombre?.stringValue || document.name.split('/').at(-1)}`)
  }
  console.log(`Copia anterior: ${backupPath}`)
} else console.log(`${updates.length} plantillas pendientes. Usa --apply para guardarlas.`)
