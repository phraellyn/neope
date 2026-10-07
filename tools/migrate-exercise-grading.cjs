#!/usr/bin/env node

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { getProjectDefaultAccount, getAccessToken } = require('firebase-tools/lib/auth')
const { CLOUD_PLATFORM } = require('firebase-tools/lib/scopes')

const projectId = 'neope-9e229'
const projectDir = path.resolve(__dirname, '..')
const apply = process.argv.includes('--apply')
const deleteDocuments = process.argv.includes('--delete-documents')
const backupDirectory = path.join(projectDir, 'Recursos de desarrollo', 'backups', `grading-${new Date().toISOString().replace(/[:.]/g, '-')}`)

function canonical(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonical)
    return items.every((item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.name === 'string')
      ? items.sort((left, right) => left.name.localeCompare(right.name))
      : items
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

async function authToken() {
  const account = getProjectDefaultAccount(projectDir)
  if (!account?.tokens?.refresh_token) throw new Error('No hay una sesión activa de Firebase para este proyecto.')
  const tokens = await getAccessToken(account.tokens.refresh_token, [CLOUD_PLATFORM])
  return tokens.access_token
}

async function request(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 1_000)}`)
  return body ? JSON.parse(body) : null
}

async function collectionDocuments(token, collectionId) {
  const documents = []
  let pageToken = ''
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const payload = await request(token, url)
    documents.push(...(payload.documents || []))
    pageToken = payload.nextPageToken || ''
  } while (pageToken)
  return documents
}

function scalar(value) {
  if (!value || typeof value !== 'object') return undefined
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return value.booleanValue
  return undefined
}

function gradingCriterion(rawCriterion = {}) {
  const fields = rawCriterion.mapValue?.fields || {}
  const alignment = fields.alignment?.mapValue?.fields || {}
  const result = {
    id: fields.id || { stringValue: `criterion-${crypto.randomUUID()}` },
    description: fields.description || { stringValue: '' },
    points: fields.points || { doubleValue: 0 },
    source: alignment.source || fields.source || { stringValue: 'manual' },
  }
  if (alignment.model || fields.model) result.model = alignment.model || fields.model
  return { mapValue: { fields: result } }
}

function migrateSegmentFields(fields = {}) {
  const migrated = { ...fields }
  const source = fields.gradingCriteria?.arrayValue?.values || fields.achievements?.arrayValue?.values || []
  migrated.gradingCriteria = { arrayValue: { values: source.map(gradingCriterion) } }
  delete migrated.achievements
  return migrated
}

function migrateExerciseDocument(document) {
  const fields = migrateSegmentFields(document.fields || {})
  fields.schemaVersion = { integerValue: '4' }
  if (fields.parts?.arrayValue?.values) {
    fields.parts = {
      arrayValue: {
        values: fields.parts.arrayValue.values.map((part) => ({
          mapValue: { fields: migrateSegmentFields(part.mapValue?.fields || {}) },
        })),
      },
    }
  }
  if (fields.variaciones?.arrayValue?.values) {
    fields.variaciones = {
      arrayValue: {
        values: fields.variaciones.arrayValue.values.map((variation) => {
          const variationFields = migrateSegmentFields(variation.mapValue?.fields || {})
          variationFields.schemaVersion = { integerValue: '4' }
          if (variationFields.parts?.arrayValue?.values) {
            variationFields.parts = {
              arrayValue: {
                values: variationFields.parts.arrayValue.values.map((part) => ({
                  mapValue: { fields: migrateSegmentFields(part.mapValue?.fields || {}) },
                })),
              },
            }
          }
          return { mapValue: { fields: variationFields } }
        }),
      },
    }
  }
  return { ...document, fields }
}

const defaultTools = [
  { id: 'obligatorios', label: 'Obligatorios', description: 'Inicia una sección de ejercicios obligatorios', behavior: 'required-section', code: '\\obligatorios' },
  { id: 'optativos', label: 'Optatividad', description: 'Inicia una sección de ejercicios optativos', behavior: 'optional-section', code: '\\optativos{{{countWord}}}{{{availableWord}}}', arguments: [{ key: 'count', label: 'Ejercicios a elegir', type: 'number', default: 1, min: 1 }] },
  { id: 'salto-pagina', label: 'Salto de página', description: 'Inserta un salto de página', behavior: 'page-break', code: '\\salto' },
  { id: 'seccion', label: 'Sección', description: 'Añade un separador a la colección de ejercicios', code: '\\tipo{{{title}}}', arguments: [{ key: 'title', label: 'Título', type: 'text', default: '' }] },
]

function templateSupports(code, command) {
  return new RegExp(`\\\\(?:newcommand|renewcommand|providecommand)\\*?\\s*\\{?\\\\${command}\\}?`, 'i').test(code)
}

function migrateTemplateDocument(document) {
  const fields = { ...(document.fields || {}) }
  const code = String(scalar(fields.codigo) || '')
  if (!code) return document
  const existing = new Set([...code.matchAll(/^\s*%\s*neope:tool\s+(\{.*\})\s*$/gm)].flatMap((match) => {
    try { return [JSON.parse(match[1]).id] } catch { return [] }
  }))
  const tools = defaultTools.filter((tool) => !existing.has(tool.id) && (
    tool.id === 'seccion' ? templateSupports(code, 'tipo') : templateSupports(code, tool.id === 'salto-pagina' ? 'salto' : tool.id)
  ))
  if (!tools.length) return document
  const metadata = tools.map((tool) => `% neope:tool ${JSON.stringify(tool)}`).join('\n')
  fields.codigo = { stringValue: `${metadata}\n${code}` }
  return { ...document, fields }
}

async function putDocument(token, document) {
  const fields = document.fields || {}
  await request(token, `https://firestore.googleapis.com/v1/${document.name}`, { method: 'PATCH', body: JSON.stringify({ fields }) })
}

async function deleteDocument(token, document) {
  await request(token, `https://firestore.googleapis.com/v1/${document.name}`, { method: 'DELETE' })
}

async function storageObjects(token, prefix) {
  const objects = []
  let pageToken = ''
  do {
    const url = new URL('https://storage.googleapis.com/storage/v1/b/neope-9e229.firebasestorage.app/o')
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('maxResults', '1000')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const payload = await request(token, url)
    objects.push(...(payload.items || []))
    pageToken = payload.nextPageToken || ''
  } while (pageToken)
  return objects
}

async function main() {
  const token = await authToken()
  const collections = {}
  for (const name of ['ejercicios', 'plantillas', 'documentos', 'rubricas']) collections[name] = await collectionDocuments(token, name)
  const documentObjects = await storageObjects(token, 'documentos/')
  await fs.mkdir(backupDirectory, { recursive: true })
  for (const [name, documents] of Object.entries(collections)) {
    await fs.writeFile(path.join(backupDirectory, `${name}.json`), `${JSON.stringify(documents, null, 2)}\n`)
  }
  await fs.writeFile(path.join(backupDirectory, 'document-storage.json'), `${JSON.stringify(documentObjects, null, 2)}\n`)

  const rubricHashBefore = hash(collections.rubricas)
  const migratedExercises = collections.ejercicios.map(migrateExerciseDocument)
  const migratedTemplates = collections.plantillas.map(migrateTemplateDocument)
  const changedTemplates = migratedTemplates.filter((document, index) => hash(document.fields) !== hash(collections.plantillas[index].fields))

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    backupDirectory,
    counts: Object.fromEntries(Object.entries(collections).map(([name, documents]) => [name, documents.length])),
    documentStorageObjects: documentObjects.length,
    exercisesToMigrate: migratedExercises.length,
    templatesToMigrate: changedTemplates.length,
    deleteDocuments,
    rubricHashBefore,
  }
  if (apply) {
    for (const document of migratedExercises) await putDocument(token, document)
    for (const document of changedTemplates) await putDocument(token, document)
    if (deleteDocuments) {
      for (const document of collections.documentos) await deleteDocument(token, document)
      for (const object of documentObjects) {
        await request(token, `https://storage.googleapis.com/storage/v1/b/neope-9e229.firebasestorage.app/o/${encodeURIComponent(object.name)}`, { method: 'DELETE' })
      }
    }
    const rubricsAfter = await collectionDocuments(token, 'rubricas')
    report.rubricHashAfter = hash(rubricsAfter)
    report.rubricsUnchanged = report.rubricHashAfter === rubricHashBefore
    if (!report.rubricsUnchanged) throw new Error('La comprobación de integridad de rúbricas ha fallado.')
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
