import type { ContentAsset } from "../../../packages/shared-types";
import type { MissionState, MissionTask } from "../components/dashboard/dashboard-types";
import { calculateContentScore } from "./useContentScore";

function selectMissionAsset(pipelineItems: ContentAsset[]): ContentAsset | undefined {
  return (
    pipelineItems.find((asset) => asset.pipelineStage === "review")
    ?? pipelineItems.find((asset) => asset.pipelineStage === "draft")
    ?? pipelineItems.find((asset) => asset.pipelineStage === "scheduled")
    ?? pipelineItems[0]
  );
}

function buildMissionTasks(asset: ContentAsset | undefined, bestTimeLabel: string): MissionTask[] {
  if (!asset) {
    return [
      {
        label: "Create your next post",
        action: "create",
        actionLabel: "Create",
        hint: "Start with one clear idea or voice note.",
      },
      {
        label: "Add one concrete lesson",
        action: "create",
        actionLabel: "Write",
        hint: "Founder content lands when it teaches something specific.",
      },
      {
        label: `Use ${bestTimeLabel}`,
        action: "schedule",
        actionLabel: "Schedule",
        hint: "Pick the next strong window and commit.",
      },
    ];
  }

  const score = calculateContentScore(asset);
  const tasks: MissionTask[] = [];

  if (score.hookScore < 70) {
    tasks.push({
      label: "Improve hook",
      action: "improve_hook",
      actionLabel: "Preview fix",
      hint: "Add tension, contradiction, or curiosity to the first line.",
    });
  }

  if (!score.hasCTA) {
    tasks.push({
      label: "Add CTA",
      action: "add_cta",
      actionLabel: "Preview CTA",
      hint: "Tell the reader what to do, think, or reply with.",
    });
  }

  if (asset.pipelineStage === "draft") {
    tasks.push({
      label: "Move to review",
      action: "move_to_review",
      actionLabel: "Review",
      hint: "Get this out of draft mode once the hook is sharp enough.",
    });
  } else if (asset.pipelineStage === "review") {
    tasks.push({
      label: "Schedule post",
      action: "schedule",
      actionLabel: "Schedule",
      hint: `Lock in the next window: ${bestTimeLabel}.`,
    });
  } else if (asset.pipelineStage === "scheduled") {
    tasks.push({
      label: "Repurpose after posting",
      action: "repurpose",
      actionLabel: "Repurpose",
      hint: "Turn this into a carousel or follow-up angle right after it runs.",
    });
  }

  return tasks.slice(0, 3);
}

function getConsequence(input: {
  postedToday: boolean;
  bestTimeDeltaMinutes?: number | null;
  streakDays: number;
}): Pick<MissionState, "consequence" | "consequenceTone"> {
  if (input.postedToday) {
    return {
      consequence: null,
      consequenceTone: null,
    };
  }

  if (typeof input.bestTimeDeltaMinutes === "number" && input.bestTimeDeltaMinutes > 0 && input.bestTimeDeltaMinutes <= 60) {
    return {
      consequence: "You'll miss today's best posting window if you wait.",
      consequenceTone: "critical",
    };
  }

  if (input.streakDays > 0) {
    return {
      consequence: "Your consistency streak is at risk if you skip today.",
      consequenceTone: "warning",
    };
  }

  return {
    consequence: "You'll lose momentum if you do nothing today.",
    consequenceTone: "warning",
  };
}

export function buildMission(input: {
  pipelineItems: ContentAsset[];
  bestTimeLabel: string;
  bestTimeDeltaMinutes?: number | null;
  postedToday: boolean;
  streakDays: number;
}): MissionState | null {
  const missionAsset = selectMissionAsset(input.pipelineItems);
  const tasks = buildMissionTasks(missionAsset, input.bestTimeLabel);
  const consequenceState = getConsequence({
    postedToday: input.postedToday,
    bestTimeDeltaMinutes: input.bestTimeDeltaMinutes,
    streakDays: input.streakDays,
  });

  if (!missionAsset) {
    return {
      score: 56,
      targetScore: 85,
      tasks,
      primaryAction: tasks[0] ?? null,
      bestTimeLabel: input.bestTimeLabel,
      bestTimeDescription: "Start with one post, then move it into the next best window.",
      ...consequenceState,
    };
  }

  const score = calculateContentScore(missionAsset);

  return {
    score: score.score,
    targetScore: 85,
    tasks,
    primaryAction: tasks[0] ?? null,
    bestTimeLabel: input.bestTimeLabel,
    bestTimeDescription: `Best time to post: ${input.bestTimeLabel}.`,
    ...consequenceState,
    missionAsset,
  };
}

export function useMission() {
  return {
    buildMission,
  };
}
