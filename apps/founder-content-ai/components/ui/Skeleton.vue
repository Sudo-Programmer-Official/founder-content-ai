<script setup lang="ts">
withDefaults(
  defineProps<{
    width?: string;
    height?: string;
    radius?: string;
  }>(),
  {
    width: "100%",
    height: "16px",
    radius: "14px",
  },
);
</script>

<template>
  <div
    class="skeleton-block"
    :style="{
      '--skeleton-width': width,
      '--skeleton-height': height,
      '--skeleton-radius': radius,
    }"
  />
</template>

<style scoped>
.skeleton-block {
  display: block;
  width: var(--skeleton-width);
  height: var(--skeleton-height);
  border-radius: var(--skeleton-radius);
  background:
    linear-gradient(
      90deg,
      rgba(116, 85, 61, 0.08) 0%,
      rgba(255, 255, 255, 0.72) 48%,
      rgba(116, 85, 61, 0.08) 100%
    );
  background-size: 220% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-block {
    animation: none;
  }
}
</style>
