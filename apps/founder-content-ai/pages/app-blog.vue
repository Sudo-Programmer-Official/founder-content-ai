<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useProductAccessContext } from "../access/product-access-context";
import {
  requestWorkspaceBlogDraftCreate,
  requestWorkspaceBlogUnpublishBySlug,
  requestWorkspaceBlogsPublish,
  requestWorkspacePublishedBlogs,
  type WorkspacePublishedBlogEntry,
} from "../services/workspace-blog-service";

const { activeBusinessId, isFeatureEnabled } = useProductAccessContext();

const loading = ref(false);
const publishing = ref(false);
const publishingWithBuild = ref(false);
const unpublishing = ref(false);
const creatingDraft = ref(false);
const errorMessage = ref("");
const successMessage = ref("");
const manualSlug = ref("");
const posts = ref<WorkspacePublishedBlogEntry[]>([]);
const draftTitle = ref("");
const draftSlug = ref("");
const draftSummary = ref("");
const draftTags = ref("");
const draftKeywords = ref("");
const draftImage = ref("");
const draftContent = ref("");
const draftPublishNow = ref(false);

const businessId = computed(() => activeBusinessId.value?.trim() || "");
const canUseBlogPublishing = computed(
  () => Boolean(businessId.value) && isFeatureEnabled("blog_publishing"),
);

async function loadPosts(): Promise<void> {
  if (!businessId.value || !canUseBlogPublishing.value) {
    posts.value = [];
    return;
  }

  loading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestWorkspacePublishedBlogs(businessId.value);
    posts.value = response.posts;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load blog posts.";
  } finally {
    loading.value = false;
  }
}

async function publish(runBuild: boolean): Promise<void> {
  if (!businessId.value || !canUseBlogPublishing.value) {
    return;
  }

  if (runBuild) {
    publishingWithBuild.value = true;
  } else {
    publishing.value = true;
  }

  errorMessage.value = "";
  successMessage.value = "";

  try {
    const response = await requestWorkspaceBlogsPublish(businessId.value, runBuild);
    successMessage.value = `Published ${response.updatedCount} posts for ${response.workspaceSlug}.`;
    await loadPosts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to publish workspace blog.";
  } finally {
    publishing.value = false;
    publishingWithBuild.value = false;
  }
}

async function unpublishSlug(slug: string): Promise<void> {
  if (!businessId.value || !slug || !canUseBlogPublishing.value) {
    return;
  }

  unpublishing.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await requestWorkspaceBlogUnpublishBySlug(businessId.value, slug);
    successMessage.value = `Unpublished ${slug}.`;
    manualSlug.value = "";
    await loadPosts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to unpublish blog post.";
  } finally {
    unpublishing.value = false;
  }
}

async function submitManualUnpublish(): Promise<void> {
  await unpublishSlug(manualSlug.value.trim());
}

async function createDraft(): Promise<void> {
  if (!businessId.value || !canUseBlogPublishing.value) {
    return;
  }

  const title = draftTitle.value.trim();
  const content = draftContent.value.trim();
  if (!title || !content) {
    errorMessage.value = "Title and content are required.";
    return;
  }

  creatingDraft.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const response = await requestWorkspaceBlogDraftCreate({
      businessId: businessId.value,
      title,
      content,
      summary: draftSummary.value.trim() || undefined,
      slug: draftSlug.value.trim() || undefined,
      tags: draftTags.value.split(",").map((entry) => entry.trim()).filter(Boolean),
      keywords: draftKeywords.value.split(",").map((entry) => entry.trim()).filter(Boolean),
      image: draftImage.value.trim() || undefined,
      publishNow: draftPublishNow.value,
    });

    successMessage.value = draftPublishNow.value
      ? `Created and marked as posted: ${response.slug}`
      : `Created draft: ${response.slug}`;

    draftTitle.value = "";
    draftSlug.value = "";
    draftSummary.value = "";
    draftTags.value = "";
    draftKeywords.value = "";
    draftImage.value = "";
    draftContent.value = "";
    draftPublishNow.value = false;

    await loadPosts();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to create blog draft.";
  } finally {
    creatingDraft.value = false;
  }
}

onMounted(async () => {
  await loadPosts();
});
</script>

<template>
  <section class="dashboard-page blog-page">
    <header class="dashboard-header">
      <p class="dashboard-eyebrow">Workspace publishing</p>
      <h1>Blog publishing</h1>
      <p>
        Publish this workspace blog to the website pipeline, then unpublish by slug when you need to pull a post down.
      </p>
    </header>

    <p v-if="!canUseBlogPublishing" class="dashboard-feedback">
      This workspace does not have <code>blog_publishing</code> enabled yet.
    </p>

    <section v-else class="dashboard-panel blog-actions">
      <button class="dashboard-action" :disabled="publishing || publishingWithBuild" @click="publish(false)">
        {{ publishing ? "Publishing..." : "Publish blog" }}
      </button>
      <button class="dashboard-action" :disabled="publishing || publishingWithBuild" @click="publish(true)">
        {{ publishingWithBuild ? "Publishing + build..." : "Publish + build" }}
      </button>
      <button class="dashboard-action" :disabled="loading" @click="loadPosts">
        {{ loading ? "Refreshing..." : "Refresh posts" }}
      </button>
    </section>

    <section v-if="canUseBlogPublishing" class="dashboard-panel blog-compose">
      <h2>Create blog draft</h2>
      <div class="blog-compose-grid">
        <input v-model="draftTitle" class="dashboard-input" type="text" placeholder="Title" :disabled="creatingDraft" />
        <input v-model="draftSlug" class="dashboard-input" type="text" placeholder="Slug (optional)" :disabled="creatingDraft" />
        <input v-model="draftSummary" class="dashboard-input" type="text" placeholder="Summary (optional)" :disabled="creatingDraft" />
        <input v-model="draftTags" class="dashboard-input" type="text" placeholder="Tags comma separated (optional)" :disabled="creatingDraft" />
        <input v-model="draftKeywords" class="dashboard-input" type="text" placeholder="Keywords comma separated (optional)" :disabled="creatingDraft" />
        <input v-model="draftImage" class="dashboard-input" type="text" placeholder="Image URL (optional)" :disabled="creatingDraft" />
      </div>
      <textarea
        v-model="draftContent"
        class="dashboard-input blog-content-input"
        placeholder="Write markdown blog content..."
        :disabled="creatingDraft"
      />
      <label class="blog-compose-checkbox">
        <input v-model="draftPublishNow" type="checkbox" :disabled="creatingDraft" />
        Mark as posted now (includes in next publish sync)
      </label>
      <button class="dashboard-action" :disabled="creatingDraft" @click="createDraft">
        {{ creatingDraft ? "Creating..." : "Create draft" }}
      </button>
    </section>

    <p v-if="successMessage" class="dashboard-feedback dashboard-feedback-success">{{ successMessage }}</p>
    <p v-if="errorMessage" class="dashboard-feedback dashboard-feedback-error">{{ errorMessage }}</p>

    <section v-if="canUseBlogPublishing" class="dashboard-panel blog-unpublish">
      <h2>Unpublish by slug</h2>
      <div class="blog-unpublish-row">
        <input
          v-model="manualSlug"
          class="dashboard-input"
          type="text"
          placeholder="post-slug"
          :disabled="unpublishing"
        />
        <button class="dashboard-action" :disabled="unpublishing || !manualSlug.trim()" @click="submitManualUnpublish">
          {{ unpublishing ? "Unpublishing..." : "Unpublish" }}
        </button>
      </div>
    </section>

    <section v-if="canUseBlogPublishing" class="dashboard-panel blog-list">
      <h2>Published posts</h2>
      <p v-if="!loading && posts.length === 0" class="dashboard-feedback">No published posts yet.</p>
      <ul v-else class="blog-slug-list">
        <li v-for="post in posts" :key="`${post.source}-${post.slug}`" class="blog-slug-item">
          <div>
            <strong>{{ post.title }}</strong>
            <p>
              <code>{{ post.slug }}</code> · {{ new Date(post.date).toLocaleDateString() }} · {{ post.source }}
            </p>
          </div>
          <button class="dashboard-action" :disabled="unpublishing" @click="unpublishSlug(post.slug)">
            Unpublish
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.blog-actions,
.blog-compose,
.blog-unpublish,
.blog-list {
  margin-top: 1rem;
}

.blog-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.blog-unpublish-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.dashboard-input {
  min-width: 260px;
  padding: 0.65rem 0.75rem;
}

.blog-compose-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.blog-content-input {
  width: 100%;
  min-height: 180px;
  margin-bottom: 0.75rem;
}

.blog-compose-checkbox {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.blog-slug-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.75rem;
}

.blog-slug-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  padding: 0.75rem;
}

.blog-slug-item p {
  margin: 0.35rem 0 0;
}
</style>
