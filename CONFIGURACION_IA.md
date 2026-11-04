# Configuración de Variaciones IA

La generación se ejecuta en una Firebase Callable Function. La clave de OpenRouter nunca se envía al navegador ni se guarda en Firestore.

## 1. OpenRouter API

Crea una clave específica para Neope en OpenRouter y configura un límite de gasto.

Guárdala en Google Cloud Secret Manager mediante Firebase:

```bash
pnpm exec firebase login
pnpm exec firebase functions:secrets:set OPENROUTER_API_KEY
```

Los modelos para redactar ejercicios se configuran en el perfil del profesor. La función valida esa configuración en el servidor; las cuentas sin configuración propia utilizan la lista predeterminada de la aplicación.

El selector conserva exclusivamente los modelos del perfil y consulta sus modalidades actuales en OpenRouter para distinguir **Comprende imágenes** y **Genera imágenes**. No se incorporan modelos del catálogo automáticamente. Si alguno de los modelos configurados genera imágenes, puede elegirse para producir archivos PNG, JPEG o WebP; WebP se convierte a PNG para LaTeX. No se ofrecen generadores que solo devuelven SVG. También se comprueba el máximo de referencias admitidas por cada generador. Los modelos de generación compatibles utilizan la Image API o Chat Completions según el catálogo.

Si ninguno de los modelos configurados devuelve imágenes, el modelo elegido crea las figuras directamente en LaTeX/TikZ, tanto al generar variantes como al regenerar una imagen existente. Para recrear una imagen se exige comprensión visual; se conservan los datos del enunciado. La capacidad de recibir imágenes no implica que la API de ese modelo devuelva archivos de imagen.

## 2. Firebase App Check

En Firebase Console, abre **App Check**, registra la aplicación web con **reCAPTCHA Enterprise** y copia la clave del sitio en `.env.local`:

```dotenv
VITE_FIREBASE_APP_CHECK_KEY=clave_del_sitio
```

Para desarrollo local, añade también:

```dotenv
VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN=true
```

Al abrir la aplicación, Firebase mostrará un token de depuración en la consola del navegador. Regístralo en App Check antes de probar la función.

## 3. Despliegue

```bash
pnpm exec firebase deploy --only functions:generateExerciseVariation,functions:processExerciseCompilation,functions:listAiModelCapabilities,functions:generateExerciseImage,functions:regenerateExerciseTikz
```

Después reinicia Vite para que cargue `.env.local`.

## 4. Variantes con imágenes

**Añadir variante** permite generar imágenes automáticamente, exigir una imagen nueva o crear un ejercicio sin imágenes externas. La IA recibe el código y las imágenes referenciadas por el original. Las figuras TikZ y las imágenes PDF se envían como páginas renderizadas del ejercicio; si hace falta se compila el código actual. Se admiten hasta cuatro referencias y 6 MB en total. Las figuras matemáticas exactas pueden generarse directamente en TikZ.

Si falla la generación de la imagen, se conserva el enunciado preparado para reintentar esa fase. Las imágenes generadas se mantienen como borradores locales hasta **Guardar**. Entonces se suben a `ejercicios/{exerciseId}/variantes/{variantId}/imagenes/{fileId}.png` (o `.jpg`) y Firestore conserva en cada variante su propio `archivos`, los datos del modelo y las indicaciones. Los ejercicios antiguos sin `variacion.archivos` siguen utilizando los adjuntos del original.

El botón **Regenerar imagen de la variante** permite elegir una figura, añadir indicaciones y generar una propuesta. La propuesta se compila antes de aceptarla; cancelar conserva la imagen anterior. Aceptar modifica solo esa figura y su referencia LaTeX. Las figuras TikZ se regeneran como código; las imágenes externas, como archivos. Las referencias de imágenes guardadas que se sustituyen se conservan en `imageHistory` para mantener disponibles los documentos anteriores.

La compilación del banco y de los documentos utiliza los adjuntos de la variante elegida. La previsualización del editor y la compilación del servidor comparten la función que prepara el código, incluida la definición de respaldo de `\criterios`; las definiciones propias del preámbulo se respetan. En los documentos, los nombres de las imágenes incorporan su identificador para evitar colisiones entre variantes. Todas las funciones requieren una cuenta de profesor y App Check.

## 5. Copias de documentos con IA

El creador y la biblioteca de documentos ofrecen **IA: crear una copia** con dos modos:

- **Clonado**: genera al momento una variante de cada ejercicio original, conservando su dificultad y destrezas.
- **Variante**: conserva el mapa de conceptos, busca referencias en todo el banco de la asignatura y genera variantes de ellas. Los conceptos pueden distribuirse entre puestos distintos de los originales. Se prioriza cubrir lo que aún falta y se crean ejercicios nuevos si las referencias elegidas no cubren todo el mapa. Cuando el documento no tiene contenidos asignados, la IA identifica primero su mapa dentro del catálogo de la asignatura.

La propuesta conserva el árbol de herramientas y ejercicios, los optativos, los saltos de página, los apartados y sus puntos y tiempos. El código final editable del documento tiene prioridad: se sustituyen sus fragmentos de ejercicios conservando el resto, incluido el preámbulo. Los marcadores `% neope:document-block` permiten regenerar posteriormente los datos manteniendo esas zonas. Los criterios se recalculan con las mismas puntuaciones y se conserva su segmentación.

Antes de aceptar se muestran el PDF de cada ejercicio y los documentos completos. Cada ejercicio permite añadir indicaciones, regenerarlo o buscar otra referencia del banco. Los fallos de un ejercicio no obligan a repetir los demás. Se puede descartar una generación en curso; no se lanzarán las siguientes peticiones, aunque una petición que ya haya llegado al proveedor puede terminar allí.

**Aceptar copia y editar** crea un borrador con identidad nueva; **Guardar** persiste la copia. Los nuevos ejercicios son snapshots dentro del documento y nunca se insertan en `ejercicios`. Los PDF de revisión permanecen como blobs locales hasta guardar. Los adjuntos que pertenecían al documento original se copian al espacio de la nueva copia al guardarla. La revisión admite de 1 a 40 ejercicios y requiere que todos estén compilados y cubran el mapa previsto antes de aceptar.

La búsqueda y generación utilizan dos callables, protegidas por cuenta de profesor, App Check y la lista de modelos del perfil:

```bash
pnpm exec firebase deploy --only functions:planDocumentVariation,functions:generateDocumentExerciseVariation
```

Las comprobaciones `test:document-variation` y `test:document-creator` usan IA y compilador simulados, sin consumir llamadas de pago ni modificar datos del profesor.
