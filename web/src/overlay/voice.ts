// Spoken alerts through the system's speech voices (Web Speech API). No audio files, nothing sent anywhere.
// Kept short and rare on purpose: at most one line every few seconds, and a waiting line is dropped rather
// than read late (a rune call ten seconds after the fact is worse than silence).
import type { Lang } from "./i18n";

const MIN_GAP_MS = 2500;
let lastAt = 0;

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const want = lang === "ko" ? "ko" : "en";
  return voices.find((v) => v.lang.toLowerCase().startsWith(want)) ?? null;
}

/** Is there a voice for this language on this PC? (Windows needs the Korean speech pack for "ko") */
export function hasVoice(lang: Lang): boolean {
  return pickVoice(lang) !== null;
}

/**
 * Say one short line. `fallback` is the English wording, used when the PC has no voice for `lang`.
 * `urgent` lines (low health) cut in front of whatever is being read.
 */
export function speak(text: string, lang: Lang, volume: number, opts: { fallback?: string; urgent?: boolean } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  const now = Date.now();
  if (opts.urgent) synth.cancel();
  else if (synth.speaking || synth.pending || now - lastAt < MIN_GAP_MS) return;
  let voice = pickVoice(lang);
  let line = text;
  if (!voice && lang !== "en" && opts.fallback) {
    voice = pickVoice("en");
    line = opts.fallback;
  }
  const u = new SpeechSynthesisUtterance(line);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else u.lang = lang === "ko" ? "ko-KR" : "en-US";
  u.volume = Math.max(0, Math.min(1, volume));
  u.rate = 1.1;
  lastAt = now;
  synth.speak(u);
}
