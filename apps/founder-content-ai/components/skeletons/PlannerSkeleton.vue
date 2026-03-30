<script setup lang="ts">
import Skeleton from "../ui/Skeleton.vue";
</script>

<template>
  <div class="planner-skeleton">
    <section class="planner-skeleton-overview">
      <article v-for="index in 4" :key="`overview-${index}`" class="skeleton-panel skeleton-stat-card">
        <Skeleton width="86px" height="12px" radius="999px" />
        <Skeleton width="56px" height="30px" />
      </article>
    </section>

    <section class="planner-skeleton-main">
      <article class="skeleton-panel planner-skeleton-grid">
        <div class="planner-toolbar-skeleton">
          <div class="skeleton-stack">
            <Skeleton width="240px" height="30px" />
            <Skeleton width="62%" height="14px" />
          </div>
          <div class="skeleton-action-row">
            <Skeleton width="92px" height="40px" radius="999px" />
            <Skeleton width="88px" height="40px" radius="999px" />
            <Skeleton width="92px" height="40px" radius="999px" />
          </div>
        </div>

        <div class="planner-insight-skeleton">
          <Skeleton height="92px" radius="22px" />
          <Skeleton height="92px" radius="22px" />
        </div>

        <div class="planner-week-skeleton">
          <article v-for="index in 7" :key="`day-${index}`" class="planner-day-skeleton">
            <div class="skeleton-stack">
              <Skeleton width="60px" height="12px" radius="999px" />
              <Skeleton width="38px" height="24px" />
              <Skeleton width="84%" height="12px" />
            </div>
            <div class="skeleton-list">
              <Skeleton height="74px" radius="18px" />
              <Skeleton height="74px" radius="18px" />
            </div>
            <Skeleton width="72px" height="34px" radius="999px" />
          </article>
        </div>
      </article>

      <aside class="skeleton-panel">
        <div class="skeleton-stack">
          <Skeleton width="96px" height="12px" radius="999px" />
          <Skeleton width="42%" height="28px" />
          <Skeleton width="74%" height="14px" />
        </div>
        <Skeleton height="180px" radius="22px" />
        <div class="skeleton-list">
          <Skeleton height="108px" radius="22px" />
          <Skeleton height="44px" radius="999px" />
          <Skeleton height="44px" radius="999px" />
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.planner-skeleton {
  display: grid;
  gap: 20px;
}

.planner-skeleton-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.planner-skeleton-main {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 0.9fr);
  gap: 20px;
}

.skeleton-panel {
  display: grid;
  gap: 18px;
  padding: 24px;
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
  box-shadow: var(--fc-panel-shadow);
}

.skeleton-stat-card {
  gap: 12px;
}

.planner-toolbar-skeleton,
.planner-insight-skeleton {
  display: grid;
  gap: 16px;
}

.planner-toolbar-skeleton {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.planner-insight-skeleton {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.planner-week-skeleton {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
}

.planner-day-skeleton {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface) 90%, white 10%);
}

.skeleton-stack {
  display: grid;
  gap: 10px;
}

.skeleton-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.skeleton-list {
  display: grid;
  gap: 12px;
}

@media (max-width: 1180px) {
  .planner-skeleton-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .planner-week-skeleton {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .planner-skeleton-overview,
  .planner-insight-skeleton {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .planner-toolbar-skeleton {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .skeleton-panel {
    padding: 20px;
    border-radius: 22px;
  }

  .planner-skeleton-overview,
  .planner-insight-skeleton,
  .planner-week-skeleton {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
