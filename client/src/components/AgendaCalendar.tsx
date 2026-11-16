import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, ListChecks } from "lucide-react";
import type { CalendarPeriodMode, CalendarRange, GoogleCalendarEvent, GoogleCalendarInfo } from "@/lib/calendar";
import {
  calendarDateKey,
  calendarEventOccursOnDate,
  getCalendarGridDates,
  shiftCalendarDate,
} from "@/lib/calendar";
import "./AgendaCalendar.css";

export const ALL_CALENDARS = "__all__";

export type AgendaCalendarMode = Extract<CalendarPeriodMode, "day" | "month">;

export type AgendaCalendarProps = {
  date: Date;
  mode: AgendaCalendarMode;
  range: CalendarRange;
  events: GoogleCalendarEvent[];
  calendars: GoogleCalendarInfo[];
  selectedCalendarId: string;
  loading?: boolean;
  truncated?: boolean;
  warnings?: string[];
  onDateChange: (date: Date) => void;
  onModeChange: (mode: AgendaCalendarMode) => void;
  onCalendarChange: (calendarId: string) => void;
};

const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export default function AgendaCalendar({
  date,
  mode,
  range,
  events,
  calendars,
  selectedCalendarId,
  loading = false,
  truncated = false,
  warnings = [],
  onDateChange,
  onModeChange,
  onCalendarChange,
}: AgendaCalendarProps) {
  const currentDateKey = calendarDateKey(date);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
  const selectedEvents = events.filter((event) => calendarEventOccursOnDate(event, date));
  const pageWarnings = [...warnings];
  if (truncated && !pageWarnings.some((warning) => /parcial|limite|truncad/i.test(warning))) {
    pageWarnings.push("A consulta atingiu um limite de páginas ou itens; alguns resultados podem não estar listados.");
  }

  const navigatePeriod = (amount: number) => {
    onDateChange(shiftCalendarDate(date, amount, mode));
  };

  return (
    <section className="agenda-calendar" aria-label="Calendário e compromissos">
      <div className="agenda-calendar__toolbar">
        <div className="agenda-calendar__tabs" role="group" aria-label="Visualização da Agenda">
          <button
            type="button"
            className={`agenda-calendar__tab${mode === "month" ? " is-active" : ""}`}
            onClick={() => onModeChange("month")}
            aria-pressed={mode === "month"}
          >
            <CalendarDays size={16} aria-hidden="true" /> Calendário
          </button>
          <button
            type="button"
            className={`agenda-calendar__tab${mode === "day" ? " is-active" : ""}`}
            onClick={() => onModeChange("day")}
            aria-pressed={mode === "day"}
          >
            <ListChecks size={16} aria-hidden="true" /> Compromissos
          </button>
        </div>

        <label className="agenda-calendar__source">
          <span>Agenda de origem</span>
          <select
            value={selectedCalendarId}
            onChange={(event) => onCalendarChange(event.target.value)}
            aria-label="Selecionar agenda de origem"
            disabled={loading}
          >
            <option value={ALL_CALENDARS}>Todas as agendas acessíveis</option>
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.summary}{calendar.primary ? " · principal" : ""}
                {calendar.accessRole === "reader" || calendar.accessRole === "freeBusyReader" ? " · somente leitura" : ""}
              </option>
            ))}
          </select>
        </label>

        <a
          className="agenda-calendar__google-link"
          href="https://calendar.google.com/calendar/u/0/r"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir Google Agenda em uma nova aba"
        >
          Abrir Google Agenda <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>

      <div className="agenda-calendar__period">
        <button type="button" className="agenda-calendar__nav" onClick={() => navigatePeriod(-1)} aria-label={mode === "month" ? "Mês anterior" : "Dia anterior"}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <div className="agenda-calendar__period-label" aria-live="polite">
          <strong>{mode === "month" ? monthLabel : `Compromissos · ${range.label}`}</strong>
          <span>Período consultado: {range.label}</span>
        </div>
        <button type="button" className="agenda-calendar__nav" onClick={() => navigatePeriod(1)} aria-label={mode === "month" ? "Próximo mês" : "Próximo dia"}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="agenda-calendar__today"
          onClick={() => onDateChange(new Date())}
          disabled={loading}
        >
          Hoje
        </button>
      </div>

      {mode === "month" && (
        <div className="agenda-calendar__month" aria-label={`Calendário mensal de ${monthLabel}`}>
          <div className="agenda-calendar__weekdays" aria-hidden="true">
            {weekDays.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="agenda-calendar__days">
            {getCalendarGridDates(date).map((day) => {
              const key = calendarDateKey(day);
              const count = events.filter((event) => calendarEventOccursOnDate(event, day)).length;
              const inMonth = day.getMonth() === date.getMonth();
              return (
                <button
                  type="button"
                  key={key}
                  className={`agenda-calendar__day${inMonth ? "" : " is-outside"}${key === currentDateKey ? " is-selected" : ""}${count ? " has-events" : ""}`}
                  onClick={() => onDateChange(day)}
                  aria-pressed={key === currentDateKey}
                  aria-label={`${day.toLocaleDateString("pt-BR", { dateStyle: "full" })}${count ? `, ${count} ${count === 1 ? "compromisso" : "compromissos"}` : ", sem compromissos listados"}`}
                >
                  <span>{day.getDate()}</span>
                  <small>{count ? count : ""}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="agenda-calendar__period-note" role="status">
        {loading ? "Consultando as agendas autorizadas…" : "As ocorrências recorrentes são expandidas somente dentro do período consultado."}
      </div>
      {pageWarnings.map((warning, index) => (
        <p className="agenda-calendar__warning" role="status" key={`${warning}-${index}`}>
          Consulta parcial ou limitada: {warning}
        </p>
      ))}
      {calendars.length === 0 && !loading && (
        <p className="agenda-calendar__local-note">Calendário local vazio. Nenhum compromisso de exemplo foi inventado; os eventos Google aparecem somente após autorização.</p>
      )}
      {mode === "month" && (
        <p className="agenda-calendar__selected-day">Compromissos de {date.toLocaleDateString("pt-BR", { dateStyle: "full" })}: {selectedEvents.length}</p>
      )}
    </section>
  );
}
