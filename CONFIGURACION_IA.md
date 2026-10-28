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
