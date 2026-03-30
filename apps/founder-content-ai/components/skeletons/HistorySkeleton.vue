<script setup lang="ts">
import Skeleton from "../ui/Skeleton.vue";
</script>

<template>
  <div class="history-skeleton">
    <section class="history-skeleton-overview">
      <article v-for="index in 4" :key="`overview-${index}`" class="skeleton-panel skeleton-stat-card">
        <Skeleton width="76px" height="12px" radius="999px" />
        <Skeleton width="54px" height="30px" />
      </article>
    </section>

    <section class="history-skeleton-main">
      <article class="skeleton-panel">
        <div class="history-toolbar-skeleton">
          <div class="skeleton-stack">
            <Skeleton width="188px" height="30px" />
            <Skeleton width="64%" height="14px" />
          </div>
          <div class="history-toolbar-actions-skeleton">
            <div class="history-tab-skeletons">
              <Skeleton v-for="index in 4" :key="`tab-${index}`" width="88px" height="36px" radius="999px" />
            </div>
            <Skeleton width="240px" height="46px" radius="18px" />
          </div>
        </div>

        <div class="history-list-skeleton">
          <article v-for="index in 5" :key="`row-${index}`" class="history-row-skeleton">
            <div class="history-row-topline">
              <div class="history-chip-skeletons">
                <Skeleton width="34px" height="26px" radius="999px" />
                <Skeleton width="74px" height="26px" radius="999px" />
              </div>
              <Skeleton width="122px" height="14px" />
            </div>
            <Skeleton width="58%" height="22px" />
            <Skeleton width="92%" height="14px" />
            <Skeleton width="74%" height="14px" />
          </article>
        </div>
      </article>

      <aside class="skeleton-panel">
        <div class="skeleton-stack">
          <Skeleton width="88px" height="12px" radius="999px" />
          <Skeleton width="62%" height="28px" />
          <Skeleton width="72%" height="14px" />
        </div>
        <Skeleton height="190px" radius="22px" />
        <div class="skeleton-list">
          <Skeleton height="104px" radius="22px" />
          <Skeleton height="44px" radius="999px" />
          <Skeleton height="44px" radius="999px" />
        </div>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.history-skeleton {
  display: grid;
  gap: 20px;
}

.history-skeleton-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.history-skeleton-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.9fr);
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

.history-toolbar-skeleton {
  display: grid;
  gap: 16px;
}

.history-toolbar-actions-skeleton,
.history-tab-skeletons,
.history-chip-skeletons,
.history-row-topline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.history-toolbar-actions-skeleton {
  justify-content: space-between;
}

.history-list-skeleton,
.skeleton-stack,
.skeleton-list {
  display: grid;
  gap: 12px;
}

.history-row-skeleton {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface) 90%, white 10%);
}

@media (max-width: 1100px) {
  .history-skeleton-main {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .history-skeleton-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .history-toolbar-actions-skeleton {
    justify-content: flex-start;
  }
}

@media (max-width: 560px) {
  .history-skeleton-overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .skeleton-panel {
    padding: 20px;
    border-radius: 22px;
  }
}
</style>
