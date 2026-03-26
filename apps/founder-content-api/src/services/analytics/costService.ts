import type { AICostSummary } from "../../../../../packages/shared-types/index.ts";
import { queryDb } from "../db/client.ts";

interface CostRow {
  total_requests: string | number;
  successful_requests: string | number;
  failed_requests: string | number;
  total_tokens: string | number;
}

interface ModelCostRow {
  model: string;
  requests: string | number;
  tokens_used: string | number;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveEstimatedCostPerThousandTokens(): number {
  const configured = Number(process.env.AI_ESTIMATED_COST_PER_1K_TOKENS_USD ?? "0");
  return Number.isFinite(configured) && configured > 0 ? configured : 0;
}

export async function getAICostSummary(): Promise<AICostSummary> {
  const [summaryResult, modelResult] = await Promise.all([
    queryDb<CostRow>(
      `
        select
          count(*)::int as total_requests,
          count(*) filter (where success = true)::int as successful_requests,
          count(*) filter (where success = false)::int as failed_requests,
          coalesce(sum(tokens_used), 0)::int as total_tokens
        from content_generation_logs
      `,
    ),
    queryDb<ModelCostRow>(
      `
        select
          model,
          count(*)::int as requests,
          coalesce(sum(tokens_used), 0)::int as tokens_used
        from content_generation_logs
        group by model
        order by requests desc, model asc
      `,
    ),
  ]);

  const summary = summaryResult.rows[0];
  const costPerThousandTokens = resolveEstimatedCostPerThousandTokens();
  const totalTokens = toNumber(summary?.total_tokens);
  const estimatedCostUsd = Number(((totalTokens / 1000) * costPerThousandTokens).toFixed(4));

  return {
    totalRequests: toNumber(summary?.total_requests),
    successfulRequests: toNumber(summary?.successful_requests),
    failedRequests: toNumber(summary?.failed_requests),
    totalTokens,
    estimatedCostUsd,
    byModel: modelResult.rows.map((row) => {
      const tokensUsed = toNumber(row.tokens_used);
      return {
        model: row.model,
        requests: toNumber(row.requests),
        tokensUsed,
        estimatedCostUsd: Number(((tokensUsed / 1000) * costPerThousandTokens).toFixed(4)),
      };
    }),
  };
}
