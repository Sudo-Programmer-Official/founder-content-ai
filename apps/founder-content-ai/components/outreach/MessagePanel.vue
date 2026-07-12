<script setup lang="ts">
import type {
  OutreachLead,
  OutreachMessage,
  OutreachMessageTone,
  OutreachQueue,
} from "../../../../packages/shared-types";

defineProps<{
  lead: OutreachLead | null;
  messageDraft: string;
  tone: OutreachMessageTone;
  queue: OutreachQueue;
  isGenerating: boolean;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  (event: "update:messageDraft", value: string): void;
  (event: "tone-change", tone: OutreachMessageTone): void;
  (event: "regenerate"): void;
  (event: "send"): void;
  (event: "save"): void;
  (event: "next"): void;
  (event: "generate-reply"): void;
}>();

function messageMetaLabel(message: OutreachMessage): string {
  if (message.type === "reply") {
    return "Reply";
  }

  if (message.type === "followup") {
    return "Follow-up";
  }

  if (message.type === "draft") {
    return "Draft";
  }

  return "Initial DM";
}
</script>

<template>
  <section class="dashboard-panel message-panel">
    <template v-if="lead">
      <div class="panel-header">
        <div>
          <p class="panel-meta">Selected Lead</p>
          <h2>{{ lead.name }}</h2>
          <p class="panel-description">{{ lead.bio }}</p>
        </div>
        <a class="panel-link" :href="lead.profileUrl" target="_blank" rel="noreferrer">
          Open profile
        </a>
      </div>

      <div class="lead-highlight">
        <strong>Recent post</strong>
        <p>{{ lead.recentPost }}</p>
      </div>

      <div class="tone-row">
        <button
          v-for="option in ['casual', 'direct', 'curious']"
          :key="option"
          type="button"
          class="tone-button"
          :data-active="tone === option"
          @click="emit('tone-change', option as OutreachMessageTone)"
        >
          {{ option }}
        </button>
      </div>

      <label class="dashboard-field">
        <span>AI message</span>
        <textarea
          :value="messageDraft"
          rows="9"
          placeholder="Generate a message for this lead."
          @input="emit('update:messageDraft', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>

      <div class="action-row">
        <button type="button" class="dashboard-button" :disabled="isSaving" @click="emit('send')">
          {{ isSaving ? "Sending..." : lead.replyContent ? "Send response" : "Send" }}
        </button>
        <button
          type="button"
          class="dashboard-button secondary"
          :disabled="isGenerating"
          @click="emit('regenerate')"
        >
          {{ isGenerating ? "Generating..." : "Regenerate" }}
        </button>
        <button type="button" class="dashboard-button secondary" :disabled="isSaving" @click="emit('save')">
          Save
        </button>
        <button type="button" class="dashboard-button secondary" @click="emit('next')">
          Next lead
        </button>
      </div>

      <div v-if="lead.replyContent" class="reply-box">
        <strong>Reply detected</strong>
        <p>{{ lead.replyContent }}</p>
        <div class="action-row">
          <button
            type="button"
            class="dashboard-button secondary small-button"
            :disabled="isGenerating"
            @click="emit('generate-reply')"
          >
            Generate reply
          </button>
        </div>
      </div>

      <div class="history-block">
        <div class="panel-header compact-header">
          <div>
            <p class="panel-meta">Message History</p>
            <h3>Context stays visible</h3>
          </div>
          <span class="history-shortcuts">
            {{ queue === 'followups' ? 'Follow-up mode' : 'New lead mode' }}
          </span>
        </div>

        <div class="history-list">
          <article
            v-for="message in lead.messageHistory"
            :key="message.id"
            class="history-item"
            :data-author="message.author"
          >
            <div class="history-item-meta">
              <strong>{{ messageMetaLabel(message) }}</strong>
              <span>{{ new Date(message.sentAt ?? message.createdAt).toLocaleString() }}</span>
            </div>
            <p>{{ message.content }}</p>
          </article>

          <div v-if="lead.messageHistory.length === 0" class="history-item empty">
            No prior messages yet.
          </div>
        </div>
      </div>

      <p class="shortcut-note">Shortcuts: Cmd/Ctrl + Enter send, Cmd/Ctrl + R regenerate, Cmd/Ctrl + Arrow Down next lead.</p>
    </template>

    <template v-else>
      <div class="empty-panel">
        <p class="panel-meta">Message Panel</p>
        <h2>Select a lead</h2>
        <p class="panel-description">
          Pick one lead from the queue to generate a message, edit it, and move through the outreach loop.
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.message-panel,
.history-block,
.history-list {
  display: grid;
  gap: 16px;
}

.panel-description,
.lead-highlight p,
.reply-box p,
.history-item p,
.shortcut-note {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.panel-link,
.history-shortcuts {
  color: var(--fc-text-muted);
  font-size: 0.9rem;
}

.lead-highlight,
.reply-box,
.history-item {
  display: grid;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.reply-box {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-success-bg) 34%, var(--fc-panel-bg));
}

.tone-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.tone-button {
  padding: 10px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  font: inherit;
  cursor: pointer;
  text-transform: capitalize;
}

.tone-button[data-active="true"] {
  border-color: var(--fc-accent);
  background: color-mix(in srgb, var(--fc-accent) 12%, var(--fc-panel-bg));
}

.history-item-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.history-item[data-author="lead"] {
  border-color: color-mix(in srgb, var(--fc-info-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-info-bg) 36%, var(--fc-panel-bg));
}

.history-item.empty {
  color: var(--fc-text-muted);
}

.compact-header {
  align-items: center;
}

.shortcut-note {
  font-size: 0.9rem;
}
</style>
