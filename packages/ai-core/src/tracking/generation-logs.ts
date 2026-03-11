export interface GenerationLogEntry {
  feature: string;
  timestamp: string;
  status: "pending" | "success" | "error";
}

export function createGenerationLogEntry(feature: string): GenerationLogEntry {
  return {
    feature,
    timestamp: new Date().toISOString(),
    status: "pending",
  };
}
