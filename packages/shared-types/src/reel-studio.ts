export type ReelLanguage = "english" | "hindi" | "hinglish" | "spanish";
export type ReelDurationSeconds = 15 | 30 | 45 | 60;
export type ReelVisualStyle = "neon_tech" | "minimal_motion";
export type ReelAudience = "developers" | "beginners" | "students" | "general";
export type ReelVoice = "alloy" | "ash" | "coral" | "echo" | "nova" | "onyx" | "sage" | "shimmer";
export type ReelProjectStatus = "storyboard_ready" | "queued" | "rendering" | "ready" | "failed";
/** Editorial lifecycle; kept separate from render status so failed renders are restartable. */
export type ReelWorkflowStage = "script_draft" | "approved" | "rendered" | "reviewed" | "published";
export type ReelYouTubeVisibility = "private" | "unlisted" | "public";
export type ReelRenderStage = "voice" | "compose" | "render" | "upload";

export const REEL_LANGUAGES: ReelLanguage[] = ["english", "hindi", "hinglish", "spanish"];
export const REEL_DURATIONS: ReelDurationSeconds[] = [15, 30, 45, 60];
export const REEL_VISUAL_STYLES: ReelVisualStyle[] = ["neon_tech", "minimal_motion"];
export const REEL_AUDIENCES: ReelAudience[] = ["developers", "beginners", "students", "general"];
export const REEL_VOICES: ReelVoice[] = ["alloy", "ash", "coral", "echo", "nova", "onyx", "sage", "shimmer"];

/**
 * Fixed icon vocabulary the AI director may pick from. The renderer maps each
 * name to a deterministic icon, so the LLM never produces drawing code.
 */
export const REEL_ICON_NAMES = [
  "user",
  "users",
  "phone",
  "browser",
  "server",
  "database",
  "queue",
  "cache",
  "cloud",
  "api",
  "gateway",
  "service",
  "lock",
  "bolt",
  "globe",
  "code",
  "chart",
  "mail",
  "cart",
  "payment",
  "search",
  "brain",
  "check",
  "alert",
] as const;

export type ReelIconName = (typeof REEL_ICON_NAMES)[number];

interface ReelSceneBase {
  id: string;
  /** Spoken voice-over for this scene. Scene length follows its narration audio. */
  narration: string;
}

export interface ReelTitleScene extends ReelSceneBase {
  type: "title";
  kicker?: string;
  title: string;
  subtitle?: string;
}

export interface ReelBulletsScene extends ReelSceneBase {
  type: "bullets";
  heading: string;
  bullets: string[];
}

export interface ReelFlowNode {
  id: string;
  label: string;
  icon: ReelIconName;
}

export interface ReelFlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ReelFlowScene extends ReelSceneBase {
  type: "flow";
  heading: string;
  /** chain: left-to-right pipeline, hub: one central node connected to the rest. */
  layout: "chain" | "hub";
  nodes: ReelFlowNode[];
  edges: ReelFlowEdge[];
}

export interface ReelStatScene extends ReelSceneBase {
  type: "stat";
  value: string;
  label: string;
  context?: string;
}

export interface ReelComparisonSide {
  title: string;
  points: string[];
}

export interface ReelComparisonScene extends ReelSceneBase {
  type: "comparison";
  heading: string;
  left: ReelComparisonSide;
  right: ReelComparisonSide;
}

export interface ReelCodeScene extends ReelSceneBase {
  type: "code";
  heading: string;
  language: string;
  code: string;
}

export interface ReelOutroScene extends ReelSceneBase {
  type: "outro";
  title: string;
  cta: string;
}

export type ReelScene =
  | ReelTitleScene
  | ReelBulletsScene
  | ReelFlowScene
  | ReelStatScene
  | ReelComparisonScene
  | ReelCodeScene
  | ReelOutroScene;

export type ReelSceneType = ReelScene["type"];

export const REEL_SCENE_TYPES: ReelSceneType[] = [
  "title",
  "bullets",
  "flow",
  "stat",
  "comparison",
  "code",
  "outro",
];

export interface ReelStoryboard {
  title: string;
  scenes: ReelScene[];
  /** Instagram caption to publish alongside the reel. */
  caption: string;
  hashtags: string[];
}

export interface ReelCaptionCue {
  text: string;
  startFrame: number;
  endFrame: number;
}

export interface ReelTimedScene {
  sceneId: string;
  startFrame: number;
  durationInFrames: number;
  captions: ReelCaptionCue[];
}

/** Everything the Remotion composition needs to draw one reel. A type alias (not an interface) so it satisfies Remotion's Record<string, unknown> props constraint. */
export type ReelRenderProps = {
  storyboard: ReelStoryboard;
  style: ReelVisualStyle;
  language: ReelLanguage;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  timeline: ReelTimedScene[];
  /** Path inside the renderer bundle's public dir, resolved with staticFile(). */
  audioFile?: string;
  brandHandle?: string;
  showCaptions: boolean;
};

export interface ReelProjectSettings {
  language: ReelLanguage;
  durationSeconds: ReelDurationSeconds;
  style: ReelVisualStyle;
  audience: ReelAudience;
  voice: ReelVoice;
  showCaptions: boolean;
  brandHandle?: string;
}

export interface ReelRenderProgress {
  stage: ReelRenderStage;
  percent: number;
}

export interface ReelProject {
  id: string;
  businessId: string;
  prompt: string;
  settings: ReelProjectSettings;
  status: ReelProjectStatus;
  workflowStage: ReelWorkflowStage;
  storyboard: ReelStoryboard;
  progress?: ReelRenderProgress;
  durationMs?: number;
  videoUrl?: string;
  posterUrl?: string;
  errorMessage?: string;
  approvalNote?: string;
  reviewedNote?: string;
  approvedAt?: string;
  reviewedAt?: string;
  publishedAt?: string;
  renderedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReelProjectSummary {
  id: string;
  title: string;
  status: ReelProjectStatus;
  workflowStage: ReelWorkflowStage;
  settings: ReelProjectSettings;
  durationMs?: number;
  posterUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReelStoryboardCreateRequest extends Partial<ReelProjectSettings> {
  businessId: string;
  prompt: string;
}

export interface ReelStoryboardUpdateRequest {
  businessId: string;
  storyboard: ReelStoryboard;
  settings?: Partial<ReelProjectSettings>;
}

export interface ReelSceneRegenerateRequest {
  businessId: string;
  instruction?: string;
}

export interface ReelProjectResponse {
  project: ReelProject;
}

export interface ReelWorkflowActionRequest {
  businessId: string;
  note?: string;
}

export interface ReelYouTubeConnection {
  connected: boolean;
  channelId?: string;
  channelTitle?: string;
  accountEmail?: string;
  status?: "connected" | "error";
}

export interface ReelYouTubePublishRequest {
  businessId: string;
  visibility?: ReelYouTubeVisibility;
}

export interface ReelYouTubePublication {
  videoId: string;
  videoUrl: string;
  visibility: ReelYouTubeVisibility;
  publishedAt: string;
}

export interface ReelYouTubePublishResponse {
  project: ReelProject;
  publication: ReelYouTubePublication;
}

export interface ReelProjectListResponse {
  projects: ReelProjectSummary[];
}
