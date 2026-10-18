import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { migrateDocumentTemplate } from '../src/utils/documentTemplate.js'

const files = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
if (!files.length) files.push('Recursos de desarrollo/exámenes.tex', 'Recursos de desarrollo/apuntes-neope.tex')
for (const file of files) {
  const path = resolve(file)
  const template = { archivo: basename(path), nombre: basename(path, '.tex'), codigo: readFileSync(path, 'utf8') }
  if (process.argv.includes('--configure') && basename(path) !== 'ejercicio.tex') {
    template.codigo = template.codigo.replace(/^\s*%\s*neope:document\s+(\{.*\})\s*$/m, (_, json) => `% neope:document ${JSON.stringify({ ...JSON.parse(json), version: 1 })}`)
    template.codigo = template.codigo.replace(/^\s*%%%\s*(?:previo|final):[^\r\n]*$/gmi, '')
  }
  const upgraded = migrateDocumentTemplate(template)
  if (upgraded.migrated) writeFileSync(path, upgraded.codigo, 'utf8')
  console.log(`${file}: ${upgraded.migrated ? 'actualizada al formato 2' : 'sin cambios'}`)
}
