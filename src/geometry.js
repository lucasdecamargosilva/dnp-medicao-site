export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function projectOntoLine(p, a, b) {
  if (a.x === b.x && a.y === b.y) {
    throw new Error('projectOntoLine: reta degenerada (a === b)');
  }
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby);
  return { x: a.x + t * abx, y: a.y + t * aby };
}
