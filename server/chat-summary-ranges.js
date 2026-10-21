import { SUMMARY_PERIOD_TYPES } from "./chat-memory-taxonomy.js";

export function getShanghaiDayRange(date) {
  const timestamp = date instanceof Date ? date.getTime() : new Date(date || Date.now()).getTime();
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(timestamp + shanghaiOffsetMs);
  return {
    start: toMysqlDateTimeParts(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0, 0),
    end: toMysqlDateTimeParts(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1, 0, 0, 0, 0),
  };
}

export function getSummaryPeriodRange(periodType, date) {
  const timestamp = date instanceof Date ? date.getTime() : new Date(date || Date.now()).getTime();
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
  const shifted = new Date(timestamp + shanghaiOffsetMs);
  if (periodType === SUMMARY_PERIOD_TYPES.WEEK) {
    const day = shifted.getUTCDay() || 7;
    return {
      start: toMysqlDateTimeParts(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() - (day - 1),
        0,
        0,
        0,
        0
      ),
      end: toMysqlDateTimeParts(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() - (day - 1) + 7,
        0,
        0,
        0,
        0
      ),
    };
  }
  if (periodType === SUMMARY_PERIOD_TYPES.MONTH) {
    return {
      start: toMysqlDateTimeParts(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1, 0, 0, 0, 0),
      end: toMysqlDateTimeParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1, 0, 0, 0, 0),
    };
  }
  return null;
}

function toMysqlDateTime(date) {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function toMysqlDateTimeParts(year, month, day, hour, minute, second, millisecond) {
  return toMysqlDateTime(new Date(Date.UTC(year, month, day, hour, minute, second, millisecond)));
}
