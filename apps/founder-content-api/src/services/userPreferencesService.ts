import type { QueryResultRow } from "pg";
import type {
  AppUser,
  GetUserPreferencesResponse,
  UpdateUserPreferencesRequest,
  UpdateUserPreferencesResponse,
  UserPreferences,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { ensureCurrentUser } from "./authBusinessService.ts";
import { queryDb } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo } from "../utils/logger.ts";

interface UserPreferencesRow extends QueryResultRow {
  user_id: string;
  theme: UserPreferences["theme"];
  font_size: UserPreferences["fontSize"];
  density: UserPreferences["density"];
  layout_mode: UserPreferences["layoutMode"];
  ai_assist_level: UserPreferences["aiAssistLevel"];
  created_at: Date | string;
  updated_at: Date | string;
}

const DEFAULT_PREFERENCES = {
  theme: "light",
  fontSize: "medium",
  density: "comfortable",
  layoutMode: "dashboard",
  aiAssistLevel: "balanced",
} as const satisfies Pick<
  UserPreferences,
  "theme" | "fontSize" | "density" | "layoutMode" | "aiAssistLevel"
>;

const VALID_THEMES = new Set<UserPreferences["theme"]>(["light", "dark", "focus"]);
const VALID_FONT_SIZES = new Set<UserPreferences["fontSize"]>(["small", "medium", "large"]);
const VALID_DENSITIES = new Set<UserPreferences["density"]>(["compact", "comfortable", "spacious"]);
const VALID_LAYOUTS = new Set<UserPreferences["layoutMode"]>(["dashboard", "creator", "planner"]);
const VALID_AI_ASSIST_LEVELS = new Set<UserPreferences["aiAssistLevel"]>([
  "off",
  "minimal",
  "balanced",
  "proactive",
]);

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapRow(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    theme: row.theme,
    fontSize: row.font_size,
    density: row.density,
    layoutMode: row.layout_mode,
    aiAssistLevel: row.ai_assist_level,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function buildDefaultPreferences(user: AppUser): UserPreferences {
  return {
    userId: user.id,
    ...DEFAULT_PREFERENCES,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function validatePreferences(input: UpdateUserPreferencesRequest): void {
  if (input.theme && !VALID_THEMES.has(input.theme)) {
    throw new HttpError(400, "bad_request", "theme is invalid.");
  }

  if (input.fontSize && !VALID_FONT_SIZES.has(input.fontSize)) {
    throw new HttpError(400, "bad_request", "fontSize is invalid.");
  }

  if (input.density && !VALID_DENSITIES.has(input.density)) {
    throw new HttpError(400, "bad_request", "density is invalid.");
  }

  if (input.layoutMode && !VALID_LAYOUTS.has(input.layoutMode)) {
    throw new HttpError(400, "bad_request", "layoutMode is invalid.");
  }

  if (input.aiAssistLevel && !VALID_AI_ASSIST_LEVELS.has(input.aiAssistLevel)) {
    throw new HttpError(400, "bad_request", "aiAssistLevel is invalid.");
  }
}

async function ensurePreferenceRow(userId: string): Promise<void> {
  await queryDb(
    `
      insert into user_preferences (
        user_id,
        theme,
        font_size,
        density,
        layout_mode,
        ai_assist_level
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      on conflict (user_id) do nothing
    `,
    [
      userId,
      DEFAULT_PREFERENCES.theme,
      DEFAULT_PREFERENCES.fontSize,
      DEFAULT_PREFERENCES.density,
      DEFAULT_PREFERENCES.layoutMode,
      DEFAULT_PREFERENCES.aiAssistLevel,
    ],
  );
}

async function loadPreferencesRow(userId: string): Promise<UserPreferencesRow | null> {
  const result = await queryDb<UserPreferencesRow>(
    `
      select
        user_id,
        theme,
        font_size,
        density,
        layout_mode,
        ai_assist_level,
        created_at,
        updated_at
      from user_preferences
      where user_id = $1
      limit 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function getUserPreferences(
  principal: AuthenticatedPrincipal,
): Promise<GetUserPreferencesResponse> {
  const user = await ensureCurrentUser(principal);
  await ensurePreferenceRow(user.id);
  const row = await loadPreferencesRow(user.id);

  if (!row) {
    return {
      preferences: buildDefaultPreferences(user),
      source: "default",
    };
  }

  return {
    preferences: mapRow(row),
    source: "database",
  };
}

export async function updateUserPreferences(
  principal: AuthenticatedPrincipal,
  input: UpdateUserPreferencesRequest,
): Promise<UpdateUserPreferencesResponse> {
  validatePreferences(input);

  const user = await ensureCurrentUser(principal);
  await ensurePreferenceRow(user.id);

  const result = await queryDb<UserPreferencesRow>(
    `
      insert into user_preferences (
        user_id,
        theme,
        font_size,
        density,
        layout_mode,
        ai_assist_level
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
      on conflict (user_id)
      do update set
        theme = coalesce($2, user_preferences.theme),
        font_size = coalesce($3, user_preferences.font_size),
        density = coalesce($4, user_preferences.density),
        layout_mode = coalesce($5, user_preferences.layout_mode),
        ai_assist_level = coalesce($6, user_preferences.ai_assist_level),
        updated_at = now()
      returning
        user_id,
        theme,
        font_size,
        density,
        layout_mode,
        ai_assist_level,
        created_at,
        updated_at
    `,
    [
      user.id,
      input.theme ?? null,
      input.fontSize ?? null,
      input.density ?? null,
      input.layoutMode ?? null,
      input.aiAssistLevel ?? null,
    ],
  );

  const preferences = mapRow(result.rows[0]);

  logInfo("Updated user preferences.", {
    userId: user.id,
    theme: preferences.theme,
    density: preferences.density,
    layoutMode: preferences.layoutMode,
    aiAssistLevel: preferences.aiAssistLevel,
  });

  return {
    preferences,
  };
}
