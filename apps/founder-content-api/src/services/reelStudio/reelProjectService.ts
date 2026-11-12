import type { QueryResultRow } from "pg";
import {
  REEL_AUDIENCES,
  REEL_DURATIONS,
  REEL_LANGUAGES,
  REEL_VISUAL_STYLES,
  REEL_VOICES,
  type ReelProject,
  type ReelProjectSettings,
  type ReelProjectStatus,
  type ReelProjectSummary,
  type ReelRenderProgress,
  type ReelStoryboard,
  type ReelWorkflowStage,
} from "../../../../../packages/shared-types/index.ts";
import { createJob } from "../jobQueueService.ts";
import { queryDb } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";
import { createReelMediaUrl } from "./reelMediaStorage.ts";
import { generateReelStoryboard, normalizeStoryboard, regenerateReelScene } from "./reelStoryboardService.ts";

export const REEL_RENDER_JOB_TYPE = "reel_render";
const MAX_PROMPT_CHARS = 2000;

interface ReelProjectRow extends QueryResultRow {
  id: string;
  business_id: string;
  prompt: string;
  settings_json: unknown;
  status: ReelProjectStatus;
  workflow_stage: ReelWorkflowStage;
  storyboard_json: unknown;
  progress_json: unknown;
  video_storage_key: string | null;
  poster_storage_key: string | null;
  duration_ms: number | null;
  error_message: string | null;
  approval_note: string | null;
  reviewed_note: string | null;
  approved_at: Date | string | null;
  reviewed_at: Date | string | null;
  published_at: Date | string | null;
  rendered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const PROJECT_COLUMNS = `
  id, business_id, prompt, settings_json, status, workflow_stage, storyboard_json, progress_json,
  video_storage_key, poster_storage_key, duration_ms, error_message, approval_note, reviewed_note,
  approved_at, reviewed_at, published_at, rendered_at, created_at, updated_at
`;

function toIso(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeReelSettings(
  input: Partial<Record<keyof ReelProjectSettings, unknown>>,
  base?: ReelProjectSettings,
): ReelProjectSettings {
  const brandHandle =
    typeof input.brandHandle === "string" ? input.brandHandle.trim().slice(0, 32) : base?.brandHandle ?? "";

  return {
    language: pick(input.language, REEL_LANGUAGES, base?.language ?? "english"),
    durationSeconds: pick(Number(input.durationSeconds), REEL_DURATIONS, base?.durationSeconds ?? 30),
    style: pick(input.style, REEL_VISUAL_STYLES, base?.style ?? "neon_tech"),
    audience: pick(input.audience, REEL_AUDIENCES, base?.audience ?? "developers"),
    voice: pick(input.voice, REEL_VOICES, base?.voice ?? "nova"),
    showCaptions: typeof input.showCaptions === "boolean" ? input.showCaptions : base?.showCaptions ?? true,
    ...(brandHandle ? { brandHandle: brandHandle.startsWith("@") ? brandHandle : `@${brandHandle}` } : {}),
  };
}

function mapProject(row: ReelProjectRow): ReelProject {
  const settings = normalizeReelSettings((row.settings_json ?? {}) as Partial<ReelProjectSettings>);
  const progress = row.progress_json && typeof row.progress_json === "object"
    ? (row.progress_json as ReelRenderProgress)
    : undefined;

  return {
    id: row.id,
    businessId: row.business_id,
    prompt: row.prompt,
    settings,
    status: row.status,
    workflowStage: row.workflow_stage,
    storyboard: row.storyboard_json as ReelStoryboard,
    progress: row.status === "queued" || row.status === "rendering" ? progress : undefined,
    durationMs: row.duration_ms ?? undefined,
    videoUrl: row.status === "ready" ? createReelMediaUrl(row.video_storage_key) : undefined,
    posterUrl: createReelMediaUrl(row.poster_storage_key),
    errorMessage: row.error_message ?? undefined,
    approvalNote: row.approval_note ?? undefined,
    reviewedNote: row.reviewed_note ?? undefined,
    approvedAt: toIso(row.approved_at),
    reviewedAt: toIso(row.reviewed_at),
    publishedAt: toIso(row.published_at),
    renderedAt: toIso(row.rendered_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapSummary(row: ReelProjectRow): ReelProjectSummary {
  const project = mapProject(row);
  return {
    id: project.id,
    title: project.storyboard?.title || project.prompt.slice(0, 60),
    status: project.status,
    workflowStage: project.workflowStage,
    settings: project.settings,
    durationMs: project.durationMs,
    posterUrl: project.posterUrl,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

async function loadProjectRow(businessId: string, projectId: string): Promise<ReelProjectRow> {
  const result = await queryDb<ReelProjectRow>(
    `select ${PROJECT_COLUMNS} from reel_projects where id = $1::uuid and business_id = $2::uuid`,
    [projectId, businessId],
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "reel_project_not_found", "Reel project not found.");
  }

  return result.rows[0];
}

/** Internal loader for the render worker, which has no business context yet. */
export async function loadReelProjectForRender(projectId: string): Promise<{ project: ReelProject; row: ReelProjectRow } | null> {
  const result = await queryDb<ReelProjectRow>(`select ${PROJECT_COLUMNS} from reel_projects where id = $1::uuid`, [projectId]);
  return result.rows[0] ? { project: mapProject(result.rows[0]), row: result.rows[0] } : null;
}

function assertEditable(row: ReelProjectRow): void {
  if (row.status === "queued" || row.status === "rendering") {
    throw new HttpError(409, "reel_render_in_progress", "This reel is rendering. Wait for it to finish before editing.");
  }
}

function assertWorkflowStage(row: ReelProjectRow, stage: ReelWorkflowStage, message: string): void {
  if (row.workflow_stage !== stage) {
    throw new HttpError(409, "invalid_reel_workflow_stage", message);
  }
}

async function createRevision(input: {
  projectId: string;
  businessId: string;
  userId?: string;
  revisionType: "generated" | "edited" | "scene_regenerated" | "approved" | "reviewed";
  storyboard: ReelStoryboard;
  settings: ReelProjectSettings;
  note?: string;
}): Promise<void> {
  await queryDb(
    `
      insert into reel_project_revisions (
        project_id, business_id, created_by_user_id, revision_number, revision_type,
        storyboard_json, settings_json, note
      )
      select $1::uuid, $2::uuid, $3::uuid,
        coalesce(max(revision_number), 0) + 1,
        $4, $5::jsonb, $6::jsonb, $7
      from reel_project_revisions
      where project_id = $1::uuid
    `,
    [
      input.projectId,
      input.businessId,
      input.userId ?? null,
      input.revisionType,
      JSON.stringify(input.storyboard),
      JSON.stringify(input.settings),
      input.note?.trim().slice(0, 500) || null,
    ],
  );
}

export async function createReelProject(input: {
  businessId: string;
  userId?: string;
  prompt: string;
  settings: Partial<ReelProjectSettings>;
}): Promise<ReelProject> {
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS);

  if (prompt.length < 8) {
    throw new HttpError(400, "reel_prompt_required", "Describe what the reel should explain (at least a sentence).");
  }

  const settings = normalizeReelSettings(input.settings);
  const storyboard = await generateReelStoryboard(prompt, settings);
  const result = await queryDb<ReelProjectRow>(
    `
      insert into reel_projects (business_id, created_by_user_id, prompt, settings_json, status, storyboard_json)
      values ($1::uuid, $2::uuid, $3, $4::jsonb, 'storyboard_ready', $5::jsonb)
      returning ${PROJECT_COLUMNS}
    `,
    [input.businessId, input.userId ?? null, prompt, JSON.stringify(settings), JSON.stringify(storyboard)],
  );

  await createRevision({
    projectId: result.rows[0].id,
    businessId: input.businessId,
    userId: input.userId,
    revisionType: "generated",
    storyboard,
    settings,
  });

  return mapProject(result.rows[0]);
}

export async function listReelProjects(businessId: string): Promise<ReelProjectSummary[]> {
  const result = await queryDb<ReelProjectRow>(
    `select ${PROJECT_COLUMNS} from reel_projects where business_id = $1::uuid order by created_at desc limit 50`,
    [businessId],
  );
  return result.rows.map(mapSummary);
}

export async function getReelProject(businessId: string, projectId: string): Promise<ReelProject> {
  return mapProject(await loadProjectRow(businessId, projectId));
}

export async function loadReelProjectForPublish(
  businessId: string,
  projectId: string,
): Promise<{ project: ReelProject; videoStorageKey: string | null } | null> {
  const row = await loadProjectRow(businessId, projectId);
  return { project: mapProject(row), videoStorageKey: row.video_storage_key };
}

export async function updateReelStoryboard(input: {
  businessId: string;
  projectId: string;
  userId?: string;
  storyboard: unknown;
  settings?: Partial<ReelProjectSettings>;
}): Promise<ReelProject> {
  const row = await loadProjectRow(input.businessId, input.projectId);
  assertEditable(row);
  const storyboard = normalizeStoryboard(input.storyboard);
  const settings = normalizeReelSettings(input.settings ?? {}, mapProject(row).settings);
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set status = 'storyboard_ready',
          storyboard_json = $3::jsonb,
          settings_json = $4::jsonb,
          workflow_stage = 'script_draft',
          approval_note = null,
          reviewed_note = null,
          approved_at = null,
          reviewed_at = null,
          video_storage_key = null,
          poster_storage_key = null,
          duration_ms = null,
          rendered_at = null,
          render_meta_json = '{}'::jsonb,
          updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [input.projectId, input.businessId, JSON.stringify(storyboard), JSON.stringify(settings)],
  );

  await createRevision({
    projectId: input.projectId,
    businessId: input.businessId,
    userId: input.userId,
    revisionType: "edited",
    storyboard,
    settings,
  });

  return mapProject(result.rows[0]);
}

export async function regenerateReelProjectScene(input: {
  businessId: string;
  projectId: string;
  sceneId: string;
  userId?: string;
  instruction?: string;
}): Promise<ReelProject> {
  const row = await loadProjectRow(input.businessId, input.projectId);
  assertEditable(row);
  const project = mapProject(row);
  const storyboard = await regenerateReelScene({
    storyboard: project.storyboard,
    sceneId: input.sceneId,
    instruction: input.instruction?.slice(0, 500),
    settings: project.settings,
    prompt: project.prompt,
  });
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set status = 'storyboard_ready', storyboard_json = $3::jsonb, workflow_stage = 'script_draft',
          approval_note = null, reviewed_note = null, approved_at = null, reviewed_at = null,
          video_storage_key = null, poster_storage_key = null, duration_ms = null,
          rendered_at = null, render_meta_json = '{}'::jsonb, updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [input.projectId, input.businessId, JSON.stringify(storyboard)],
  );

  await createRevision({
    projectId: input.projectId,
    businessId: input.businessId,
    userId: input.userId,
    revisionType: "scene_regenerated",
    storyboard,
    settings: project.settings,
  });

  return mapProject(result.rows[0]);
}

export async function approveReelProject(input: {
  businessId: string;
  projectId: string;
  userId?: string;
  note?: string;
}): Promise<ReelProject> {
  const row = await loadProjectRow(input.businessId, input.projectId);
  assertEditable(row);
  assertWorkflowStage(row, "script_draft", "Only a storyboard draft can be approved.");
  const project = mapProject(row);
  const note = input.note?.trim().slice(0, 500) || null;
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set workflow_stage = 'approved', approval_note = $3, reviewed_note = null,
          approved_at = now(), reviewed_at = null, updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [input.projectId, input.businessId, note],
  );
  await createRevision({
    projectId: input.projectId,
    businessId: input.businessId,
    userId: input.userId,
    revisionType: "approved",
    storyboard: project.storyboard,
    settings: project.settings,
    note: note ?? undefined,
  });
  return mapProject(result.rows[0]);
}

export async function markReelReviewed(input: {
  businessId: string;
  projectId: string;
  userId?: string;
  note?: string;
}): Promise<ReelProject> {
  const row = await loadProjectRow(input.businessId, input.projectId);
  assertWorkflowStage(row, "rendered", "Render the reel before marking it reviewed.");
  if (row.status !== "ready") {
    throw new HttpError(409, "reel_not_ready_for_review", "The reel must finish rendering before review.");
  }
  const project = mapProject(row);
  const note = input.note?.trim().slice(0, 500) || null;
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set workflow_stage = 'reviewed', reviewed_note = $3, reviewed_at = now(), updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [input.projectId, input.businessId, note],
  );
  await createRevision({
    projectId: input.projectId,
    businessId: input.businessId,
    userId: input.userId,
    revisionType: "reviewed",
    storyboard: project.storyboard,
    settings: project.settings,
    note: note ?? undefined,
  });
  return mapProject(result.rows[0]);
}

export async function markReelPublished(businessId: string, projectId: string): Promise<ReelProject> {
  const row = await loadProjectRow(businessId, projectId);
  assertWorkflowStage(row, "reviewed", "Only a reviewed reel can be published.");
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set workflow_stage = 'published', published_at = now(), updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [projectId, businessId],
  );
  return mapProject(result.rows[0]);
}

export async function queueReelRender(businessId: string, projectId: string): Promise<ReelProject> {
  const row = await loadProjectRow(businessId, projectId);
  assertEditable(row);
  assertWorkflowStage(row, "approved", "Approve the storyboard before rendering the reel.");
  const result = await queryDb<ReelProjectRow>(
    `
      update reel_projects
      set status = 'queued', progress_json = $3::jsonb, error_message = null, updated_at = now()
      where id = $1::uuid and business_id = $2::uuid
      returning ${PROJECT_COLUMNS}
    `,
    [projectId, businessId, JSON.stringify({ stage: "voice", percent: 0 } satisfies ReelRenderProgress)],
  );

  try {
    await createJob({
      businessId,
      jobKey: `reel_render:${projectId}`,
      type: REEL_RENDER_JOB_TYPE,
      priority: 50,
      payload: { projectId },
      // Rendering is expensive and failures are usually deterministic (bad input, missing deps).
      maxAttempts: 2,
    });
  } catch (error) {
    await updateReelRenderState(projectId, { status: row.status, progress: null });
    throw error;
  }

  return mapProject(result.rows[0]);
}

export async function deleteReelProject(businessId: string, projectId: string): Promise<void> {
  const row = await loadProjectRow(businessId, projectId);
  assertEditable(row);
  await queryDb(`delete from reel_projects where id = $1::uuid and business_id = $2::uuid`, [projectId, businessId]);
}

export async function updateReelRenderState(
  projectId: string,
  patch: {
    status?: ReelProjectStatus;
    progress?: ReelRenderProgress | null;
    errorMessage?: string | null;
    videoStorageKey?: string;
    posterStorageKey?: string;
    durationMs?: number;
    renderMeta?: Record<string, unknown>;
    markRendered?: boolean;
  },
): Promise<void> {
  await queryDb(
    `
      update reel_projects
      set
        status = coalesce($2, status),
        workflow_stage = case when $11::boolean then 'rendered' else workflow_stage end,
        progress_json = case when $3::boolean then $4::jsonb else progress_json end,
        error_message = case when $5::boolean then $6 else error_message end,
        video_storage_key = coalesce($7, video_storage_key),
        poster_storage_key = coalesce($8, poster_storage_key),
        duration_ms = coalesce($9::int, duration_ms),
        render_meta_json = coalesce($10::jsonb, render_meta_json),
        rendered_at = case when $11::boolean then now() else rendered_at end,
        updated_at = now()
      where id = $1::uuid
    `,
    [
      projectId,
      patch.status ?? null,
      patch.progress !== undefined,
      patch.progress ? JSON.stringify(patch.progress) : null,
      patch.errorMessage !== undefined,
      patch.errorMessage ?? null,
      patch.videoStorageKey ?? null,
      patch.posterStorageKey ?? null,
      patch.durationMs ?? null,
      patch.renderMeta ? JSON.stringify(patch.renderMeta) : null,
      patch.markRendered === true,
    ],
  );
}
