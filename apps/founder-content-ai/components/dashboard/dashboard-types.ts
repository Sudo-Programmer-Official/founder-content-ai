import type {
  ContentAsset,
  ContentPipelineColumn,
  ContentPipelineStage,
  IdeaOption,
  IdeaInboxItem,
} from "../../../../packages/shared-types";

export type QuickCreateAction = "speak" | "write" | "repurpose" | "daily-idea";

export interface PipelineDraftState {
  title: string;
  textContent: string;
  status: ContentPipelineStage;
}

export interface ContentScoreResult {
  score: number;
  hookScore: number;
  viralScore: number;
  hasCTA: boolean;
  structure: "flat" | "story" | "list";
  length: number;
  label: string;
  detail: string;
  highlight: boolean;
  expectedReach: "Low" | "Medium" | "High";
  engagementOutlook: string;
  suggestedTone?: string;
  suggestedFormat?: string;
}

export interface ContentSuggestion {
  severity: "critical" | "important" | "optional";
  tone: "negative" | "neutral" | "positive";
  label: string;
  message: string;
  action: "fix_hook" | "expand_post" | "change_format" | "advance";
  priority: number;
}

export interface MissionTask {
  label: string;
  action: "improve_hook" | "add_cta" | "move_to_review" | "schedule" | "repurpose" | "create";
  actionLabel: string;
  hint?: string;
}

export interface MissionState {
  score: number;
  targetScore: number;
  tasks: MissionTask[];
  primaryAction: MissionTask | null;
  bestTimeLabel: string;
  bestTimeDescription: string;
  consequence: string | null;
  consequenceTone: "warning" | "critical" | null;
  missionAsset?: ContentAsset;
}

export interface AISuggestion {
  type: "create" | "fix" | "repurpose" | "predict";
  title: string;
  description: string;
  action: QuickCreateAction | "focus_asset";
  actionLabel: string;
  priority: number;
  recommended?: boolean;
  severity?: "critical" | "important" | "optional";
  assetId?: string;
  idea?: IdeaOption;
}

export interface PipelineCardModel {
  asset: ContentAsset;
  score: ContentScoreResult;
  draftScore: ContentScoreResult;
  suggestions: ContentSuggestion[];
  primaryVerdict: ContentSuggestion | null;
  nextActionCopy: string;
  stageActionLabel: string | null;
  draft: PipelineDraftState;
  isEditing: boolean;
  isSaving: boolean;
}

export interface PipelineColumnModel extends Omit<ContentPipelineColumn, "items"> {
  items: PipelineCardModel[];
}

export interface AIRailContext {
  mission: MissionState | null;
  pipelineItems: ContentAsset[];
  ideaInbox: IdeaInboxItem[];
  dailyIdea?: IdeaOption;
  postedToday: boolean;
  bestTimeDeltaMinutes?: number | null;
}
