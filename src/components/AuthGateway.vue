<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const mode = ref('teacher')
const email = ref('')
const password = ref('')
const confirmation = ref('')
const studentCode = ref('')
const studentClaimed = ref(null)
const invitation = ref(null)
const invitationToken = ref('')
const loading = ref(false)
const recoveryMode = ref(false)
const notice = ref('')

const invitationReady = computed(() => invitation.value?.status === 'pending')
const studentCodeReady = computed(() => studentClaimed.value !== null)

function readableError(error, fallback) {
  const code = String(error?.code || '')
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Las credenciales no son correctas.'
  }
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos antes de volver a probar.'
  if (code.includes('network-request-failed')) return 'No se ha podido conectar con el servicio de acceso.'
  return error?.message?.replace(/^Firebase:\s*/u, '') || fallback
}

async function run(task, fallback) {
  loading.value = true
  notice.value = ''
  try {
    await task()
  } catch (error) {
    showAppErrorToast(readableError(error, fallback))
  } finally {
    loading.value = false
  }
}

async function teacherLogin() {
  await run(async () => {
    await signInWithEmailAndPassword(auth, email.value.trim(), password.value)
  }, 'No se ha podido iniciar sesión.')
}

async function recoverPassword() {
  await run(async () => {
    const target = email.value.trim().toLowerCase()
    if (!target) throw new Error('Introduce primero tu correo electrónico.')
    if (target === 'carlos.s@educa.madrid.org') {
      await httpsCallable(functions, 'bootstrapAdminAccount')()
    }
    await sendPasswordResetEmail(auth, target)
    notice.value = 'Si la cuenta existe, recibirás un correo para elegir una contraseña nueva.'
  }, 'No se ha podido solicitar el cambio de contraseña.')
}

async function inspectInvitation() {
  if (!invitationToken.value) return
  await run(async () => {
    const result = await httpsCallable(functions, 'inspectTeacherInvitation')({ token: invitationToken.value })
    invitation.value = result.data
    email.value = result.data.email || ''
  }, 'No se ha podido validar la invitación.')
}

async function acceptInvitation() {
  await run(async () => {
    if (!invitationReady.value) throw new Error('Esta invitación no está disponible.')
    if (password.value.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.')
    if (password.value !== confirmation.value) throw new Error('Las contraseñas no coinciden.')
    const result = await httpsCallable(functions, 'acceptTeacherInvitation')({
      token: invitationToken.value,
      password: password.value,
    })
    await signInWithCustomToken(auth, result.data.customToken)
    history.replaceState({}, '', `${location.pathname}${location.hash}`)
  }, 'No se ha podido activar la cuenta de profesor.')
}

async function inspectStudentCode() {
  await run(async () => {
    const code = studentCode.value.trim()
    const result = await httpsCallable(functions, 'inspectStudentAccess')({ code })
    studentCode.value = code
    studentClaimed.value = result.data.claimed
    password.value = ''
    confirmation.value = ''
  }, 'El código no está habilitado.')
}

async function studentLogin() {
  await run(async () => {
    if (!studentCodeReady.value) return inspectStudentCode()
    if (password.value.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.')
    if (!studentClaimed.value) {
      if (password.value !== confirmation.value) throw new Error('Las contraseñas no coinciden.')
      const result = await httpsCallable(functions, 'claimStudentAccount')({
        code: studentCode.value,
        password: password.value,
      })
      await signInWithCustomToken(auth, result.data.customToken)
      return
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(studentCode.value))
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    await signInWithEmailAndPassword(auth, `student-${hash.slice(0, 32)}@students.neope.invalid`, password.value)
  }, 'No se ha podido iniciar sesión como alumno.')
}

function changeMode(value) {
  mode.value = value
  password.value = ''
  confirmation.value = ''
  studentClaimed.value = null
  recoveryMode.value = false
  notice.value = ''
}

onMounted(() => {
  invitationToken.value = new URLSearchParams(location.search).get('invite') || ''
  if (invitationToken.value) void inspectInvitation()
})
</script>

<template>
  <main class="auth-gateway">
    <section class="auth-brand-panel">
      <img src="/brand/neope-logo.png" alt="Neope" class="auth-brand-logo">
    </section>

    <v-card class="auth-card" variant="flat">
      <template v-if="invitationToken">
        <div class="auth-heading">
          <span class="auth-eyebrow">Invitación</span>
          <h1>Activa tu cuenta de profesor</h1>
          <p v-if="invitationReady">{{ invitation.displayName || invitation.email }}</p>
        </div>
        <v-alert v-if="invitation && !invitationReady" type="warning" variant="tonal">
          Esta invitación ha caducado, ha sido revocada o ya se ha utilizado.
        </v-alert>
        <template v-else>
          <v-text-field v-model="email" label="Correo electrónico" readonly variant="outlined" />
          <v-text-field v-model="password" label="Contraseña" type="password" autocomplete="new-password" variant="outlined" />
          <v-text-field v-model="confirmation" label="Confirma la contraseña" type="password" autocomplete="new-password" variant="outlined" @keyup.enter="acceptInvitation" />
          <v-btn block color="primary" size="large" :loading="loading" @click="acceptInvitation">Activar cuenta</v-btn>
        </template>
      </template>

      <template v-else>
        <div class="auth-heading">
          <span class="auth-eyebrow">Acceso privado</span>
          <h1>Bienvenido a Neope</h1>
          <p>{{ mode === 'teacher' ? 'Acceso del profesorado' : 'Acceso del alumnado' }}</p>
        </div>
        <v-btn-toggle :model-value="mode" mandatory rounded="pill" class="auth-role-switch" @update:model-value="changeMode">
          <v-btn value="teacher">Profesor</v-btn>
          <v-btn value="student">Alumno</v-btn>
        </v-btn-toggle>

        <template v-if="mode === 'teacher'">
          <v-text-field v-model="email" label="Correo electrónico" type="email" autocomplete="username" variant="outlined" autofocus />
          <v-text-field v-if="!recoveryMode" v-model="password" label="Contraseña" type="password" autocomplete="current-password" variant="outlined" @keyup.enter="teacherLogin" />
          <v-alert v-if="notice" type="success" variant="tonal" class="mb-4">{{ notice }}</v-alert>
          <v-btn v-if="!recoveryMode" block color="primary" size="large" :loading="loading" @click="teacherLogin">Entrar</v-btn>
          <v-btn v-else block color="primary" size="large" :loading="loading" @click="recoverPassword">Enviar enlace</v-btn>
          <v-btn block variant="text" size="small" class="mt-2" @click="recoveryMode = !recoveryMode">
            {{ recoveryMode ? 'Volver al acceso' : 'He olvidado mi contraseña' }}
          </v-btn>
          <p class="auth-invitation-note">Las cuentas de profesor se crean únicamente mediante invitación.</p>
        </template>

        <template v-else>
          <v-text-field
            v-model="studentCode"
            label="Código de 6 caracteres"
            maxlength="6"
            autocomplete="username"
            variant="outlined"
            :readonly="studentCodeReady"
            autofocus
            @keyup.enter="studentCodeReady ? studentLogin() : inspectStudentCode()"
          />
          <template v-if="studentCodeReady">
            <v-text-field v-model="password" :label="studentClaimed ? 'Contraseña' : 'Elige una contraseña'" type="password" :autocomplete="studentClaimed ? 'current-password' : 'new-password'" variant="outlined" />
            <v-text-field v-if="!studentClaimed" v-model="confirmation" label="Confirma la contraseña" type="password" autocomplete="new-password" variant="outlined" @keyup.enter="studentLogin" />
            <v-btn block color="primary" size="large" :loading="loading" @click="studentLogin">
              {{ studentClaimed ? 'Entrar' : 'Activar acceso' }}
            </v-btn>
            <v-btn block variant="text" size="small" class="mt-2" @click="studentClaimed = null">Cambiar código</v-btn>
          </template>
          <v-btn v-else block color="primary" size="large" :loading="loading" @click="inspectStudentCode">Continuar</v-btn>
          <p class="auth-invitation-note">Si has olvidado tu contraseña, pide a tu profesor que restablezca tu acceso.</p>
        </template>
      </template>
    </v-card>
  </main>
</template>

<style scoped>
.auth-gateway { min-height: 100dvh; display: grid; grid-template-columns: minmax(280px, .9fr) minmax(420px, 1.1fr); background: #f4f7fb; }
.auth-brand-panel { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 56px; color: #fff; text-align: center; background: radial-gradient(circle at 25% 20%, #5d8fd1 0, #3267aa 44%, #183d6b 100%); }
.auth-brand-logo { width: min(360px, 75%); filter: brightness(0) invert(1); }
.auth-card { width: min(470px, calc(100% - 48px)); margin: auto; padding: 42px; border: 1px solid #dce4ef; border-radius: 18px; box-shadow: 0 22px 60px rgba(36, 67, 105, .12) !important; }
.auth-heading { margin-bottom: 26px; }
.auth-heading h1 { margin: 3px 0 5px; color: #244b78; font-size: clamp(1.75rem, 3vw, 2.25rem); }
.auth-heading p, .auth-invitation-note { color: #71839a; }
.auth-eyebrow { color: #4a7fbe; font-size: .75rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.auth-role-switch { width: 100%; height: 42px; margin-bottom: 26px; padding: 3px; border: 1px solid #cdd9e8; }
.auth-role-switch :deep(.v-btn) { flex: 1; border-radius: 999px !important; }
.auth-invitation-note { margin: 20px 8px 0; font-size: .78rem; line-height: 1.5; text-align: center; }
@media (max-width: 760px) {
  .auth-gateway { grid-template-columns: 1fr; }
  .auth-brand-panel { min-height: 150px; padding: 24px; }
  .auth-brand-logo { width: 190px; }
  .auth-card { margin: 24px auto; padding: 28px 22px; }
}
</style>
