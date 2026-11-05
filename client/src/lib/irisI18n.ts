import { useEffect, useState } from "react";
import type { SupportedLanguage } from "@shared/irisLanguageAndUpload";

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  "pt-BR": "Português (Brasil)", en: "English", es: "Español", fr: "Français", it: "Italiano", de: "Deutsch", "zh-CN": "中文", "ja-JP": "日本語", ar: "العربية",
};

type Copy = { installed: string; pwa: string; microphone: string; on: string; off: string; blocked: string; install: string; diagnostics: string; demo: string; connected: string };
const COPIES: Partial<Record<SupportedLanguage, Copy>> = {
  "pt-BR": { installed: "instalado", pwa: "PWA local", microphone: "Microfone", on: "ligado", off: "desligado", blocked: "Ações externas: bloqueadas", install: "Instalar na tela inicial", diagnostics: "Diagnóstico", demo: "Demonstração", connected: "Conectado" },
  en: { installed: "installed", pwa: "Local PWA", microphone: "Microphone", on: "on", off: "off", blocked: "External actions: blocked", install: "Install on home screen", diagnostics: "Diagnostics", demo: "Demo", connected: "Connected" },
  es: { installed: "instalado", pwa: "PWA local", microphone: "Micrófono", on: "activado", off: "desactivado", blocked: "Acciones externas: bloqueadas", install: "Instalar en pantalla de inicio", diagnostics: "Diagnóstico", demo: "Demostración", connected: "Conectado" },
  fr: { installed: "installée", pwa: "PWA locale", microphone: "Microphone", on: "activé", off: "désactivé", blocked: "Actions externes : bloquées", install: "Installer sur l'écran d'accueil", diagnostics: "Diagnostic", demo: "Démonstration", connected: "Connecté" },
  de: { installed: "installiert", pwa: "Lokale PWA", microphone: "Mikrofon", on: "an", off: "aus", blocked: "Externe Aktionen: blockiert", install: "Auf Startbildschirm installieren", diagnostics: "Diagnose", demo: "Demo", connected: "Verbunden" },
  it: { installed: "installata", pwa: "PWA locale", microphone: "Microfono", on: "acceso", off: "spento", blocked: "Azioni esterne: bloccate", install: "Installa nella schermata iniziale", diagnostics: "Diagnostica", demo: "Dimostrazione", connected: "Connesso" },
  "zh-CN": { installed: "已安装", pwa: "本地 PWA", microphone: "麦克风", on: "开启", off: "关闭", blocked: "外部操作：已阻止", install: "安装到主屏幕", diagnostics: "诊断", demo: "演示", connected: "已连接" },
  "ja-JP": { installed: "インストール済み", pwa: "ローカル PWA", microphone: "マイク", on: "オン", off: "オフ", blocked: "外部操作：ブロック", install: "ホーム画面に追加", diagnostics: "診断", demo: "デモ", connected: "接続済み" },
  ar: { installed: "مثبت", pwa: "تطبيق محلي", microphone: "الميكروفون", on: "مشغل", off: "متوقف", blocked: "الإجراءات الخارجية: محظورة", install: "التثبيت على الشاشة الرئيسية", diagnostics: "التشخيص", demo: "عرض تجريبي", connected: "متصل" },
};

export function getCopy(language: SupportedLanguage): Copy { return COPIES[language] ?? COPIES["pt-BR"]!; }
export function getStoredLanguage(): SupportedLanguage { const value = localStorage.getItem("iris.language"); return value && value in LANGUAGE_LABELS ? value as SupportedLanguage : "pt-BR"; }
export function useIrisLanguage() { const [language, setLanguage] = useState<SupportedLanguage>(() => typeof window === "undefined" ? "pt-BR" : getStoredLanguage()); useEffect(() => { localStorage.setItem("iris.language", language); document.documentElement.lang = language; }, [language]); return { language, setLanguage, copy: getCopy(language) }; }
