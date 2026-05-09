<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useProductAccessContext } from "../access/product-access-context";
import {
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
const errorMessage = ref("");
const successMessage = ref("");
const manualSlug = ref("");
const posts = ref<WorkspacePublishedBlogEntry[]>([]);

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
