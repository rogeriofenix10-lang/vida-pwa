export type RadarPriority = "urgente" | "importante" | "atencao" | "normal" | "informacao";

export type RadarRecord = {
  id: number;
  label: string;
  detail: string;
  date: string;
  priority: RadarPriority;
  action: string;
};

export function completeRadarItem<T extends { id: number }>(items: T[], id: number) {
  return items.filter((item) => item.id !== id);
}

export function snoozeRadarItem<T extends { id: number; date: string; detail: string }>(items: T[], id: number) {
  return items.map((item) => item.id === id ? { ...item, date: "amanhã", detail: `${item.detail} · adiado` } : item);
}

export function editRadarItem<T extends { id: number; label: string; detail: string }>(items: T[], id: number, text: string) {
  const normalized = text.trim();
  if (!normalized) return items;
  return items.map((item) => item.id === id ? { ...item, label: normalized, detail: "ajustado por você" } : item);
}
