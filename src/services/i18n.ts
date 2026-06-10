import i18next from 'i18next';
import fr from '../locales/fr.ts';
import en from '../locales/en.ts';

export type AppLanguage = 'fr' | 'en';

const LANGUAGE_STORAGE_KEY = 'fm-language';
const listeners = new Set<(language: AppLanguage) => void>();

function normalizeLanguage(value: string | null | undefined): AppLanguage {
  return value === 'en' ? 'en' : 'fr';
}

function applyDocumentLanguage(language: AppLanguage): void {
  document.documentElement.lang = language;
}

function notifyLanguageChange(language: AppLanguage): void {
  applyDocumentLanguage(language);
  for (const listener of listeners) {
    listener(language);
  }
}

export function getCurrentLanguage(): AppLanguage {
  return normalizeLanguage(i18next.resolvedLanguage ?? i18next.language);
}

export function getStoredLanguage(): AppLanguage | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return raw ? normalizeLanguage(raw) : null;
  } catch {
    return null;
  }
}

export function getInitialLanguage(): AppLanguage {
  return getStoredLanguage() ?? 'fr';
}

export async function initI18n(): Promise<void> {
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: getInitialLanguage(),
      fallbackLng: 'fr',
      resources: {
        fr: { translation: fr },
        en: { translation: en },
      },
      interpolation: {
        escapeValue: false,
      },
    });
    i18next.on('languageChanged', (language) => {
      notifyLanguageChange(normalizeLanguage(language));
    });
  }

  notifyLanguageChange(getCurrentLanguage());
}

export async function setLanguage(language: AppLanguage): Promise<void> {
  const nextLanguage = normalizeLanguage(language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  } catch {
    // Ignore storage failures.
  }
  await i18next.changeLanguage(nextLanguage);
}

export function onLanguageChange(listener: (language: AppLanguage) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options) as string;
}
