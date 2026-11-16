export type CalendarAccessRole = "owner" | "writer" | "reader" | "freeBusyReader" | "unknown" | string;

export type GoogleCalendarDate = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleCalendarInfo = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: CalendarAccessRole;
  backgroundColor?: string;
  timeZone?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarDate;
  end?: GoogleCalendarDate;
  recurrence?: string[];
  originalStartTime?: GoogleCalendarDate;
  htmlLink?: string;
  calendarId: string;
  calendarName: string;
  accessRole: CalendarAccessRole;
  identity: string;
};

export type CalendarPeriodMode = "day" | "week" | "month" | "custom";

export type CalendarRange = {
  mode: CalendarPeriodMode;
  start: Date;
  end: Date;
  timeMin: string;
  timeMax: string;
  label: string;
};

const pad = (value: number) => String(value).padStart(2, "0");

export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarDateFromKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3])
    ? date
    : null;
}

export function shiftCalendarDate(date: Date, amount: number, mode: CalendarPeriodMode): Date {
  if (!Number.isFinite(amount)) return new Date(date);
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  if (mode === "month") next.setMonth(next.getMonth() + amount, 1);
  else next.setDate(next.getDate() + amount * (mode === "week" ? 7 : 1));
  return next;
}

export function calendarRange(date: Date, mode: CalendarPeriodMode): CalendarRange {
  let start: Date;
  let end: Date;
  if (mode === "month") {
    start = new Date(date.getFullYear(), date.getMonth(), 1);
    end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  } else if (mode === "week") {
    const mondayOffset = (date.getDay() + 6) % 7;
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }
  return {
    mode,
    start,
    end,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    label: formatCalendarRangeLabel(start, end, mode),
  };
}

export function formatCalendarRangeLabel(start: Date, end: Date, mode: CalendarPeriodMode): string {
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  if (mode === "day") return formatter.format(start);
  if (mode === "custom") {
    const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1, 12);
    return `${formatter.format(start)}–${formatter.format(lastDay)}`;
  }
  if (mode === "month") {
    const lastDay = new Date(end.getFullYear(), end.getMonth(), 0, 12);
    const monthYear = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(start);
    return `${start.toLocaleDateString("pt-BR", { day: "2-digit" })}–${lastDay.toLocaleDateString("pt-BR", { day: "2-digit" })} de ${monthYear}`;
  }
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1, 12);
  const sameMonth = start.getMonth() === lastDay.getMonth() && start.getFullYear() === lastDay.getFullYear();
  return sameMonth
    ? `${start.toLocaleDateString("pt-BR", { day: "2-digit" })}–${lastDay.toLocaleDateString("pt-BR", { day: "2-digit" })} de ${new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(start)}`
    : `${formatter.format(start)}–${formatter.format(lastDay)}`;
}

export type AgendaQuestion = {
  range: CalendarRange;
  label: string;
};

function parseAgendaDate(value: string, now: Date): Date | null {
  let year: number;
  let month: number;
  let day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    [year, month, day] = value.split("-").map(Number);
  } else {
    const match = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(value);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    const rawYear = match[3];
    year = rawYear ? Number(rawYear) : now.getFullYear();
    if (rawYear?.length === 2) year += year >= 70 ? 1900 : 2000;
  }
  return calendarDateFromKey(`${year}-${pad(month)}-${pad(day)}`);
}

export function calendarRangeForDates(startDate: Date, lastDate: Date): CalendarRange {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const last = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(last.getTime()) || last < start) {
    throw new Error("A data final precisa ser igual ou posterior à data inicial.");
  }
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return {
    mode: "custom",
    start,
    end,
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    label: formatCalendarRangeLabel(start, end, "custom"),
  };
}

export function parseAgendaQuestion(text: string, now = new Date()): AgendaQuestion | null {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!/(agenda|calendario|calendar|compromissos?|eventos?|reunioes?)/.test(normalized)) return null;
  if (/\b(crie|criar|agende|agendar|marque|marcar|edite|editar|altere|alterar|exclua|excluir|delete|cancele|cancelar)\b/.test(normalized)) return null;

  const datePattern = "(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)";
  const interval = new RegExp(`\\b(?:de|entre)\\s+${datePattern}\\s+(?:a|ate|e)\\s+${datePattern}\\b`).exec(normalized);
  if (interval) {
    const startDate = parseAgendaDate(interval[1], now);
    const endDate = parseAgendaDate(interval[2], now);
    if (!startDate || !endDate || endDate < startDate) return null;
    const range = calendarRangeForDates(startDate, endDate);
    return { range, label: `Período selecionado (${range.label})` };
  }

  let mode: CalendarPeriodMode = "month";
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let labelPrefix = "Este mês";
  if (/\b(amanha|dia seguinte)\b/.test(normalized)) {
    mode = "day";
    cursor.setDate(cursor.getDate() + 1);
    labelPrefix = "Amanhã";
  } else if (/\b(hoje|neste dia|no dia de hoje)\b/.test(normalized)) {
    mode = "day";
    labelPrefix = "Hoje";
  } else if (/\b(semana|semanal)\b/.test(normalized)) {
    mode = "week";
    labelPrefix = /\b(proxima semana|semana que vem)\b/.test(normalized) ? "Próxima semana" : "Esta semana";
    if (labelPrefix === "Próxima semana") cursor.setDate(cursor.getDate() + 7);
  } else if (/\b(mes|mensal)\b/.test(normalized)) {
    mode = "month";
    labelPrefix = "Este mês";
  }
  const range = calendarRange(cursor, mode);
  return { range, label: `${labelPrefix} (${range.label})` };
}

export function calendarEventIdentity(event: Pick<GoogleCalendarEvent, "calendarId" | "id">): string {
  return `${event.calendarId || "primary"}:${event.id}`;
}

export function attachCalendarIdentity<T extends Pick<GoogleCalendarEvent, "id">>(
  event: T,
  calendar: Pick<GoogleCalendarInfo, "id" | "summary" | "accessRole">,
): T & Pick<GoogleCalendarEvent, "calendarId" | "calendarName" | "accessRole" | "identity"> {
  const enriched = {
    ...event,
    calendarId: calendar.id,
    calendarName: calendar.summary,
    accessRole: calendar.accessRole,
  };
  return { ...enriched, identity: calendarEventIdentity(enriched) };
}

export function calendarCanWrite(accessRole: CalendarAccessRole | undefined): boolean {
  return accessRole === "owner" || accessRole === "writer";
}

export function calendarDateKeyInTimeZone(value: GoogleCalendarDate | undefined, fallbackTimeZone?: string): string | null {
  if (value?.date && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) return value.date;
  if (!value?.dateTime) return null;
  const instant = new Date(value.dateTime);
  if (!Number.isFinite(instant.getTime())) return null;
  const timeZone = value.timeZone || fallbackTimeZone;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      ...(timeZone ? { timeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return record.year && record.month && record.day ? `${record.year}-${record.month}-${record.day}` : null;
  } catch {
    return calendarDateKey(instant);
  }
}

export function calendarEventOccursOnDate(event: GoogleCalendarEvent, date: Date, fallbackTimeZone?: string): boolean {
  const key = calendarDateKey(date);
  if (event.start?.date) return event.start.date <= key && (event.end?.date ? key < event.end.date : key === event.start.date);
  if (!event.start?.dateTime) return false;
  if (!event.end?.dateTime) return calendarDateKeyInTimeZone(event.start, fallbackTimeZone) === key;
  const timeZone = event.start.timeZone || fallbackTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12);
  try {
    const dayStart = Date.parse(dateTimeLocalToIsoInZone(`${key}T00:00`, timeZone));
    const nextStart = Date.parse(dateTimeLocalToIsoInZone(`${calendarDateKey(nextDate)}T00:00`, timeZone));
    return Date.parse(event.start.dateTime) < nextStart && Date.parse(event.end.dateTime) > dayStart;
  } catch {
    const start = calendarDateKeyInTimeZone(event.start, fallbackTimeZone);
    const end = calendarDateKeyInTimeZone(event.end, fallbackTimeZone);
    return Boolean(start && end && start <= key && key <= end);
  }
}

export function formatCalendarDateTimeInputValue(date?: GoogleCalendarDate): string {
  if (!date?.dateTime) return "";
  const timeZone = date.timeZone ?? (date.dateTime.endsWith("Z") ? "UTC" : undefined);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(date.dateTime));
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      if (values.year && values.month && values.day && values.hour && values.minute)
        return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
    } catch {
      // Use the source wall time if its timezone is invalid.
    }
  }
  const wallTime = date.dateTime.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (wallTime) return wallTime[1];
  const parsed = new Date(date.dateTime);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function dateTimeLocalToIsoInZone(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Informe uma data e hora válidas.");
  const [, year, month, day, hour, minute] = match;
  const desiredWallTime = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  let utcTime = desiredWallTime;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcTime)).map((part) => [part.type, part.value]));
    const displayedWallTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    const difference = displayedWallTime - utcTime;
    if (difference === 0) break;
    utcTime = desiredWallTime - difference;
  }
  const check = Object.fromEntries(formatter.formatToParts(new Date(utcTime)).map((part) => [part.type, part.value]));
  if (`${check.year}-${check.month}-${check.day}T${check.hour}:${check.minute}` !== value)
    throw new Error("Esse horário não existe no fuso selecionado devido à mudança de horário local.");
  return new Date(utcTime).toISOString();
}

export function buildCalendarDateTime(value: string, original?: GoogleCalendarDate): GoogleCalendarDate {
  const timeZone = original?.timeZone ?? (original?.dateTime?.endsWith("Z") ? "UTC" : undefined);
  if (timeZone) return { dateTime: dateTimeLocalToIsoInZone(value, timeZone), timeZone };
  const originalOffset = original?.dateTime?.match(/([+-]\d{2}:\d{2})$/)?.[1];
  if (originalOffset) return { dateTime: `${value}:00${originalOffset}` };
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    dateTime: dateTimeLocalToIsoInZone(value, browserTimeZone),
    timeZone: browserTimeZone,
  };
}

export function calendarDateForDisplay(date?: GoogleCalendarDate): string {
  if (date?.date) {
    const parsed = calendarDateFromKey(date.date);
    return parsed ? parsed.toLocaleDateString("pt-BR") : date.date;
  }
  if (!date?.dateTime) return "Data não informada";
  const parsed = new Date(date.dateTime);
  if (Number.isNaN(parsed.getTime())) return date.dateTime;
  const timeZone = date.timeZone ?? (date.dateTime.endsWith("Z") ? "UTC" : undefined);
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(parsed);
  } catch {
    return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
}

export function formatCalendarEventPeriod(event: GoogleCalendarEvent): string {
  const start = event.start;
  const end = event.end;
  if (start?.date) {
    const startDate = calendarDateFromKey(start.date);
    const endDate = end?.date ? calendarDateFromKey(end.date) : null;
    if (!startDate) return `Dia inteiro · ${start.date}`;
    const lastInclusiveDay = endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 1, 12) : startDate;
    const startLabel = startDate.toLocaleDateString("pt-BR");
    const endLabel = lastInclusiveDay.toLocaleDateString("pt-BR");
    return startLabel === endLabel ? `Dia inteiro · ${startLabel}` : `Dia inteiro · ${startLabel}–${endLabel}`;
  }
  const startLabel = calendarDateForDisplay(start);
  if (!end) return startLabel;
  return `${startLabel}–${calendarDateForDisplay(end)}`;
}

export function getCalendarGridDates(date: Date): Date[] {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), firstOfMonth.getDate() - mondayOffset, 12);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12));
}
