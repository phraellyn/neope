import { getApp, getApps, initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyCCmF0l2YSUOD4K0AR-3EKtMFbsrLy4BEM',
  authDomain: 'neope-9e229.firebaseapp.com',
  projectId: 'neope-9e229',
  storageBucket: 'neope-9e229.firebasestorage.app',
  messagingSenderId: '137522573455',
  appId: '1:137522573455:web:e47e6b999cb349740700fa',
  measurementId: 'G-THPBQFTGH2',
}

// Reutiliza la instancia durante las recargas en desarrollo.
export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)

const environment = import.meta.env || {}
const appCheckSiteKey = environment.VITE_FIREBASE_APP_CHECK_KEY
export const isAppCheckConfigured = Boolean(appCheckSiteKey)

if (appCheckSiteKey) {
  const debugToken = environment.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN
  if (environment.DEV && debugToken) {
    // Vite expone las variables de entorno como cadenas. Firebase necesita el
    // booleano true para generar un token de depuración automáticamente.
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken
  }
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
}

// La cola persistente permite completar escrituras iniciadas al perder la conexión
// o justo antes de cerrar la pestaña. En recargas HMR la instancia ya puede existir.
let firestore
try {
  firestore = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
} catch {
  firestore = getFirestore(firebaseApp)
}

// Servicios habilitados por ahora. Auth se añadirá cuando corresponda.
export const db = firestore
export const storage = getStorage(firebaseApp)
export const functions = getFunctions(firebaseApp, 'europe-west1')
