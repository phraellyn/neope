#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const projectId = process.argv[2] || 'neope-9e229'
const gcloud = '/Users/Carlos/google-cloud-sdk/bin/gcloud'
const catalog = JSON.parse(readFileSync(new URL('../src/data/lomloeMathLaw.json', import.meta.url), 'utf8'))

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } }
  }
  return { stringValue: String(value) }
}

function write(documentPath, data) {
  return {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/${documentPath}`,
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)])),
    },
  }
}

const writes = [
  write('law/lomloe', { ...catalog.global, catalogVersion: '2022-1' }),
  ...Object.entries(catalog.subjects).map(([subjectId, subjectCatalog]) => (
    write(`especialidades/Matemáticas/asignaturas/${subjectId}/law/lomloe`, {
      ...subjectCatalog,
      catalogVersion: '2022-1',
    })
  )),
]

const accessToken = execFileSync(gcloud, ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ writes }),
})

if (!response.ok) {
  throw new Error(`Firestore respondió ${response.status}: ${await response.text()}`)
}

const result = await response.json()
console.log(`Catálogo cargado: ${writes.length} documentos, ${result.writeResults?.length || 0} escrituras confirmadas.`)
