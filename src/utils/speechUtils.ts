// Voices load asynchronously in Chrome — we must wait for them
let voicesLoaded: SpeechSynthesisVoice[] = [];

export function getSpeechRecognition(): any | null {
  const SR =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  return SR ? new SR() : null;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      voicesLoaded = existing;
      resolve(existing);
      return;
    }
    // Chrome loads voices async via onvoiceschanged
    let resolved = false;
    const handler = () => {
      if (resolved) return;
      resolved = true;
      voicesLoaded = window.speechSynthesis.getVoices();
      resolve(voicesLoaded);
    };
    window.speechSynthesis.onvoiceschanged = handler;
    // Fallback timeout — if voices don't load in 1.5s, proceed anyway
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      voicesLoaded = window.speechSynthesis.getVoices();
      resolve(voicesLoaded);
    }, 1500);
  });
}

// Warm up voice loading on module init
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
}

/**
 * Returns true if speech synthesis is available and voices are loaded.
 * If false, the calling UI should show a message explaining TTS is not available.
 */
export async function speakText(text: string, voiceName?: string, onEnd?: () => void): Promise<boolean> {
  if (!("speechSynthesis" in window)) return false;

  window.speechSynthesis.cancel();

  const clean = text
    .replace(/\*+/g, "")
    .replace(/#+/g, "")
    .replace(/@\[?\w+\]?/g, "")
    .replace(/^\s*[-•→☐]\s+/gm, "")
    .trim();
  if (!clean) return false;

  // Make sure voices are loaded before we pick one
  let voices = voicesLoaded;
  if (voices.length === 0) {
    voices = await loadVoices();
  }

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const preferred =
    voices.find((v) => v.name === voiceName) ||
    voices.find((v) => v.name === "Google US English") ||
    voices.find((v) => v.name === "Google UK English Female") ||
    voices.find((v) => v.lang === "en-US") ||
    voices.find((v) => v.lang.startsWith("en")) ||
    voices[0];
  if (preferred) utterance.voice = preferred;

  // Resolve on end or on error — calling onEnd signals UI to reset
  return new Promise((resolve) => {
    utterance.onend = () => { onEnd?.(); resolve(true); };
    utterance.onerror = (e) => {
      console.warn("TTS error:", e);
      onEnd?.();
      resolve(false);
    };
    try {
      window.speechSynthesis.speak(utterance);
      // Chrome bug: speech can get stuck — resume if paused
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      console.warn("TTS speak failed:", err);
      resolve(false);
    }
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
