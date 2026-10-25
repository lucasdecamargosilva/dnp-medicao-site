// src/cardDetector.js
// Requer que window.cv (OpenCV.js) esteja carregado.
import { refineCardCorners } from './cardRefine.js';
const TARGET_RATIO = 85.6 / 53.98; // ~1.585
const RATIO_TOL = 0.25;

// Escolhe o cartão entre os retângulos achados usando o rosto (13/10): antes pegava o MAIOR
// retângulo da imagem, e um pedacinho do cabelo/fundo virava "cartão" (torto → travava em
// "deixe o cartão reto"). Cartão de verdade, na testa: largura ≈ 1,3× a distância entre as
// pupilas (85,6 mm vs ~64 mm), centrado entre os olhos e ACIMA deles.
export function pickCard(candidates, face) {
  if (!face) return candidates.reduce((b, c) => (!b || c.area > b.area ? c : b), null);
  const ipd = Math.hypot(face.rightEye.x - face.leftEye.x, face.rightEye.y - face.leftEye.y);
  if (ipd < 1) return null;
  const mid = { x: (face.leftEye.x + face.rightEye.x) / 2, y: (face.leftEye.y + face.rightEye.y) / 2 };
  let best = null;
  let bestScore = Infinity;
  const dbg = [];   // diagnóstico: por que cada candidato foi recusado
  if (typeof window !== 'undefined') window.__dnpCard = { ipd: Math.round(ipd), mid: { x: Math.round(mid.x), y: Math.round(mid.y) }, cands: dbg };
  for (const c of candidates) {
    const q = c.corners;
    const w = Math.max(Math.hypot(q.topRight.x - q.topLeft.x, q.topRight.y - q.topLeft.y),
      Math.hypot(q.bottomLeft.x - q.topLeft.x, q.bottomLeft.y - q.topLeft.y));
    const cx = (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4;
    const cy = (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4;
    // quadrilátero deformado (cantos repetidos/lados desiguais) não é cartão
    const sides = [[q.topLeft, q.topRight], [q.topRight, q.bottomRight], [q.bottomRight, q.bottomLeft], [q.bottomLeft, q.topLeft]]
      .map(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y));
    const rel = w / ipd;
    const info = { w: Math.round(w), rel: +rel.toFixed(2), cx: Math.round(cx), cy: Math.round(cy), sides: sides.map(Math.round) };
    dbg.push(info);
    if (Math.min(...sides) < 0.4 * w) { info.motivo = 'deformado'; continue; }
    if (Math.abs(sides[0] - sides[2]) > 0.15 * w || Math.abs(sides[1] - sides[3]) > 0.15 * w) { info.motivo = 'lados desiguais'; continue; }
    if (rel < 0.9 || rel > 2.2) { info.motivo = 'tamanho'; continue; }                 // incompatível com um cartão no rosto
    // largura/altura: inclinar na testa só ENCURTA a altura (proporção sobe); se ficou MENOR que a de um
    // cartão, algo está cortando a largura — quase sempre o dedo cobrindo uma lateral (24/10: aceitava
    // o pedaço visível do cartão e media 14% a menos)
    const prop = ((sides[0] + sides[2]) / 2) / ((sides[1] + sides[3]) / 2);
    if (prop < TARGET_RATIO * 0.977 || prop > TARGET_RATIO / 0.72) { info.motivo = `proporção ${prop.toFixed(2)} (cartão cortado?)`; continue; }
    if (Math.abs(cx - mid.x) > 0.6 * ipd) { info.motivo = 'fora do centro'; continue; } // não está entre os olhos
    if (cy > mid.y || mid.y - cy > 2.5 * ipd) { info.motivo = 'altura'; continue; }     // não está na testa
    info.motivo = 'ok';
    const score = Math.abs(rel - 1.35);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// Bordas em COR (13/10): em tons de cinza um cartão azul e a pele têm quase o mesmo brilho e a
// borda some (foi o que impediu detectar o cartão do Lucas). Canny em cada canal R, G, B e junta.
export function colorEdges(srcRgba, lo, hi) {
  const cv = window.cv;
  const rgb = new cv.Mat();
  const ch = new cv.MatVector();
  const tmp = new cv.Mat();
  const edges = cv.Mat.zeros(srcRgba.rows, srcRgba.cols, cv.CV_8UC1);
  try {
    cv.cvtColor(srcRgba, rgb, cv.COLOR_RGBA2RGB);
    cv.GaussianBlur(rgb, rgb, new cv.Size(5, 5), 0);
    cv.split(rgb, ch);
    for (let i = 0; i < 3; i++) {
      const c = ch.get(i);
      cv.Canny(c, tmp, lo, hi);
      cv.bitwise_or(edges, tmp, edges);
      c.delete();
    }
    return edges;
  } finally {
    rgb.delete(); ch.delete(); tmp.delete();
  }
}

// recorte da testa (onde o cartão tem de estar), em px do quadro; null se o rosto não permite
export function foreheadRect(face, W, H) {
  const ipd = Math.hypot(face.rightEye.x - face.leftEye.x, face.rightEye.y - face.leftEye.y);
  const mx = (face.leftEye.x + face.rightEye.x) / 2;
  const my = (face.leftEye.y + face.rightEye.y) / 2;
  const x0 = Math.max(0, Math.round(mx - 1.7 * ipd));
  const y0 = Math.max(0, Math.round(my - 2.7 * ipd));
  const x1 = Math.min(W, Math.round(mx + 1.7 * ipd));
  const y1 = Math.min(H, Math.round(my - 0.1 * ipd));
  return x1 - x0 >= 20 && y1 - y0 >= 20 ? { x0, y0, w: x1 - x0, h: y1 - y0 } : null;
}

// lê só o recorte (muito mais rápido que cv.imread do quadro inteiro de 1920×1080)
export function readRegion(canvasEl, r) {
  const data = canvasEl.getContext('2d', { willReadFrequently: true }).getImageData(r.x0, r.y0, r.w, r.h);
  return window.cv.matFromImageData(data);
}

// prepara a testa uma vez por quadro: recorte + bordas em cor, reaproveitados pelos dois detectores
// sensivel=true: limiares de borda mais baixos (2ª tentativa, p.ex. cartão rosa/bege contra a pele)
export function prepareForehead(canvasEl, face, { sensivel = false } = {}) {
  const r = foreheadRect(face, canvasEl.width, canvasEl.height);
  if (!r) return null;
  const img = canvasEl.getContext('2d', { willReadFrequently: true }).getImageData(r.x0, r.y0, r.w, r.h);
  const roi = window.cv.matFromImageData(img);
  try {
    const edges = sensivel ? colorEdges(roi, 15, 45) : colorEdges(roi, 40, 120);
    // pixels guardados para a checagem de cor das bordas (cardLines)
    return { r, edges, pixels: { data: img.data, w: r.w, h: r.h, x0: r.x0, y0: r.y0 }, delete: () => edges.delete() };
  } finally {
    roi.delete();
  }
}

// acha o cartão com os dois detectores; se nada, repete com bordas mais sensíveis (só nesse caso,
// para não pesar a cada quadro). detectByLines é injetado para não criar import circular.
export function findCard(canvasEl, face, detectByLines) {
  for (const sensivel of [false, true]) {
    const pre = prepareForehead(canvasEl, face, { sensivel });
    if (!pre) return null;
    try {
      const q = detectCardCorners(canvasEl, face, pre) || detectByLines(canvasEl, face, pre);
      if (q) return q;
    } finally {
      pre.delete();
    }
  }
  return null;
}

function orderCorners(pts) {
  // pts: array de 4 {x,y}
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const topLeft = bySum[0];
  const bottomRight = bySum[3];
  const byDiff = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y));
  const bottomLeft = byDiff[0];
  const topRight = byDiff[3];
  return { topLeft, topRight, bottomRight, bottomLeft };
}

export function detectCardCorners(canvasEl, face = null, pre = null) {
  const cv = window.cv;
  // com rosto: só a testa (rápido e sem confundir com objetos do fundo); sem rosto: quadro inteiro
  const r = pre ? pre.r : face ? foreheadRect(face, canvasEl.width, canvasEl.height) : { x0: 0, y0: 0, w: canvasEl.width, h: canvasEl.height };
  if (!r) return null;
  const off = (p) => ({ x: p.x + r.x0, y: p.y + r.y0 });
  let edges = null;
  let ownEdges = false;
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    if (pre) edges = pre.edges;
    else {
      const src = readRegion(canvasEl, r);
      try { edges = colorEdges(src, 50, 150); ownEdges = true; } finally { src.delete(); }
    }
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);   // todos os pontos da borda (pro ajuste de reta)

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const area = cv.contourArea(approx);
        const pts = [];
        for (let r = 0; r < 4; r++) {
          pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
        }
        const ordered = orderCorners(pts);
        const wTop = Math.hypot(
          ordered.topRight.x - ordered.topLeft.x,
          ordered.topRight.y - ordered.topLeft.y
        );
        const hLeft = Math.hypot(
          ordered.bottomLeft.x - ordered.topLeft.x,
          ordered.bottomLeft.y - ordered.topLeft.y
        );
        const ratio = Math.max(wTop, hLeft) / Math.min(wTop, hLeft);
        if (Math.abs(ratio - TARGET_RATIO) < RATIO_TOL) {
          candidates.push({ corners: ordered, area, idx: i });
        }
      }
      approx.delete();
    }
    if (typeof window !== 'undefined') window.__dnpCard = null;
    const faceLocal = face && { leftEye: { x: face.leftEye.x - r.x0, y: face.leftEye.y - r.y0 }, rightEye: { x: face.rightEye.x - r.x0, y: face.rightEye.y - r.y0 } };
    const chosen = pickCard(candidates, faceLocal);
    if (!chosen) return null;
    let best = chosen.corners;
    {   // cantos vivos por ajuste de reta nas bordas (sem o arredondado)
      const cnt = contours.get(chosen.idx), pts = [];
      for (let k = 0; k < cnt.rows; k++) pts.push({ x: cnt.data32S[k * 2], y: cnt.data32S[k * 2 + 1] });
      best = refineCardCorners(pts, best);
    }
    return { topLeft: off(best.topLeft), topRight: off(best.topRight), bottomRight: off(best.bottomRight), bottomLeft: off(best.bottomLeft) };
  } finally {
    if (edges && ownEdges) edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
