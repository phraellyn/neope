<script setup>
import { computed, onMounted, ref } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../services/firebase'
import { showAppErrorToast } from '../composables/useAppErrorToast'

const invitations = ref([])
const loading = ref(false)
const dialog = ref(false)
const revokeDialog = ref(false)
const revokeTarget = ref(null)
const form = ref({ displayName: '', email: '' })
const createdLink = ref('')

const canCreate = computed(() => /^\S+@\S+\.\S+$/.test(form.value.email.trim()))

function statusLabel(status) {
  return ({ pending: 'Pendiente', accepted: 'Aceptada', revoked: 'Revocada', expired: 'Caducada' })[status] || status
}

async function loadInvitations() {
  loading.value = true
  try {
    const result = await httpsCallable(functions, 'listTeacherInvitations')()
    invitations.value = result.data.invitations || []
  } catch (error) {
    showAppErrorToast(error?.message || 'No se han podido cargar las invitaciones.')
  } finally {
    loading.value = false
  }
}

async function createInvitation() {
  if (!canCreate.value) return
  loading.value = true
  try {
    const result = await httpsCallable(functions, 'createTeacherInvitation')(form.value)
    const url = new URL(import.meta.env.PROD ? location.origin : 'https://neope.web.app')
    url.searchParams.set('invite', result.data.token)
    createdLink.value = url.toString()
    await loadInvitations()
  } catch (error) {
    showAppErrorToast(error?.message || 'No se ha podido crear la invitación.')
  } finally {
    loading.value = false
  }
}

async function copyLink() {
  await navigator.clipboard.writeText(createdLink.value)
}

function closeDialog() {
  dialog.value = false
  form.value = { displayName: '', email: '' }
  createdLink.value = ''
}

async function revokeInvitation() {
  loading.value = true
  try {
    await httpsCallable(functions, 'revokeTeacherInvitation')({ id: revokeTarget.value.id })
    revokeDialog.value = false
    revokeTarget.value = null
    await loadInvitations()
  } catch (error) {
    showAppErrorToast(error?.message || 'No se ha podido revocar la invitación.')
  } finally {
    loading.value = false
  }
}

onMounted(loadInvitations)
</script>

<template>
  <section class="invitation-manager">
    <header>
      <div><span>Administración</span><h2>Invitaciones de profesores</h2><p>Solo podrán crear una cuenta quienes reciban un enlace vigente.</p></div>
      <v-btn color="primary" prepend-icon="mdi-account-plus-outline" @click="dialog = true">Nueva invitación</v-btn>
    </header>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-table class="invitation-table" hover>
      <thead><tr><th>Profesor</th><th>Correo</th><th>Estado</th><th>Caducidad</th><th /></tr></thead>
      <tbody>
        <tr v-for="item in invitations" :key="item.id">
          <td>{{ item.displayName || '—' }}</td><td>{{ item.email }}</td>
          <td><v-chip size="small" :color="item.status === 'pending' ? 'primary' : item.status === 'accepted' ? 'success' : 'default'" variant="tonal">{{ statusLabel(item.status) }}</v-chip></td>
          <td>{{ item.expiresAt ? new Date(item.expiresAt).toLocaleDateString('es-ES') : '—' }}</td>
          <td class="text-right"><v-btn v-if="item.status === 'pending'" icon="mdi-close" size="small" variant="text" color="error" aria-label="Revocar invitación" @click="revokeTarget = item; revokeDialog = true" /></td>
        </tr>
        <tr v-if="!loading && !invitations.length"><td colspan="5" class="empty">Todavía no hay invitaciones.</td></tr>
      </tbody>
    </v-table>

    <v-dialog v-model="dialog" max-width="520">
      <v-card title="Invitar a un profesor">
        <v-card-text>
          <template v-if="!createdLink">
            <v-text-field v-model="form.displayName" label="Nombre" variant="outlined" autofocus />
            <v-text-field v-model="form.email" label="Correo electrónico" type="email" variant="outlined" @keyup.enter="createInvitation" />
          </template>
          <template v-else>
            <v-alert type="success" variant="tonal" class="mb-4">La invitación está lista. Este enlace solo se muestra ahora.</v-alert>
            <v-text-field :model-value="createdLink" label="Enlace de invitación" readonly variant="outlined" append-inner-icon="mdi-content-copy" @click:append-inner="copyLink" />
          </template>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="closeDialog">{{ createdLink ? 'Cerrar' : 'Cancelar' }}</v-btn><v-btn v-if="!createdLink" color="primary" :disabled="!canCreate" :loading="loading" @click="createInvitation">Crear</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="revokeDialog" max-width="440"><v-card title="Revocar invitación"><v-card-text>El enlace de {{ revokeTarget?.email }} dejará de funcionar inmediatamente.</v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="revokeDialog = false">Cancelar</v-btn><v-btn color="error" :loading="loading" @click="revokeInvitation">Revocar</v-btn></v-card-actions></v-card></v-dialog>
  </section>
</template>

<style scoped>
.invitation-manager { height: 100%; padding: 22px; overflow: auto; }
.invitation-manager header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.invitation-manager header span { color: #5884b8; font-size: .72rem; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
.invitation-manager h2 { margin: 2px 0; color: #274e7c; }
.invitation-manager p { margin: 0; color: #78899d; }
.invitation-table { border: 1px solid #dbe4ef; border-radius: 10px; }
.invitation-table .empty { padding: 44px; color: #8998aa; text-align: center; }
@media (max-width: 720px) { .invitation-manager { padding: 8px; } .invitation-manager header { align-items: flex-start; flex-direction: column; } }
</style>
