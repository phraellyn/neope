import { createApp } from 'vue'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from './App.vue'
import './services/firebase'
import './styles.css'

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'neopeLight',
    themes: {
      neopeLight: {
        dark: false,
        colors: {
          primary: '#3569B8',
          secondary: '#86AFE8',
          accent: '#E7F0FF',
          surface: '#FFFFFF',
          background: '#F8F9FE',
          'on-background': '#19375F',
          'on-surface': '#19375F',
          success: '#238271',
          warning: '#B96A00',
        },
      },
    },
  },
  defaults: {
    VBtn: { rounded: 'lg', elevation: 0 },
    VCard: { rounded: 'xl', elevation: 0 },
  },
})

// En el Mac de desarrollo, `localhost` y `127.0.0.1` son orígenes distintos
// para IndexedDB. Usamos uno solo para que los datos locales no parezcan
// desaparecer al escribir la otra dirección. No se aplica a accesos desde la
// red local (iPad u otros dispositivos).
if (import.meta.env.DEV && window.location.hostname === 'localhost') {
  const canonicalUrl = new URL(window.location.href)
  canonicalUrl.hostname = '127.0.0.1'
  window.location.replace(canonicalUrl)
} else {
  createApp(App).use(vuetify).mount('#app')
}
