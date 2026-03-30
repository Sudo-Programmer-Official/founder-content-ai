export interface TimezoneDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function createFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseParts(value: Date | string, timezone: string): TimezoneDateParts {
  const formatter = createFormatter(timezone);
  const parts = formatter.formatToParts(new Date(value));
  const lookup = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(lookup.get("year") ?? 0),
    month: Number(lookup.get("month") ?? 1),
    day: Number(lookup.get("day") ?? 1),
    hour: Number(lookup.get("hour") ?? 0),
    minute: Number(lookup.get("minute") ?? 0),
    second: Number(lookup.get("second") ?? 0),
    weekday: WEEKDAY_INDEX[lookup.get("weekday") ?? "Sun"] ?? 0,
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = parseParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

export function detectUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function toDateKeyInTimezone(value: Date | string, timezone: string): string {
  const parts = parseParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function toTimeValueInTimezone(value: Date | string, timezone: string): string {
  const parts = parseParts(value, timezone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatDateInTimezone(
  value: Date | string,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options,
  }).format(new Date(value));
}

export function formatTimeWithZone(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function startOfWeekDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const weekday = cursor.getUTCDay();
  const distanceFromMonday = (weekday + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - distanceFromMonday);

  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
}

export function convertZonedDateTimeToUtcIso(
  dateKey: string,
  timeValue: string,
  timezone: string,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = new Date(utcGuess - getTimezoneOffsetMs(new Date(utcGuess), timezone));
  const refinedOffset = getTimezoneOffsetMs(firstPass, timezone);
  const corrected = new Date(utcGuess - refinedOffset);
  return corrected.toISOString();
}
