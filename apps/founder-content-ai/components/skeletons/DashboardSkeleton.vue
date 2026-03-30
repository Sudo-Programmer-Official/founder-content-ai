<script setup lang="ts">
import Skeleton from "../ui/Skeleton.vue";
</script>

<template>
  <div class="dashboard-skeleton">
    <section class="skeleton-panel skeleton-intro">
      <div class="skeleton-stack">
        <Skeleton width="96px" height="12px" radius="999px" />
        <Skeleton width="38%" height="42px" />
        <Skeleton width="58%" height="16px" />
      </div>

      <div class="skeleton-pill-row">
        <Skeleton width="92px" height="34px" radius="999px" />
        <Skeleton width="140px" height="34px" radius="999px" />
        <Skeleton width="210px" height="34px" radius="999px" />
        <Skeleton width="44px" height="44px" radius="14px" />
      </div>
    </section>

    <div class="dashboard-skeleton-grid">
      <div class="dashboard-skeleton-main">
        <section class="skeleton-panel">
          <div class="skeleton-stack">
            <Skeleton width="84px" height="12px" radius="999px" />
            <Skeleton width="42%" height="28px" />
            <Skeleton width="68%" height="16px" />
          </div>
          <div class="skeleton-action-row">
            <Skeleton width="130px" height="44px" radius="999px" />
            <Skeleton width="144px" height="44px" radius="999px" />
          </div>
        </section>

        <section class="skeleton-stat-grid">
          <article v-for="index in 4" :key="`summary-${index}`" class="skeleton-panel skeleton-stat-card">
            <Skeleton width="72px" height="12px" radius="999px" />
            <Skeleton width="52px" height="30px" />
            <Skeleton width="90%" height="14px" />
          </article>
        </section>

        <section class="skeleton-two-up">
          <article v-for="index in 2" :key="`focus-${index}`" class="skeleton-panel">
            <div class="skeleton-stack">
              <Skeleton width="88px" height="12px" radius="999px" />
              <Skeleton width="54%" height="26px" />
              <Skeleton width="82%" height="15px" />
              <Skeleton width="74%" height="15px" />
            </div>
            <div class="skeleton-action-row">
              <Skeleton width="120px" height="40px" radius="999px" />
              <Skeleton width="132px" height="40px" radius="999px" />
            </div>
          </article>
        </section>

        <section class="skeleton-panel">
          <div class="skeleton-stack">
            <Skeleton width="96px" height="12px" radius="999px" />
            <Skeleton width="34%" height="26px" />
          </div>
          <div class="skeleton-list">
            <Skeleton v-for="index in 5" :key="`activity-${index}`" height="56px" radius="18px" />
          </div>
        </section>
      </div>

      <aside class="skeleton-panel dashboard-skeleton-rail">
        <div class="skeleton-stack">
          <Skeleton width="74px" height="12px" radius="999px" />
          <Skeleton width="62%" height="24px" />
        </div>
        <div class="skeleton-list">
          <Skeleton v-for="index in 6" :key="`rail-${index}`" height="48px" radius="16px" />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.dashboard-skeleton {
  display: grid;
  gap: 20px;
}

.dashboard-skeleton-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 0.8fr);
  gap: 20px;
}

.dashboard-skeleton-main {
  display: grid;
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

.skeleton-intro {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.skeleton-stack {
  display: grid;
  gap: 10px;
}

.skeleton-pill-row,
.skeleton-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.skeleton-stat-grid,
.skeleton-two-up {
  display: grid;
  gap: 16px;
}

.skeleton-stat-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.skeleton-two-up {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.skeleton-stat-card {
  gap: 12px;
}

.skeleton-list {
  display: grid;
  gap: 12px;
}

@media (max-width: 1100px) {
  .dashboard-skeleton-grid,
  .skeleton-two-up {
    grid-template-columns: minmax(0, 1fr);
  }

  .skeleton-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .skeleton-intro {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .skeleton-panel {
    padding: 20px;
    border-radius: 22px;
  }

  .skeleton-stat-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
