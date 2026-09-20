<script setup>
import { computed } from 'vue'
import lomloeMathLaw from '../data/lomloeMathLaw.json'

const props = defineProps({ alignment: { type: Object, default: () => ({}) } })

const strengthRank = Object.freeze({ weak: 1, medium: 2, strong: 3 })
const strengthLabel = Object.freeze({ weak: 'Evidencia débil', medium: 'Evidencia media', strong: 'Evidencia fuerte' })
const subjectLaws = Object.values(lomloeMathLaw.subjects || {})
const competenceById = new Map(subjectLaws.flatMap((subject) => subject.specificCompetencies || []).filter((item) => item?.id).map((item) => [item.id, item]))
const criteriaById = new Map(subjectLaws.flatMap((subject) => [
  ...(subject.evaluationCriteria || []),
  ...(subject.specificCompetencies || []).flatMap((competence) => (competence.criteria || []).map((criterion) => ({ ...criterion, competenceId: criterion.competenceId || competence.id }))),
]).filter((item) => item?.id).map((item) => [item.id, item]))
const descriptorsById = new Map((lomloeMathLaw.global?.operationalDescriptors || []).filter((item) => item?.id).map((item) => [item.id, item]))

function fallback(id) {
  const matched = String(id || '').match(/-cr-(\d+)-(\d+)$/i)
  return matched ? `${matched[1]}.${matched[2]}` : String(id || '').split('-').at(-1)?.toUpperCase() || '—'
}
function strongest(values) {
  return values.reduce((current, value) => (strengthRank[value] > strengthRank[current] ? value : current), '')
}
const references = computed(() => {
  const evidence = (props.alignment?.descriptorEvidence || []).map((item) => ({ ...item, descriptor: descriptorsById.get(item.descriptorId) }))
  const evidenceById = new Map(evidence.map((item) => [item.descriptorId, item.strength]))
  const criteria = (props.alignment?.criterionIds || []).map((id) => {
    const criterion = criteriaById.get(id)
    const competence = competenceById.get(criterion?.competenceId)
    const ids = [...new Set([...(criterion?.descriptorIds || []), ...(competence?.descriptorIds || [])])]
    return { id, code: criterion?.code || fallback(id), description: criterion?.description || '', strength: strongest(ids.map((descriptorId) => evidenceById.get(descriptorId)).filter(Boolean)) }
  })
  return { criteria, evidence: evidence.map((item) => ({ id: item.descriptorId, code: item.descriptor?.code || fallback(item.descriptorId), description: item.descriptor?.description || '', strength: item.strength })) }
})
</script>

<template>
  <div v-if="references.criteria.length || references.evidence.length" class="rubric-alignment-badges">
    <span v-if="references.criteria.length" class="rubric-alignment-group"><small>Criterios</small><em v-for="criterion in references.criteria" :key="criterion.id" :class="criterion.strength ? `strength-${criterion.strength}` : 'strength-neutral'" :title="[criterion.description, criterion.strength ? strengthLabel[criterion.strength] : 'Sin fuerza definida'].filter(Boolean).join(' · ')">{{ criterion.code }}</em></span>
    <span v-if="references.evidence.length" class="rubric-alignment-group"><small>Descriptores</small><em v-for="descriptor in references.evidence" :key="descriptor.id" :class="`strength-${descriptor.strength}`" :title="[descriptor.description, strengthLabel[descriptor.strength]].filter(Boolean).join(' · ')">{{ descriptor.code }}</em></span>
  </div>
</template>

<style scoped>
.rubric-alignment-badges, .rubric-alignment-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.rubric-alignment-badges { margin-top: 2px; gap: 8px; }
.rubric-alignment-group small { color: #75889d; font-size: .57rem; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; }
em { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 5px; border-radius: 9px; font-size: .56rem; font-style: normal; font-weight: 850; line-height: 1; }
.strength-neutral { background: #e4eaf1; color: #61738a; }.strength-weak { background: #d9efdf; color: #356346; }.strength-medium { background: #78b98d; color: #153f25; }.strength-strong { background: #286a42; color: #fff; }
</style>
