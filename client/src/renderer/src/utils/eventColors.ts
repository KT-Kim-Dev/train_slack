/**
 * 캘린더 칩 색상 팔레트.
 * 같은 일정(id)은 가능한 한 같은 색을 유지하고,
 * 같은 날에 겹치는 일정끼리는 서로 다른 색을 쓰도록 graph coloring.
 */

export const EVENT_COLOR_PALETTE = [
  "#1a73e8", // blue
  "#0b8043", // green
  "#d50000", // red
  "#f4511e", // orange
  "#8e24aa", // purple
  "#039be5", // light blue
  "#e67c73", // coral
  "#33b679", // teal green
  "#f6bf26", // yellow
  "#7986cb", // indigo
  "#616161", // gray
  "#039487", // turquoise
] as const;

function dayKeysTouched(startAt: string, endAt: string): string[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const keys: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // end exclusive for all-day; for timed events still include end day if time > midnight spill
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // If end is exactly midnight, last day is previous calendar day
  if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
    last.setDate(last.getDate() - 1);
  }
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    keys.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

/**
 * 월간(또는 목록) 이벤트에 대해 색상을 할당한다.
 * - 동일 id → 동일 색
 * - 하루라도 겹치면 서로 다른 색
 */
export function assignEventColors(
  events: { id: number; startAt: string; endAt: string }[]
): Map<number, string> {
  const palette = EVENT_COLOR_PALETTE;
  const n = palette.length;
  const result = new Map<number, string>();
  if (events.length === 0) return result;

  // day -> event ids
  const byDay = new Map<string, number[]>();
  for (const ev of events) {
    for (const key of dayKeysTouched(ev.startAt, ev.endAt)) {
      const list = byDay.get(key) ?? [];
      list.push(ev.id);
      byDay.set(key, list);
    }
  }

  // adjacency: events that share a day
  const neighbors = new Map<number, Set<number>>();
  for (const ev of events) neighbors.set(ev.id, new Set());
  for (const ids of byDay.values()) {
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        neighbors.get(uniq[i])!.add(uniq[j]);
        neighbors.get(uniq[j])!.add(uniq[i]);
      }
    }
  }

  // color index per event
  const colorIndex = new Map<number, number>();
  const sorted = [...events].sort((a, b) => a.id - b.id);

  for (const ev of sorted) {
    const used = new Set<number>();
    for (const nid of neighbors.get(ev.id) ?? []) {
      const ci = colorIndex.get(nid);
      if (ci != null) used.add(ci);
    }
    const preferred = ((ev.id % n) + n) % n;
    let chosen = preferred;
    if (used.has(chosen)) {
      chosen = -1;
      for (let i = 0; i < n; i++) {
        const candidate = (preferred + i) % n;
        if (!used.has(candidate)) {
          chosen = candidate;
          break;
        }
      }
      if (chosen < 0) chosen = preferred; // palette exhausted — rare
    }
    colorIndex.set(ev.id, chosen);
    result.set(ev.id, palette[chosen]);
  }

  return result;
}
