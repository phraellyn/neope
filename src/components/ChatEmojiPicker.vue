<script setup>
defineEmits(['select'])
const groups = [
  { title: 'Matemáticas', items: ['➕', '➖', '✖️', '➗', '🟰', 'π', '√', '∞', '∑', '∫', '📐', '📏', '📊', '📈', '📉'] },
  { title: 'Estudio y clase', items: ['📚', '📖', '📝', '✏️', '📌', '🔍', '💡', '🧠', '🎓', '🏫', '⏰', '📅', '⭐', '✅', '❓'] },
  { title: 'Gestos y emociones', items: ['😀', '😊', '😂', '🙂', '😉', '😍', '🤔', '😅', '😢', '😮', '👍', '👎', '👏', '🙏', '💪', '❤️', '✨', '🎉'] },
]
</script>
<template>
  <v-menu location="top start" :close-on-content-click="false">
    <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-emoticon-outline" size="small" variant="text" aria-label="Elegir emoji" title="Elegir emoji" /></template>
    <div class="emoji-picker"><section v-for="group in groups" :key="group.title"><h3>{{ group.title }}</h3><div class="emoji-grid"><button v-for="emoji in group.items" :key="emoji" type="button" :aria-label="`Añadir ${emoji}`" @click="$emit('select', emoji)">{{ emoji }}</button></div></section></div>
  </v-menu>
</template>
<style scoped>
.emoji-picker { max-height:min(360px, 55dvh); overflow-y:auto; padding:8px; border-radius:8px; background:white; box-shadow:0 3px 14px #16304933; overscroll-behavior:contain; }.emoji-picker h3 { padding:5px 4px; color:#71839a; font-size:.75rem; font-weight:600; }.emoji-grid { display:grid; grid-template-columns:repeat(5, 1fr); gap:2px; }.emoji-picker button { width:40px; height:40px; border-radius:5px; font-size:1.35rem; }.emoji-picker button:hover { background:#eaf1f8; }
</style>
