// src/cardRefine.js — cantos do cartão por ajuste de reta nas bordas (13/10/2026)
//
// O approxPolyDP põe o vértice em algum ponto do arco do canto arredondado (raio ISO 3,18 mm),
// o que encurta a largura medida em até ~2%. Aqui cada lado vira uma reta ajustada (mínimos
// quadrados) com os pontos do MEIO da borda, e o canto é a interseção das retas vizinhas —
// o canto "vivo" do retângulo, sem o arredondado. A média de muitos pontos dá precisão sub-pixel.

const SIDES = [['topLeft', 'topRight'], ['topRight', 'bottomRight'], ['bottomRight', 'bottomLeft'], ['bottomLeft', 'topLeft']];

function fitLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  pts.forEach((p) => { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // direção principal
  return { px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) };
}

function intersect(a, b) {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

// contour: todos os pontos {x,y} da borda; quad: cantos aproximados {topLeft, topRight, bottomRight, bottomLeft}
export function refineCardCorners(contour, quad, { trimFrac = 0.15, tolFrac = 0.03, minPts = 8 } = {}) {
  const lines = [];
  for (const [ka, kb] of SIDES) {
    const a = quad[ka], b = quad[kb];
    const vx = b.x - a.x, vy = b.y - a.y, len = Math.hypot(vx, vy);
    if (len < 1) return quad;
    const tol = Math.max(1.5, tolFrac * len);
    const pts = contour.filter((p) => {
      const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / (len * len);
      if (t < trimFrac || t > 1 - trimFrac) return false;          // fora das pontas (arredondado)
      const d = Math.abs((p.x - a.x) * vy - (p.y - a.y) * vx) / len; // distância até o lado
      return d <= tol;
    });
    if (pts.length < minPts) return quad;
    lines.push(fitLine(pts));
  }
  const out = {
    topLeft: intersect(lines[3], lines[0]),
    topRight: intersect(lines[0], lines[1]),
    bottomRight: intersect(lines[1], lines[2]),
    bottomLeft: intersect(lines[2], lines[3]),
  };
  if (Object.values(out).some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return quad;
  // segurança: se o refinamento mexer demais (>5% do lado), fica com o original
  const lado = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y);
  if (Object.keys(out).some((k) => Math.hypot(out[k].x - quad[k].x, out[k].y - quad[k].y) > 0.05 * lado)) return quad;
  return out;
}
