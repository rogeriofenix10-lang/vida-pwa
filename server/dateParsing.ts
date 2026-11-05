const DEFAULT_TIME = { hour: 9, minute: 0 };

function partsInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 3; i++) {
    const p = partsInTimezone(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess = new Date(guess.getTime() + (targetUtc - asUtc));
  }
  return guess;
}

function nextDayOfMonth(now: Date, day: number, timeZone: string) {
  const current = partsInTimezone(now, timeZone);
  let year = current.year;
  let month = current.month;
  if (day <= current.day) month += 1;
  if (month === 13) { month = 1; year += 1; }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return zonedLocalToUtc(year, month, safeDay, DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
}

/** Converts common Brazilian Portuguese date phrases into a real UTC Date. */
export function parseDueDate(input: string, fallbackDate: string | undefined, timeZone = "America/Sao_Paulo", now = new Date()) {
  const text = `${input} ${fallbackDate ?? ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const current = partsInTimezone(now, timeZone);

  if (/\bhoje\b/.test(text)) return zonedLocalToUtc(current.year, current.month, current.day, DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
  if (/\bdepois de amanha\b/.test(text)) {
    const day = new Date(Date.UTC(current.year, current.month - 1, current.day + 2));
    return zonedLocalToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
  }
  if (/\bamanha\b/.test(text)) {
    const tomorrow = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
    return zonedLocalToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
  }

  const explicit = text.match(/\b(?:dia|d)\s*(\d{1,2})\b/);
  if (explicit) return nextDayOfMonth(now, Number(explicit[1]), timeZone);

  const iso = text.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if (iso) return zonedLocalToUtc(Number(iso[1]), Number(iso[2]), Number(iso[3]), DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);

  const br = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/);
  if (br) {
    const year = br[3] ? Number(br[3]) : current.year;
    const month = Number(br[2]);
    const day = Number(br[1]);
    const candidate = zonedLocalToUtc(year, month, day, DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
    return candidate > now || br[3] ? candidate : zonedLocalToUtc(year + 1, month, day, DEFAULT_TIME.hour, DEFAULT_TIME.minute, timeZone);
  }

  return null;
}
