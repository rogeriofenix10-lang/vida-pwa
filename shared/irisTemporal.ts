// Dates are civil date keys, not UTC midnight interpreted in the browser's zone.
export const DEFAULT_IRIS_TIME_ZONE = "America/Sao_Paulo";
export type IrisClockContext = {
  instant: string;
  localDate: string;
  localTime: string;
  weekday: string;
  timeZone: string;
};

export function validIrisTimeZone(value: unknown): string {
  if (typeof value === "string" && value.length <= 80) {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format();
      return value;
    } catch { /* Use a safe fallback, never insert arbitrary text in a prompt. */ }
  }
  return DEFAULT_IRIS_TIME_ZONE;
}

export function deviceIrisTimeZone(): string {
  try { return validIrisTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { return DEFAULT_IRIS_TIME_ZONE; }
}

export function createIrisClockContext(now = new Date(), zone: unknown = deviceIrisTimeZone()): IrisClockContext {
  const timeZone = validIrisTimeZone(zone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? "";
  return {
    instant: now.toISOString(),
    localDate: `${part("year")}-${part("month")}-${part("day")}`,
    localTime: `${part("hour")}:${part("minute")}:${part("second")}`,
    weekday: new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long" }).format(now),
    timeZone,
  };
}

export function irisTemporalPrompt(clock: IrisClockContext): string {
  return `Contexto temporal atualizado nesta solicitação: data atual ${clock.localDate}, ${clock.weekday}; hora ${clock.localTime}; fuso ${clock.timeZone}; instante ${clock.instant}. Use essa data para hoje, amanhã e próximo, mesmo se o histórico mencionar uma data antiga. Não diga que desconhece a data atual e não peça ao usuário para informá-la. O fuso não revela cidade, estado ou localização. Responda apenas ao pedido: singular pede um resultado; plural pede uma lista; quantidade, período e localidade explícitos devem ser respeitados. Não acrescente fatos, compromissos, valores ou datas sem evidência; diga quando não souber. Se uma ambiguidade mudar a resposta, esclareça somente o necessário. Não afirme ter consultado uma fonte, conta ou serviço sem que essa consulta realmente tenha ocorrido. Feriados exigem base verificável, e pontos facultativos não são feriados nacionais.`;
}

const SOURCES = {
  fixed: "https://www2.camara.leg.br/legin/fed/lei/1940-1949/lei-662-6-abril-1949-347136-normaatualizada-pl.html",
  aparecida: "https://www.planalto.gov.br/ccivil_03/leis/l6802.htm",
  conscience: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm",
  federal2026: "https://www.gov.br/gestao/pt-br/assuntos/noticias/2025/dezembro/confira-o-calendario-oficial-de-feriados-nacionais-e-pontos-facultativos-em-2026",
};
export type IrisHoliday = { date: string; name: string; source: string };
const FIXED: Array<[string, string, string]> = [
  ["01-01", "Confraternização Universal", SOURCES.fixed],
  ["04-21", "Tiradentes", SOURCES.fixed],
  ["05-01", "Dia Mundial do Trabalho", SOURCES.fixed],
  ["09-07", "Independência do Brasil", SOURCES.fixed],
  ["10-12", "Nossa Senhora Aparecida", SOURCES.aparecida],
  ["11-02", "Finados", SOURCES.fixed],
  ["11-15", "Proclamação da República", SOURCES.fixed],
  ["11-20", "Dia Nacional de Zumbi e da Consciência Negra", SOURCES.conscience],
  ["12-25", "Natal", SOURCES.fixed],
];

export function irisNationalHolidays(year: number): IrisHoliday[] {
  const holidays = FIXED.filter(([day]) => day !== "11-20" || year >= 2024)
    .map(([day, name, source]) => ({ date: `${year}-${day}`, name, source }));
  // Only this annual federal calendar was verified. Do not invent future-year
  // classifications or silently turn municipal religious holidays into national ones.
  if (year === 2026) holidays.push({ date: "2026-04-03", name: "Paixão de Cristo", source: SOURCES.federal2026 });
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

function normalized(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function civilDate(date: string): Date { return new Date(`${date}T12:00:00Z`); }
function shiftDate(date: string, days: number): string {
  const result = civilDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function prettyDate(date: string): string { return date.split("-").reverse().join("/"); }
function weekday(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(civilDate(date));
}
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function validDateKey(key: string): boolean {
  const date = civilDate(key);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}
function explicitDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : undefined;
}

/** Deterministic answers do not call AI, Google, geolocation or modify any data. */
export function answerIrisTemporalQuestion(input: string, clock = createIrisClockContext()): string | null {
  const text = normalized(input).replace(/^(?:iris[,!:.]?\s*)/, "");
  if (/^(?:(?:qual (?:e |a |o )*)?(?:data (?:de hoje|atual)|dia (?:e )?hoje)|que dia (?:e |estamos )?(?:hoje|amanha|ontem)|hoje e que dia|qual (?:e )?(?:a )?data(?: de hoje)?)[?!.,\s]*$/.test(text)) {
    const offset = /amanha/.test(text) ? 1 : /ontem/.test(text) ? -1 : 0;
    const day = shiftDate(clock.localDate, offset);
    return `${offset === 1 ? "Amanhã será" : offset === -1 ? "Ontem foi" : "Hoje é"} ${prettyDate(day)}, ${weekday(day)}.`;
  }
  if (/^(?:que horas (?:sao|e)(?: agora)?|qual (?:e )?(?:a )?hora(?: atual| agora)?)[?!.,\s]*$/.test(text)) {
    return `Agora são ${clock.localTime.slice(0, 5)} (${clock.timeZone}).`;
  }
  if (!/\bferiados?\b/.test(text)) return null;
  // A translation, document, reminder or compound action is not a holiday lookup.
  if (/\b(traduza|traduzir|escreva|redija|crie|agende|lembre|lembrete|marque|envie)\b/.test(text)) return null;
  if (/\b(municipal|municipais|estadual|estaduais|local|locais|minha cidade|meu estado|aqui|cidade|estado)\b/.test(text) ||
      /\b(?:em|no|na|do|da|de)\s+(?!(?:brasil|pais|todo o brasil|territorio nacional|20\d{2}|\d|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|mes|ano|semana|dia|calendario|proximo|proxima|este|esta|esse|essa|hoje|amanha|ontem|natal|carnaval|corpus)\b)[a-z]/.test(text)) {
    return "Para verificar feriados locais, preciso da cidade e do estado (ou do país, se não for Brasil). A data atual já está disponível; não vou presumir sua localização nem inventar feriados locais.";
  }
  if (/\b(pontos? facultativos?|carnaval|corpus christi|emenda|prolongado|prolongados)\b/.test(text)) {
    return "Ponto facultativo não é automaticamente feriado nacional. Minha base distingue os feriados nacionais das regras locais; informe a data e a cidade/UF para verificar esse caso, sem presumir folga ou emenda.";
  }

  const yearNow = Number(clock.localDate.slice(0, 4));
  const yearsMentioned = new Set(text.match(/\b20\d{2}\b/g) ?? []);
  const monthsMentioned = MONTHS.filter(month => new RegExp(`\\b${month}\\b`).test(text));
  if (yearsMentioned.size > 1 || monthsMentioned.length > 1) {
    return "Você mencionou mais de um mês ou ano. Qual período deseja verificar? Não vou selecionar apenas um e omitir os demais.";
  }
  const explicitYear = text.match(/\b(20\d{2})\b/);
  const year = explicitYear ? Number(explicitYear[1]) : /\b(?:proximo ano|ano que vem)\b/.test(text) ? yearNow + 1 : yearNow;
  if (year < 2024 || year > yearNow + 5) return "Não tenho um calendário oficial completo verificado para esse ano. Não vou extrapolar datas ou classificações sem fonte.";
  const dayRequested = explicitDate(text);
  if (dayRequested && !validDateKey(dayRequested)) return "A data informada não é válida. Qual data você deseja verificar?";
  const isDay = /\b(hoje|amanha|ontem)\b/.test(text) || Boolean(dayRequested);
  if (isDay && !/\b(?:a partir|depois|apos|proxim[oa]s?|restantes|restam)\b/.test(text)) {
    const date = dayRequested ?? shiftDate(clock.localDate, /amanha/.test(text) ? 1 : /ontem/.test(text) ? -1 : 0);
    const match = irisNationalHolidays(Number(date.slice(0, 4))).find(h => h.date === date);
    return match
      ? `${prettyDate(date)}, ${weekday(date)}: ${match.name}, feriado nacional no Brasil.\nFonte: ${match.source}`
      : `${prettyDate(date)} não consta como feriado nacional na base verificada. Feriados locais dependem da cidade/UF.${Number(date.slice(0, 4)) !== 2026 ? " Para esse ano, a base cobre os feriados nacionais fixados em lei federal." : ""}`;
  }

  const upcoming = /\b(proxim[oa]s?|seguinte|seguintes|restam|restantes|faltam|ainda)\b/.test(text);
  const plural = /\bferiados\b/.test(text) || /\b(quais|liste|lista|todos)\b/.test(text);
  const words: Record<string, number> = { dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  const countMatch = text.match(/\b(\d+|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:proximos\s+)?feriados\b|\bproximos\s+(\d+|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/);
  const token = countMatch?.[1] ?? countMatch?.[2];
  const count = token ? words[token] ?? Number(token) : plural ? 3 : 1;
  if (count < 1 || count > 50) return "Posso listar de 1 a 50 feriados por consulta. Qual quantidade você deseja?";
  const monthIndex = MONTHS.findIndex(month => new RegExp(`\\b${month}\\b`).test(text));
  const monthRelative = /\b(este mes|esse mes|neste mes|nesse mes|deste mes|desse mes|proximo mes|mes que vem)\b/.test(text);
  const yearPeriod = Boolean(explicitYear) || /\b(este ano|esse ano|neste ano|nesse ano|deste ano|desse ano|proximo ano|ano que vem)\b/.test(text);
  if (/\b(semana|entre|ate|a partir|depois|apos)\b/.test(text)) {
    return "Para não interpretar um intervalo errado, informe o mês/ano ou reformule com a quantidade, por exemplo: ‘os próximos 3 feriados nacionais’. A data atual já está disponível.";
  }
  if (!upcoming && !monthRelative && monthIndex < 0 && !yearPeriod) {
    return "Você quer o próximo feriado nacional, uma quantidade de próximos feriados ou os feriados de um mês/ano? A data atual já está disponível.";
  }

  let start = `${year}-01-01`, end = `${year}-12-31`;
  const hasPeriod = yearPeriod || monthIndex >= 0 || monthRelative;
  if (monthIndex >= 0 || monthRelative) {
    let periodYear = year;
    let month = monthIndex >= 0 ? monthIndex + 1 : Number(clock.localDate.slice(5, 7));
    if (monthIndex < 0 && /\b(proximo mes|mes que vem)\b/.test(text)) {
      month++;
      if (month === 13) { month = 1; periodYear++; }
    }
    start = `${periodYear}-${String(month).padStart(2, "0")}-01`;
    end = `${periodYear}-${String(month).padStart(2, "0")}-${new Date(Date.UTC(periodYear, month, 0)).getUTCDate()}`;
  }
  if (!hasPeriod) { start = shiftDate(clock.localDate, 1); end = `${yearNow + 5}-12-31`; }
  else if (upcoming && start <= clock.localDate) start = shiftDate(clock.localDate, 1);
  let matches: IrisHoliday[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) matches.push(...irisNationalHolidays(y));
  matches = matches.filter(h => h.date >= start && h.date <= end);
  // A requested period means that period only, not a fabricated number of entries.
  const selected = matches.slice(0, hasPeriod && plural && !token ? 50 : count);
  if (!selected.length) return `Não há feriados nacionais na base verificada entre ${prettyDate(start)} e ${prettyDate(end)}. Feriados locais não estão incluídos.`;
  const header = !plural && count === 1
    ? "O próximo feriado nacional no Brasil é"
    : hasPeriod ? `Feriados nacionais no Brasil entre ${prettyDate(start)} e ${prettyDate(end)}:` : `Os ${selected.length} próximos feriados nacionais no Brasil são:`;
  const lines = selected.map(h => `${h.name} — ${prettyDate(h.date)}, ${weekday(h.date)}`);
  const futureCoverage = selected.some(h => Number(h.date.slice(0, 4)) !== 2026)
    ? "\nNos anos sem calendário federal anual verificado, a lista cobre somente feriados nacionais fixados em lei federal; feriados religiosos locais não estão incluídos." : "";
  const sources = [...new Set(selected.map(h => h.source))];
  return `${header}${selected.length === 1 && !plural ? " " : "\n"}${lines.join("\n")}.${futureCoverage}\nFonte${sources.length > 1 ? "s" : ""}: ${sources.join("\n")}`;
}
