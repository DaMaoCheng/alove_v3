export const GUEST_MESSAGE_LIMIT = 30;
export const GUEST_RATE_LIMIT = 10;

const MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export function resolveGuestMessageQuotaState(guest, {
  reservedCount = 0,
  skipRateQuota = false,
} = {}) {
  const dbNow = guest.db_now || new Date();
  const now = new Date(dbNow).getTime();
  const dailyStart = new Date(guest.message_window_started_at || 0).getTime();
  const rateStart = new Date(guest.rate_window_started_at || 0).getTime();
  const dailyFresh = !dailyStart || now - dailyStart >= MESSAGE_WINDOW_MS;
  const rateFresh = !rateStart || now - rateStart >= RATE_WINDOW_MS;
  const dailyCount = dailyFresh ? 0 : Number(guest.message_window_count || 0);
  const rateCount = rateFresh ? 0 : Number(guest.rate_window_count || 0);
  const normalizedReservedCount = Number(reservedCount || 0);

  return {
    messageLimitReached: dailyCount + normalizedReservedCount >= GUEST_MESSAGE_LIMIT,
    rateLimitReached: !skipRateQuota && rateCount + normalizedReservedCount >= GUEST_RATE_LIMIT,
    updateValues: [
      dailyFresh ? dbNow : guest.message_window_started_at,
      dailyCount + 1,
      skipRateQuota ? guest.rate_window_started_at : (rateFresh ? dbNow : guest.rate_window_started_at),
      skipRateQuota ? Number(guest.rate_window_count || 0) : rateCount + 1,
      guest.id,
    ],
  };
}
