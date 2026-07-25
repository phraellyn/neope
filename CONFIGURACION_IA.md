# Configuración de Variaciones IA

La generación se ejecuta en una Firebase Callable Function. La clave de OpenRouter nunca se envía al navegador ni se guarda en Firestore.

## 1. OpenRouter API

Crea una clave específica para Neope en OpenRouter y configura un límite de gasto.

Guárdala en Google Cloud Secret Manager mediante Firebase:

```bash
pnpm exec firebase login
pnpm exec firebase functions:secrets:set OPENROUTER_API_KEY
```

El usuario puede elegir desde la toolbar entre `qwen/qwen3.7-plus`, `deepseek/deepseek-v3.2`, `z-ai/glm-5.2` y `openai/gpt-5-mini`. La función valida esta lista en el servidor.

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
pnpm exec firebase deploy --only functions:generateExerciseVariation
```

Después reinicia Vite para que cargue `.env.local`.
