<script setup lang="ts">
defineProps<{
  active: boolean;
  message: string;
}>();
</script>

<template>
  <div class="inactivity-pulse" :data-active="active">
    <span class="pulse-dot" aria-hidden="true" />
    <span>{{ message }}</span>
  </div>
</template>

<style scoped>
.inactivity-pulse {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-input-bg);
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.pulse-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--fc-text-muted);
}

.inactivity-pulse[data-active="true"] {
  color: var(--fc-error-text);
}

.inactivity-pulse[data-active="true"] .pulse-dot {
  background: var(--fc-error-text);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--fc-error-text) 24%, transparent);
  animation: pulse-ring 1.8s ease-out infinite;
}

@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--fc-error-text) 28%, transparent);
  }

  70% {
    box-shadow: 0 0 0 10px color-mix(in srgb, var(--fc-error-text) 0%, transparent);
  }

  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--fc-error-text) 0%, transparent);
  }
}
</style>
