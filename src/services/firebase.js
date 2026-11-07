import { getApp, getApps, initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyCCmF0l2YSUOD4K0AR-3EKtMFbsrLy4BEM',
  authDomain: 'neope-9e229.firebaseapp.com',
  projectId: 'neope-9e229',
  storageBucket: 'neope-9e229.firebasestorage.app',
  messagingSenderId: '137522573455',
  appId: '1:137522573455:web:e47e6b999cb349740700fa',
  measurementId: 'G-THPBQFTGH2',
}

// La demostración es exclusivamente local y nunca conecta con el proyecto real.
export const isLocalStudentDemo = import.meta.env.DEV && import.meta.env.VITE_NEOPE_STUDENT_DEMO === 'true'
const demoConfig = { apiKey: 'demo-key', projectId: 'demo-neope-student', appId: 'demo-app', storageBucket: 'demo-neope-student.appspot.com' }
// Reutiliza la instancia durante las recargas en desarrollo.
export const firebaseApp = getApps().length ? getApp() : initializeApp(isLocalStudentDemo ? demoConfig : firebaseConfig)

const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_KEY
export const isAppCheckConfigured = isLocalStudentDemo || Boolean(appCheckSiteKey)

if (isLocalStudentDemo) {
  // El token ficticio solo lo acepta el emulador local configurado para la demo.
  initializeAppCheck(firebaseApp, { provider: new CustomProvider({ getToken: async () => ({ token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXh0dXJlIn0.signature', expireTimeMillis: Date.now() + 3600000 }) }) })
} else if (appCheckSiteKey) {
  if (import.meta.env.DEV) {
    const debugToken = import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG_TOKEN
    // Vite expone las variables de entorno como cadenas. Firebase necesita el
    // booleano true para generar un token de depuración automáticamente.
    if (debugToken) globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken === 'true' ? true : debugToken
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

export const db = firestore
export const auth = getAuth(firebaseApp)
auth.useDeviceLanguage()
export const storage = getStorage(firebaseApp)
export const functions = getFunctions(firebaseApp, 'europe-west1')
if (isLocalStudentDemo) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8089)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
}
