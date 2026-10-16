// Roadmap D.1 UI helpers: voice input for the assistant composer. Browser speech recognition only (decision D10); there is no server transcription.
// Pure functions (no React, no browser globals unless passed in) so test/phaseD1.test.js can run them in Node. Only erasable TypeScript syntax.
export const LANGS: [string, string][] = [['en-US', 'English'], ['ar', 'العربية'], ['fr-FR', 'Français'], ['es-ES', 'Español'], ['de-DE', 'Deutsch']];
const BY_BASE: Record<string, string> = { en: 'en-US', ar: 'ar', fr: 'fr-FR', es: 'es-ES', de: 'de-DE' };
export const NOTICE_KEY = 'rt:assistant:voice-notice';
export const NOTICE = 'Voice input sends your audio to your browser\'s own speech service (for example Google in Chrome or Microsoft in Edge) to turn it into text. This app does not record or store the audio.';

// The language picker starts on the first language the person chose in setup (profile.languages, codes like "ar"); anything else falls back to English.
export const defaultLang = (languages: unknown): string => {
  const first = Array.isArray(languages) ? String(languages[0] ?? '').toLowerCase().split('-')[0] : '';
  return BY_BASE[first] ?? 'en-US';
};

// The browser's recognizer class, or null (Firefox, many embedded browsers). The mic button is not drawn when this is null.
export const getRecognition = (win: any): any => (win && (win.SpeechRecognition || win.webkitSpeechRecognition)) || null;

// Turns a recognizer error code into text for the person. fatal = stop offering the mic for this page load (permission blocked, no microphone).
export function describeSpeechError(code: string): { message: string; fatal: boolean } {
  switch (code) {
    case 'not-allowed': case 'service-not-allowed':
      return { message: 'Microphone access is blocked. Allow it in your browser\'s site settings to use voice input. You can still type.', fatal: true };
    case 'audio-capture': return { message: 'No microphone was found. You can still type.', fatal: true };
    case 'no-speech': return { message: 'I did not hear anything. Try again.', fatal: false };
    case 'network': return { message: 'The browser\'s speech service could not be reached. Check your connection and try again.', fatal: false };
    case 'language-not-supported': return { message: 'This browser cannot recognise that language. Pick another one.', fatal: false };
    case 'aborted': return { message: '', fatal: false }; // we stopped it ourselves
    default: return { message: 'Voice input stopped unexpectedly. You can still type.', fatal: false };
  }
}

// event.results is a list of results, each a list of alternatives with { transcript }. Final text is settled; interim text may still change.
export function splitResults(results: ArrayLike<any> | null | undefined): { finals: string; interim: string } {
  const f: string[] = [], i: string[] = [];
  for (let k = 0; results && k < results.length; k++) {
    const r = results[k], t = String(r?.[0]?.transcript ?? '').trim();
    if (t) (r.isFinal ? f : i).push(t);
  }
  return { finals: f.join(' '), interim: i.join(' ') };
}

// What the input box shows while listening: the text that was already there, then the settled words, then the interim words, joined by single spaces.
export const mergeTranscript = (base: string, finals: string, interim: string): string =>
  [String(base ?? '').trimEnd(), finals.trim(), interim.trim()].filter(Boolean).join(' ');
