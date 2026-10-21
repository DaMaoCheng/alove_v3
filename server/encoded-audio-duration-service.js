export function resolveEncodedAudioDurationSeconds({ durationSeconds = 0, audioBytes = 0, outputFormat = "" } = {}) {
  const storedDuration = normalizePositiveSeconds(durationSeconds);
  if (storedDuration) return storedDuration;

  const bytes = Math.max(0, Number(audioBytes || 0));
  const bitrateKbps = resolveMp3BitrateKbps(outputFormat);
  if (!bytes || !bitrateKbps) return 0;

  return normalizePositiveSeconds((bytes * 8) / (bitrateKbps * 1000));
}

function resolveMp3BitrateKbps(outputFormat = "") {
  const match = String(outputFormat || "").trim().toLowerCase().match(/^mp3_\d+_(\d+)$/);
  if (!match) return 0;
  const bitrateKbps = Number(match[1] || 0);
  return Number.isFinite(bitrateKbps) && bitrateKbps > 0 ? bitrateKbps : 0;
}

function normalizePositiveSeconds(value = 0) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds));
}
