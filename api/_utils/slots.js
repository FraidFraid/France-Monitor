// api/utils/slots.js
// Pure UTC slot-key utilities. No external dependencies.
// Slots are fixed UTC anchors: 00:00, 06:00, 12:00, 18:00.

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the canonical slotKey for the most recent past slot at or before `now`.
 * Format: "YYYY-MM-DDTHH:MM" (always HH = 00, 06, 12, or 18; MM = 00).
 * @param {Date} [now]
 * @returns {string}
 */
export function currentSlotKey(now = new Date()) {
  const h = now.getUTCHours();
  const slotHour = h < 6 ? 0 : h < 12 ? 6 : h < 18 ? 12 : 18;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    slotHour, 0, 0, 0,
  ));
  return d.toISOString().slice(0, 16); // "2026-04-10T12:00"
}

/**
 * Returns the ordered list of `count` slotKeys ending at (and including) `currentSlot`.
 * @param {string} currentSlot — slotKey, e.g. "2026-04-10T12:00"
 * @param {number} count — number of slots to return (28 for 7d, 120 for 30d)
 * @returns {string[]}
 */
export function buildSlotGrid(currentSlot, count) {
  const base = new Date(currentSlot + ':00.000Z').getTime();
  const slots = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = base - i * SIX_HOURS_MS;
    const d = new Date(ms);
    slots.push(d.toISOString().slice(0, 16));
  }
  return slots;
}
