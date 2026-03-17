export type UILanguage = 'auto' | 'zh' | 'en' | 'he';

export const UI_LANGUAGE_STORAGE_KEY = 'a4claw-ui-language';

const RTL_LANGS = new Set<UILanguage>(['he']);

function detectBrowserLanguage(): UILanguage {
  const navLang = (navigator.language || '').toLowerCase();
  if (navLang.startsWith('zh')) return 'zh';
  if (navLang.startsWith('he') || navLang.startsWith('iw')) return 'he';
  return 'en';
}

export function resolveLanguage(language: UILanguage): UILanguage {
  return language === 'auto' ? detectBrowserLanguage() : language;
}

export function readLanguageChoice(): UILanguage {
  const raw = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  if (raw === 'zh' || raw === 'en' || raw === 'he' || raw === 'auto') return raw;
  return 'auto';
}

export function persistLanguageChoice(language: UILanguage): void {
  localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
}

export function applyLanguage(language: UILanguage): void {
  const resolved = resolveLanguage(language);
  const isRtl = RTL_LANGS.has(resolved);

  document.documentElement.lang =
    resolved === 'zh' ? 'zh-CN' : resolved === 'he' ? 'he' : 'en';
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

  // Keep chat RTL behavior aligned with explicit language choice.
  if (language !== 'auto') {
    localStorage.setItem('a4claw-rtl', String(isRtl));
  }
}

