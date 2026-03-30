<script setup lang="ts">
import Skeleton from "../ui/Skeleton.vue";
</script>

<template>
  <div class="email-skeleton">
    <section class="skeleton-panel email-tabs-skeleton">
      <div class="email-tabs-header-skeleton">
        <div class="skeleton-stack">
          <Skeleton width="96px" height="12px" radius="999px" />
          <Skeleton width="52%" height="28px" />
        </div>
        <div class="skeleton-action-row">
          <Skeleton width="132px" height="40px" radius="999px" />
          <Skeleton width="126px" height="40px" radius="999px" />
        </div>
      </div>

      <div class="email-tab-skeletons">
        <Skeleton v-for="index in 4" :key="`tab-${index}`" width="110px" height="38px" radius="999px" />
      </div>
    </section>

    <section class="email-overview-skeleton">
      <article v-for="index in 4" :key="`overview-${index}`" class="skeleton-panel skeleton-stat-card">
        <Skeleton width="84px" height="12px" radius="999px" />
        <Skeleton width="56px" height="30px" />
      </article>
    </section>

    <section class="email-main-skeleton">
      <article class="skeleton-panel">
        <div class="skeleton-stack">
          <Skeleton width="110px" height="12px" radius="999px" />
          <Skeleton width="44%" height="28px" />
        </div>
        <div class="skeleton-list">
          <Skeleton v-for="index in 3" :key="`campaign-${index}`" height="92px" radius="22px" />
        </div>
      </article>

      <article class="skeleton-panel">
        <div class="skeleton-stack">
          <Skeleton width="100px" height="12px" radius="999px" />
          <Skeleton width="50%" height="28px" />
        </div>
        <div class="skeleton-action-column">
          <Skeleton width="100%" height="46px" radius="18px" />
          <Skeleton width="100%" height="46px" radius="18px" />
          <Skeleton width="100%" height="46px" radius="18px" />
        </div>
        <Skeleton height="86px" radius="22px" />
      </article>
    </section>
  </div>
</template>

<style scoped>
.email-skeleton {
  display: grid;
  gap: 20px;
}

.email-tabs-header-skeleton,
.email-tab-skeletons,
.skeleton-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.email-overview-skeleton {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.email-main-skeleton {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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

.skeleton-stack,
.skeleton-list,
.skeleton-action-column {
  display: grid;
  gap: 12px;
}

@media (max-width: 980px) {
  .email-main-skeleton {
    grid-template-columns: minmax(0, 1fr);
  }

  .email-overview-skeleton {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .email-overview-skeleton {
    grid-template-columns: minmax(0, 1fr);
  }

  .skeleton-panel {
    padding: 20px;
    border-radius: 22px;
  }
}
</style>
