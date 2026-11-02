let audio: AudioContext | null = null;

function context(): AudioContext | null {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!audio) audio = new Context();
  return audio;
}

/** Browsers only allow sound after the person has clicked or typed on the page. */
export function armNoticeSound() {
  const current = context();
  if (current && current.state === "suspended") void current.resume();
}

/** A short, loud three-tone alert so a new notice is hard to miss. */
export async function playNoticeSound() {
  const current = context();
  if (!current) return;
  if (current.state === "suspended") await current.resume();
  if (current.state !== "running") return;
  const now = current.currentTime;
  [740, 988, 1318].forEach((frequency, index) => {
    const tone = current.createOscillator();
    const level = current.createGain();
    tone.type = "square";
    tone.frequency.value = frequency;
    const start = now + index * 0.22;
    level.gain.setValueAtTime(0.0001, start);
    level.gain.exponentialRampToValueAtTime(0.85, start + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    tone.connect(level);
    level.connect(current.destination);
    tone.start(start);
    tone.stop(start + 0.2);
  });
  document.documentElement.dataset.noticeSound = "played";
}
