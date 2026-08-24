import assert from 'node:assert/strict'

import {
  compactExerciseConceptLabel,
  exerciseStatementText,
  exerciseVersionAuthors,
} from '../src/utils/exerciseCardMetadata.js'

const nodes = [
  { id: 'matematicas', title: 'Matemáticas', parentId: null },
  { id: 'analisis', title: 'Análisis', parentId: 'matematicas' },
  { id: 'integrales', title: 'Integrales', parentId: 'analisis' },
  { id: 'volumen', title: 'Volumen de revolución', parentId: 'integrales' },
]

assert.equal(compactExerciseConceptLabel(['analisis', 'integrales', 'volumen'], nodes), 'Análisis · Volumen de revolución')
assert.deepEqual(exerciseVersionAuthors({
  enunciado: '\\ej Ejercicio',
  variaciones: [{
    enunciado: '\\ej Variante\\begin{solucion}Desarrollo\\end{solucion}',
    modelo: 'google/gemini-3.7-flash',
    info: 'Variación experimental -- Gemini 3.7 Flash',
  }],
}, 1), { statement: 'Gemini 3.7 Flash', solution: 'Gemini 3.7 Flash' })
assert.deepEqual(exerciseVersionAuthors({ enunciado: '\\ej Ejercicio' }), {
  statement: 'Carlos Sánchez Catalá',
  solution: 'Sin resolver',
})
assert.deepEqual(exerciseVersionAuthors({
  enunciado: '\\ej Ejercicio\\begin{solucion}Desarrollo\\end{solucion}',
  info: 'Generado por GPT-5.6 Sol',
}), {
  statement: 'GPT-5.6 Sol',
  solution: 'GPT-5.6 Sol',
})

const searchableExercise = {
  enunciado: '\\ej texto duplicado que incluye una solución antigua',
  structure: {
    enunciado: 'Enunciado general sobre matrices',
    solucion: 'Resultado secreto del desarrollo',
    apartados: [
      { enunciado: 'Calcula el determinante', respuesta: 'Respuesta secreta', solucion: 'Solución secreta' },
    ],
  },
}
assert.equal(exerciseStatementText(searchableExercise), 'Enunciado general sobre matrices\nCalcula el determinante')
assert.equal(exerciseStatementText(searchableExercise).includes('secreta'), false)

console.log('exercise card metadata: ok')
