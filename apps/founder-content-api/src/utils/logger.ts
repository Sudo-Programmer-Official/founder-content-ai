type LogContext = Record<string, unknown>;

function serializeContext(context: LogContext | undefined): string {
  if (!context || Object.keys(context).length === 0) {
    return "";
  }

  try {
    return ` ${JSON.stringify(context)}`;
  } catch {
    return " [unserializable-context]";
  }
}

function log(level: "info" | "warn" | "error", message: string, context?: LogContext): void {
  const prefix = `[founder-content-api]`;
  const line = `${prefix} ${message}${serializeContext(context)}`;

  if (level === "info") {
    console.info(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.error(line);
}

export function logInfo(message: string, context?: LogContext): void {
  log("info", message, context);
}

export function logWarn(message: string, context?: LogContext): void {
  log("warn", message, context);
}

export function logError(message: string, context?: LogContext): void {
  log("error", message, context);
}
