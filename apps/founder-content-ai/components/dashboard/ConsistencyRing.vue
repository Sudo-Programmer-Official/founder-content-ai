<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  percent: number;
  streakDays: number;
  label?: string;
}>();

const normalizedPercent = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))));
const radius = 34;
const circumference = 2 * Math.PI * radius;
const dashOffset = computed(
  () => circumference - (normalizedPercent.value / 100) * circumference,
);
</script>

<template>
  <div class="consistency-ring">
    <svg viewBox="0 0 88 88" class="ring-graphic" aria-hidden="true">
      <circle class="ring-track" cx="44" cy="44" :r="radius" />
      <circle
        class="ring-fill"
        cx="44"
        cy="44"
        :r="radius"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>

    <div class="ring-copy">
      <strong>{{ normalizedPercent }}%</strong>
      <span>{{ label ?? "weekly consistency" }}</span>
      <small>{{ streakDays }} day streak</small>
    </div>
  </div>
</template>

<style scoped>
.consistency-ring {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.ring-graphic {
  width: 88px;
  height: 88px;
  transform: rotate(-90deg);
}

.ring-track,
.ring-fill {
  fill: none;
  stroke-width: 8;
}

.ring-track {
  stroke: color-mix(in srgb, var(--fc-border) 72%, transparent);
}

.ring-fill {
  stroke: var(--fc-accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 180ms ease;
}

.ring-copy {
  display: grid;
  gap: 2px;
  text-align: center;
}

.ring-copy strong {
  font-size: 1.15rem;
}

.ring-copy span,
.ring-copy small {
  color: var(--fc-text-muted);
}
</style>
