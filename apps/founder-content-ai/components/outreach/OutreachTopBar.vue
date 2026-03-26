<script setup lang="ts">
import type {
  OutreachLeadFilters,
  OutreachOverview,
  OutreachPlatform,
  OutreachPriority,
  OutreachLeadStatus,
} from "../../../../packages/shared-types";

defineProps<{
  overview: OutreachOverview | null;
  filters: OutreachLeadFilters;
}>();

const emit = defineEmits<{
  (
    event: "filter-change",
    patch: Partial<{
      platform: OutreachPlatform | "all";
      status: OutreachLeadStatus | "all";
      priority: OutreachPriority | "all";
    }>,
  ): void;
}>();
</script>

<template>
  <section class="dashboard-panel outreach-topbar">
    <div class="metrics-row">
      <article class="metric-chip">
        <span>Leads</span>
        <strong>{{ overview?.metrics.leads ?? 0 }}</strong>
      </article>
      <article class="metric-chip">
        <span>Sent</span>
        <strong>{{ overview?.metrics.sent ?? 0 }}</strong>
      </article>
      <article class="metric-chip">
        <span>Replies</span>
        <strong>{{ overview?.metrics.replies ?? 0 }}</strong>
      </article>
      <article class="metric-chip">
        <span>Conversions</span>
        <strong>{{ overview?.metrics.conversions ?? 0 }}</strong>
      </article>
      <article class="metric-chip muted">
        <span>Follow-ups due</span>
        <strong>{{ overview?.followupsDue ?? 0 }}</strong>
      </article>
    </div>

    <div class="filter-row">
      <label class="dashboard-field compact-field">
        <span>Platform</span>
        <select
          :value="filters.platform ?? 'all'"
          @change="
            emit('filter-change', {
              platform: ($event.target as HTMLSelectElement).value as OutreachPlatform | 'all',
            })
          "
        >
          <option value="all">All</option>
          <option value="linkedin">LinkedIn</option>
          <option value="reddit">Reddit</option>
          <option value="x">X</option>
        </select>
      </label>

      <label class="dashboard-field compact-field">
        <span>Status</span>
        <select
          :value="filters.status ?? 'all'"
          @change="
            emit('filter-change', {
              status: ($event.target as HTMLSelectElement).value as OutreachLeadStatus | 'all',
            })
          "
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="activated">Converted</option>
        </select>
      </label>

      <label class="dashboard-field compact-field">
        <span>Priority</span>
        <select
          :value="filters.priority ?? 'all'"
          @change="
            emit('filter-change', {
              priority: ($event.target as HTMLSelectElement).value as OutreachPriority | 'all',
            })
          "
        >
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
    </div>
  </section>
</template>

<style scoped>
.outreach-topbar,
.metrics-row,
.filter-row {
  display: grid;
  gap: 14px;
}

.metrics-row {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.metric-chip {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.metric-chip span {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.metric-chip strong {
  font-size: 1.35rem;
}

.metric-chip.muted {
  background: color-mix(in srgb, var(--fc-panel-bg) 78%, var(--fc-surface-muted));
}

.filter-row {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.compact-field span {
  font-size: 0.8rem;
}

@media (max-width: 960px) {
  .metrics-row,
  .filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .metrics-row,
  .filter-row {
    grid-template-columns: 1fr;
  }
}
</style>
