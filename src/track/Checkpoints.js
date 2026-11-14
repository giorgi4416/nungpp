/**
 * Ordered checkpoints and the three timing sectors.
 * Sector 1: start line -> between T4 and T5
 * Sector 2: -> between T11 and T12
 * Sector 3: -> finish line
 */
export function buildCheckpoints(track, count = 28) {
  const L = track.length;
  const c = (n) => track.corners.find((q) => q.turn === n);
  const s1End = (c(4).end + c(5).start) / 2;
  const s2End = (c(11).end + c(12).start) / 2;
  const list = [];
  for (let i = 0; i < count; i++) list.push((i / count) * L);
  // insert sector boundaries as checkpoints
  for (const s of [s1End, s2End]) {
    // replace nearest generic checkpoint to keep spacing even
    let best = 1, bd = Infinity;
    for (let i = 1; i < list.length; i++) {
      const d = Math.abs(list[i] - s);
      if (d < bd) { bd = d; best = i; }
    }
    list[best] = s;
  }
  list.sort((a, b) => a - b);
  const sectorIdx = [list.indexOf(s1End), list.indexOf(s2End)];
  return { list, sectorEnds: [s1End, s2End], sectorIdx, sectorStarts: [0, s1End, s2End] };
}
