<script setup>
import { computed } from 'vue'
import { arc, scaleLinear } from 'd3'

const props = defineProps({
  values: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const size = 360
const center = { x: 180, y: 174 }
const radius = 116
const innerRadius = 9
const labelRadius = 130
const segmentCount = 10
const radialStep = (radius - innerRadius) / segmentCount
const radialGap = 3.2
const sectorOffset = 6.5
const radialScale = scaleLinear().domain([0, 100]).range([0, radius]).clamp(true)
const angle = (index) => (index * Math.PI * 2) / Math.max(1, props.values.length)
const sectorArc = arc().cornerRadius(1.4)

const chartValues = computed(() => props.values.map((item) => ({
  ...item,
  studentPercent: Number(item.studentPercent) || 0,
  groupPercent: Number(item.groupPercent) || 0,
  illuminatedSegments: Math.ceil(Math.max(0, Math.min(100, Number(item.studentPercent) || 0)) / 10),
})))
const groupPath = computed(() => groupAveragePath(chartValues.value))
const hasEvidence = computed(() => chartValues.value.some((item) => item.maximum > 0 || item.assessedStudents > 0))

function pointAt(value, index, extraRadius = 0) {
  const radians = angle(index)
  const distance = extraRadius || radialScale(value)
  return { x: Math.sin(radians) * distance, y: -Math.cos(radians) * distance }
}

function segmentPath(sectorIndex, segmentIndex) {
  const sectorWidth = (Math.PI * 2) / Math.max(1, chartValues.value.length)
  const middleAngle = angle(sectorIndex)
  return sectorArc({
    innerRadius: innerRadius + segmentIndex * radialStep + radialGap / 2,
    outerRadius: innerRadius + (segmentIndex + 1) * radialStep - radialGap / 2,
    startAngle: middleAngle - sectorWidth / 2,
    endAngle: middleAngle + sectorWidth / 2,
  }) || ''
}

function sectorTransform(index) {
  const offset = pointAt(100, index, sectorOffset)
  return `translate(${offset.x} ${offset.y})`
}

function groupRadius(value) {
  const percent = Math.max(0, Math.min(100, Number(value) || 0))
  return innerRadius + ((radius - innerRadius) * percent) / 100
}

function polarPoint(distance, radians) {
  return {
    x: Math.sin(radians) * distance,
    y: -Math.cos(radians) * distance,
  }
}

function groupAveragePath(values) {
  if (!values.length) return ''
  const sectorWidth = (Math.PI * 2) / values.length
  const radii = values.map((item) => groupRadius(item.groupPercent))
  const startAngle = -sectorWidth / 2
  const start = polarPoint(radii[0], startAngle)
  const commands = [`M ${start.x} ${start.y}`]
  values.forEach((_, index) => {
    const endAngle = (index + 0.5) * sectorWidth
    const radiusAtSector = radii[index]
    const end = polarPoint(radiusAtSector, endAngle)
    commands.push(`A ${radiusAtSector} ${radiusAtSector} 0 0 1 ${end.x} ${end.y}`)
    const nextRadius = radii[(index + 1) % values.length]
    const next = polarPoint(nextRadius, endAngle)
    commands.push(`L ${next.x} ${next.y}`)
  })
  commands.push('Z')
  return commands.join(' ')
}

function labelRotation(index) {
  const degrees = angle(index) * 180 / Math.PI
  return degrees > 90 && degrees <= 270 ? degrees + 180 : degrees
}

function percentage(value) {
  return `${Math.round(Number(value) || 0)} %`
}
</script>

<template>
  <section class="student-competency-radar" aria-labelledby="student-competency-title">
    <header>
      <div>
        <h3 id="student-competency-title">Competencias clave</h3>
        <p>Cada banda iluminada representa un 10 %</p>
      </div>
      <div class="student-competency-legend" aria-label="Leyenda">
        <span class="student-key">Alumno</span>
        <span class="group-key">Media del grupo</span>
      </div>
    </header>

    <div v-if="loading" class="student-competency-loading">
      <v-progress-circular indeterminate color="primary" size="28" width="3" />
      <span>Calculando competencias…</span>
    </div>
    <template v-else>
      <svg
        v-if="chartValues.length"
        class="student-competency-chart"
        :viewBox="`0 0 ${size} ${size}`"
        role="img"
        aria-labelledby="student-competency-title student-competency-description"
      >
        <desc id="student-competency-description">Comparación entre el porcentaje de logro del alumno y la media del grupo en las competencias clave.</desc>
        <g :transform="`translate(${center.x} ${center.y})`">
          <g
            v-for="(item, sectorIndex) in chartValues"
            :key="item.id"
            class="competency-signal-sector"
            :transform="sectorTransform(sectorIndex)"
          >
            <path
              v-for="segmentIndex in segmentCount"
              :key="`${item.id}-${segmentIndex}`"
              :d="segmentPath(sectorIndex, segmentIndex - 1)"
              class="competency-signal-segment"
              :class="{ illuminated: segmentIndex <= item.illuminatedSegments }"
            >
              <title>{{ item.title }}: {{ percentage(item.studentPercent) }}</title>
            </path>
          </g>
          <path :d="groupPath" class="competency-group-outline"><title>Media del grupo</title></path>
          <g
            v-for="(item, index) in chartValues"
            :key="`label-${item.id}`"
            :transform="`translate(${pointAt(100, index, labelRadius + sectorOffset).x} ${pointAt(100, index, labelRadius + sectorOffset).y}) rotate(${labelRotation(index)})`"
            class="competency-label"
            text-anchor="middle"
          >
            <text>{{ item.code }}</text>
            <title>{{ item.title }}: alumno {{ percentage(item.studentPercent) }}, grupo {{ percentage(item.groupPercent) }}</title>
          </g>
        </g>
      </svg>
      <p v-if="!hasEvidence" class="student-competency-empty">Todavía no hay evidencias competenciales evaluadas.</p>
    </template>
  </section>
</template>
