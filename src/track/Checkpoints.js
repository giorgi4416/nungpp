/**
 * Ordered checkpoints and the three timing sectors. Sector boundaries come
 * from the circuit definition (`sectors: [cornerA, cornerB]`): each sector
 * ends shortly after the exit of the named corner.
 */
export function buildCheckpoints(track, count = Math.max(24, Math.round(track.length / 160))) {
  const L = track.length;
  const [a, b] = track.def.sectors.map((n) => track.corner(n));
  const s1End = track.wrapS(a.end + 40);
  const s2End = track.wrapS(b.end + 40);
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
