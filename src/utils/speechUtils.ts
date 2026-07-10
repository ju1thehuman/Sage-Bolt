export function getSpeechRecognition(): any | null {
  const SR =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;
  return SR ? new SR() : null;
}

export function speakText(text: string, voiceName?: string, onEnd?: () => void) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const clean = text
    .replace(/\*+/g, "")
    .replace(/#+/g, "")
    .replace(/@\[?\w+\]?/g, "")
    .trim();
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.name === voiceName) ||
    voices.find((v) => v.name === "Google US English") ||
    voices.find((v) => v.name === "Google UK English Female") ||
    voices.find((v) => v.lang === "en-US");
  if (preferred) utterance.voice = preferred;

  utterance.onend = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
