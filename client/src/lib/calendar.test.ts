import { describe, expect, it } from "vitest";
import {
  attachCalendarIdentity,
  buildCalendarDateTime,
  calendarCanWrite,
  calendarDateFromKey,
  calendarDateKey,
  calendarDateKeyInTimeZone,
  calendarEventIdentity,
  calendarEventOccursOnDate,
  calendarRangeForDates,
  calendarRange,
  calendarDateForDisplay,
  formatCalendarEventPeriod,
  formatCalendarDateTimeInputValue,
  getCalendarGridDates,
  parseAgendaQuestion,
} from "./calendar";

describe("calendar period and event helpers", () => {
  const now = new Date(2026, 10, 15, 18, 30);

  it("creates explicit local day, Monday-based week, and month ranges", () => {
    const day = calendarRange(now, "day");
    const week = calendarRange(now, "week");
    const month = calendarRange(now, "month");

    expect(calendarDateKey(day.start)).toBe("2026-11-15");
    expect(calendarDateKey(day.end)).toBe("2026-11-16");
    expect(calendarDateKey(week.start)).toBe("2026-11-09");
    expect(calendarDateKey(week.end)).toBe("2026-11-16");
    expect(calendarDateKey(month.start)).toBe("2026-11-01");
    expect(calendarDateKey(month.end)).toBe("2026-12-01");
    expect(Date.parse(day.timeMax)).toBeGreaterThan(Date.parse(day.timeMin));
  });

  it("resolves today, tomorrow, week, and month agenda questions deterministically", () => {
    const today = parseAgendaQuestion("Quais compromissos tenho hoje?", now);
    const tomorrow = parseAgendaQuestion("Tem evento amanhã na agenda?", now);
    const week = parseAgendaQuestion("Liste os compromissos desta semana", now);
    const month = parseAgendaQuestion("Quantas reuniões neste mês?", now);

    expect(today?.range.mode).toBe("day");
    expect(calendarDateKey(today!.range.start)).toBe("2026-11-15");
    expect(tomorrow?.range.mode).toBe("day");
    expect(calendarDateKey(tomorrow!.range.start)).toBe("2026-11-16");
    expect(week?.range.mode).toBe("week");
    expect(calendarDateKey(week!.range.start)).toBe("2026-11-09");
    expect(month?.range.mode).toBe("month");
    expect(calendarDateKey(month!.range.start)).toBe("2026-11-01");
    expect(parseAgendaQuestion("Crie uma reunião amanhã", now)).toBeNull();
    expect(parseAgendaQuestion("Como organizar meus documentos?", now)).toBeNull();
  });

  it("parses inclusive explicit date intervals and rejects invalid or reversed ranges", () => {
    const interval = parseAgendaQuestion("Liste compromissos na agenda de 12/11/2026 a 15/11/2026", now);
    expect(interval?.range.mode).toBe("custom");
    expect(calendarDateKey(interval!.range.start)).toBe("2026-11-12");
    expect(calendarDateKey(interval!.range.end)).toBe("2026-11-16");
    expect(Date.parse(interval!.range.timeMax)).toBeGreaterThan(Date.parse(interval!.range.timeMin));
    expect(parseAgendaQuestion("Eventos da agenda entre 2026-11-16 e 2026-11-12", now)).toBeNull();
    expect(() => calendarRangeForDates(new Date(2026, 10, 16), new Date(2026, 10, 12))).toThrow(/data final/i);
  });

  it("keeps all-day dates stable and treats Calendar end dates as exclusive", () => {
    const allDay = {
      id: "holiday",
      summary: "Feriado",
      start: { date: "2026-11-15" },
      end: { date: "2026-11-16" },
      calendarId: "primary",
      calendarName: "Principal",
      accessRole: "owner",
      identity: "primary:holiday",
    };

    expect(calendarDateForDisplay(allDay.start)).toBe("15/11/2026");
    expect(formatCalendarEventPeriod(allDay)).toBe("Dia inteiro · 15/11/2026");
    expect(calendarEventOccursOnDate(allDay, calendarDateFromKey("2026-11-15")!)).toBe(true);
    expect(calendarEventOccursOnDate(allDay, calendarDateFromKey("2026-11-16")!)).toBe(false);
    const long = { ...allDay, end: { date: "2026-11-18" } };
    expect(calendarEventOccursOnDate(long, calendarDateFromKey("2026-11-17")!)).toBe(true);
    expect(calendarEventOccursOnDate(long, calendarDateFromKey("2026-11-18")!)).toBe(false);
    const timed = { ...allDay, start: { dateTime: "2026-11-15T09:00:00-03:00", timeZone: "America/Sao_Paulo" }, end: { dateTime: "2026-11-17T00:00:00-03:00" } };
    expect(calendarEventOccursOnDate(timed, calendarDateFromKey("2026-11-16")!)).toBe(true);
    expect(calendarEventOccursOnDate(timed, calendarDateFromKey("2026-11-17")!)).toBe(false);
  });

  it("formats and edits timed events in their declared timezone", () => {
    const eventTime = { dateTime: "2026-01-01T12:00:00Z", timeZone: "America/Sao_Paulo" };
    expect(formatCalendarDateTimeInputValue(eventTime)).toBe("2026-01-01T09:00");
    expect(calendarDateKeyInTimeZone({ dateTime: "2026-01-01T02:30:00Z", timeZone: "America/Sao_Paulo" })).toBe("2025-12-31");
    expect(buildCalendarDateTime("2026-01-01T09:30", eventTime)).toEqual({
      dateTime: "2026-01-01T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    });
  });

  it("uses an event identity composed from calendar and event IDs", () => {
    const first = attachCalendarIdentity({ id: "same-id", summary: "A" }, {
      id: "calendar-a", summary: "Agenda A", accessRole: "writer",
    });
    const second = attachCalendarIdentity({ id: "same-id", summary: "B" }, {
      id: "calendar-b", summary: "Agenda B", accessRole: "reader",
    });

    expect(first.identity).toBe("calendar-a:same-id");
    expect(second.identity).toBe("calendar-b:same-id");
    expect(calendarEventIdentity(first)).not.toBe(calendarEventIdentity(second));
    expect(first.calendarName).toBe("Agenda A");
    expect(second.accessRole).toBe("reader");
  });

  it("permits writes only for owner/writer roles and builds a Monday-first month grid", () => {
    expect(calendarCanWrite("owner")).toBe(true);
    expect(calendarCanWrite("writer")).toBe(true);
    expect(calendarCanWrite("reader")).toBe(false);
    expect(calendarCanWrite("freeBusyReader")).toBe(false);
    expect(calendarCanWrite(undefined)).toBe(false);
    const grid = getCalendarGridDates(now);
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1);
  });
});
