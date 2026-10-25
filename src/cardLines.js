// src/cardLines.js — acha o cartão pelas RETAS das bordas, aguentando dedo na frente (13/10/2026)
//
// O detector por contorno exige o retângulo fechado; com o dedo segurando o cartão pela lateral,
// o contorno do cartão se funde com o do dedo e some (visto nas fotos de diagnóstico do Lucas).
// Aqui: só na região da testa, detecta segmentos de reta (Hough), junta os colineares e procura
// o par de retas quase verticais (esquerda/direita) + par quase horizontal (cima/baixo) que forma
// um cartão do tamanho certo. Uma borda parcialmente coberta ainda define a reta inteira.

import { colorEdges, foreheadRect, readRegion } from './cardDetector.js';

const deg = (r) => (r * 180) / Math.PI;

// segmentos {x1,y1,x2,y2} → retas agrupadas. Vertical: x = c + k·y ; horizontal: y = c + k·x.
export function groupLines(segments, { refX, refY, mergePx = 4, maxTiltDeg = 25 } = {}) {
  const verts = [];
  const hors = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    const ang = deg(Math.atan2(dy, dx));
    const a = ((ang % 180) + 180) % 180;   // 0..180
    if (Math.min(a, 180 - a) <= maxTiltDeg) {
      const k = dy / dx;
      hors.push({ k, c: s.y1 - k * s.x1, at: s.y1 + k * (refX - s.x1), len, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) });
    } else if (Math.abs(a - 90) <= maxTiltDeg) {
      const k = dx / dy;
      verts.push({ k, c: s.x1 - k * s.y1, at: s.x1 + k * (refY - s.y1), len, lo: Math.min(s.y1, s.y2), hi: Math.max(s.y1, s.y2) });
    }
  }
  return { verts: merge(verts, mergePx), hors: merge(hors, mergePx) };
}

// junta segmentos da mesma reta (posição no ponto de referência e inclinação parecidas)
function merge(lines, mergePx) {
  const sorted = [...lines].sort((p, q) => p.at - q.at);
  const out = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(l.at - last.at) <= mergePx && Math.abs(l.k - last.k) < 0.1) {
      const w = last.len + l.len;
      last.k = (last.k * last.len + l.k * l.len) / w;
      last.c = (last.c * last.len + l.c * l.len) / w;
      last.at = (last.at * last.len + l.at * l.len) / w;
      last.len = w;
      last.lo = Math.min(last.lo, l.lo);
      last.hi = Math.max(last.hi, l.hi);
    } else {
      out.push({ ...l });
    }
  }
  return out;
}

// interseção de uma vertical (x = cv + kv·y) com uma horizontal (y = ch + kh·x)
function cross(v, h) {
  const y = (h.c + h.k * v.c) / (1 - h.k * v.k);
  return { x: v.c + v.k * y, y };
}

// ---- checagem de cor: a borda certa tem COR DO CARTÃO por dentro e outra cor por fora ----
// Sem isso, com linhas paralelas perto da borda, o detector escolhia a errada: um fio de cabelo
// logo fora do cartão (cartão roxo, +7% na largura) ou a borda de um bloco interno do desenho
// do cartão (cartão azul, −8%). Ambos falham aqui: o cabelo não tem cor de cartão por dentro;
// o bloco interno tem cor de cartão também por fora.
// cor como TONALIDADE (r,g,b divididos pela soma, ×255): a sombra muda o brilho mas não a tonalidade
// — o cartão roxo do Lucas ia de (43,18,60) na sombra a (112,57,148) no claro e reprovava por RGB.
// Pixel muito escuro não tem tonalidade confiável: volta null (não conta como cartão nem como fundo).
function pix(px, x, y) {
  const xi = Math.round(x - px.x0);
  const yi = Math.round(y - px.y0);
  if (xi < 0 || yi < 0 || xi >= px.w || yi >= px.h) return null;
  const i = (yi * px.w + xi) * 4;
  const r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
  const soma = r + g + b;
  if (soma < 60) return null;
  return [(255 * r) / soma, (255 * g) / soma, (255 * b) / soma];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// cor típica do cartão: mediana de uma grade no miolo do retângulo
function cardColor(px, q) {
  const vals = [[], [], []];
  for (let u = 0.2; u <= 0.8; u += 0.1) {
    for (let v = 0.25; v <= 0.75; v += 0.125) {
      const x = q.topLeft.x + u * (q.topRight.x - q.topLeft.x) + v * (q.bottomLeft.x - q.topLeft.x);
      const y = q.topLeft.y + u * (q.topRight.y - q.topLeft.y) + v * (q.bottomLeft.y - q.topLeft.y);
      const c = pix(px, x, y);
      if (c) c.forEach((k, i) => vals[i].push(k));
    }
  }
  if (!vals[0].length) return null;
  return vals.map((a) => a.sort((p, q2) => p - q2)[a.length >> 1]);
}

// uma borda a→b (com "dentro" para o lado do centro): fração das amostras com cor de cartão por DENTRO
// e por FORA. Borda certa = cartão por dentro e outra cor por fora.
function edgeStats(px, a, b, centro, cor, off, tol) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if ((centro.x - mx) * nx + (centro.y - my) * ny < 0) { nx = -nx; ny = -ny; }   // normal para dentro
  let dentro = 0, fora = 0, n = 0;
  for (let t = 0.15; t <= 0.851; t += 0.07) {
    const x = a.x + t * (b.x - a.x);
    const y = a.y + t * (b.y - a.y);
    const ci = pix(px, x + nx * off, y + ny * off);
    const co = pix(px, x - nx * off, y - ny * off);
    if (!ci || !co) continue;
    n++;
    if (dist(ci, cor) < tol) dentro++;
    if (dist(co, cor) < tol) fora++;
  }
  return n ? { dentro: dentro / n, fora: fora / n } : { dentro: 0, fora: 1 };
}

// tom da pele da TESTA logo abaixo do cartão (entre o cartão e as sobrancelhas)
function skinTone(px, q, ipd) {
  const vals = [[], [], []];
  const k = 0.12 * ipd;
  for (let t = 0.2; t <= 0.8; t += 0.1) {
    const x = q.bottomLeft.x + t * (q.bottomRight.x - q.bottomLeft.x);
    const y = q.bottomLeft.y + t * (q.bottomRight.y - q.bottomLeft.y) + k;
    const c = pix(px, x, y);
    if (c) c.forEach((v, i) => vals[i].push(v));
  }
  if (vals[0].length < 3) return null;
  return vals.map((a2) => a2.sort((p, q2) => p - q2)[a2.length >> 1]);
}

// Veredito de cor do retângulo. Lado REAL: cartão por dentro (≥50%) e diferença dentro−fora ≥0,3.
// Lado DEDUZIDO (dedo por cima): basta um pouco de cartão por dentro (≥15%) e quase nada por fora.
// Cartão com o MESMO TOM da pele (rosa, bege — caso de um lojista 24/10): a cor não separa; aí só se
// exige cartão por dentro, e quem chama endurece a regra de formato.
export function colorVerdict(px, q, ipd, { deduzidoL = false, deduzidoR = false } = {}) {
  const cor = cardColor(px, q);
  if (!cor) return { ok: false, score: -1, ambiguo: false };
  const pele = skinTone(px, q, ipd);
  const ambiguo = !!pele && dist(pele, cor) < 30;
  const centro = { x: (q.topLeft.x + q.bottomRight.x) / 2, y: (q.topLeft.y + q.bottomRight.y) / 2 };
  const off = Math.max(2, 0.03 * ipd);
  const tol = 22;   // em tonalidade (0–255 por componente)
  const L = edgeStats(px, q.topLeft, q.bottomLeft, centro, cor, off, tol);
  const R = edgeStats(px, q.topRight, q.bottomRight, centro, cor, off, tol);
  const B = edgeStats(px, q.bottomLeft, q.bottomRight, centro, cor, off, tol);
  const lado = (st, deduzido) => deduzido
    ? st.dentro >= 0.15 && (ambiguo || st.fora <= 0.15)
    : st.dentro >= 0.5 && (ambiguo || st.dentro - st.fora >= 0.3);
  const ok = lado(L, deduzidoL) && lado(R, deduzidoR) && B.dentro >= 0.4 && (ambiguo || B.dentro - B.fora >= 0.2);
  const score = (L.dentro - L.fora) + (R.dentro - R.fora) + (B.dentro - B.fora);
  return { ok, score, ambiguo };
}

export function cardColorScore(px, q, ipd) {
  return colorVerdict(px, q, ipd).score;
}

// ---- lateral ESCONDIDA pelo dedo (24/10, pedido do Lucas: "nem todo mundo vai segurar no meio") ----
// Se o dedo cobre uma lateral (ou as duas), a borda de cima e a de baixo ainda vão até os cantos: onde
// elas TERMINAM diz onde fica a lateral. Pega a ponta mais de fora das duas (o dedo encurta uma, não
// estica) e soma o canto arredondado do cartão (raio ISO 3,18 mm), porque a reta da borda acaba onde
// começa a curva. Só vale se a cor confirmar: por dentro da lateral deduzida tem cor de cartão (onde o
// dedo não cobre) e por fora não — um fio de cabelo ou o fim de uma reta do fundo não passam.
const RAIO_CANTO_MM = 3.18;

function lateralPorPonta(T, B, lado, wPxAprox) {
  // ponta mais de fora entre a borda de cima (T) e a de baixo (B): lado 'E' = menor x, 'D' = maior x
  const pontas = [T, B].map((H) => {
    const x = lado === 'E' ? H.lo : H.hi;
    return { x, y: H.c + H.k * x, k: H.k };
  });
  const p = lado === 'E' ? (pontas[0].x <= pontas[1].x ? pontas[0] : pontas[1]) : (pontas[0].x >= pontas[1].x ? pontas[0] : pontas[1]);
  // 70% do raio: a reta detectada avança um pouco sobre a curva do canto (com o raio inteiro, a
  // largura deduzida saía ~1% maior em cartões desenhados — média 303 px para 300 reais)
  const r = 0.7 * RAIO_CANTO_MM * wPxAprox / 85.6;
  const n = Math.sqrt(1 + p.k * p.k);
  const s = lado === 'E' ? -1 : 1;
  const x = p.x + s * r / n;
  const y = p.y + s * r * p.k / n;
  // lateral perpendicular à borda de cima: x = c + kv·y com kv = −k
  return { k: -T.k, c: x + T.k * y, deduzida: true };
}

export function inferCardFromEdges({ verts, hors }, face, { ratio = 85.6 / 53.98, pixels = null } = {}) {
  const { ipd, mid } = face;
  let best = null;
  let bestScore = -Infinity;
  for (let a = 0; a < hors.length; a++) {
    for (let b = a + 1; b < hors.length; b++) {
      const T = hors[a];
      const B = hors[b];
      if (Math.abs(T.k - B.k) > 0.07) continue;
      const h = (B.at - T.at) / Math.sqrt(1 + T.k * T.k);
      if (h < 0.45 * ipd || h > 1.2 * ipd) continue;
      if (Math.min(T.hi - T.lo, B.hi - B.lo) < 0.5 * ipd) continue;          // bordas compridas o bastante
      // largura aproximada pelas pontas, para o raio do canto e para achar laterais reais por perto
      // (as pontas das retas ficam um raio de canto antes de cada canto: largura = pontas + 2 raios)
      const w0 = (Math.max(T.hi, B.hi) - Math.min(T.lo, B.lo)) / Math.sqrt(1 + T.k * T.k) / (1 - 2 * RAIO_CANTO_MM / 85.6);
      if (w0 < 0.8 * ipd) continue;
      // lateral real perto da ponta (apoio mínimo de 35% da altura) vence a deduzida
      const real = (lado) => {
        const ded = lateralPorPonta(T, B, lado, w0);
        const yMid = (T.at + B.at) / 2;
        const xDed = ded.c + ded.k * yMid;
        let melhor = null;
        for (const V of verts) {
          if (Math.abs(V.k + T.k) > 0.1) continue;
          const xV = V.c + V.k * yMid;
          if (Math.abs(xV - xDed) > 0.06 * w0) continue;
          if (Math.min(V.len, h) / h < 0.35) continue;
          if (!melhor || V.len > melhor.len) melhor = V;
        }
        return melhor || ded;
      };
      const L = real('E');
      const R = real('D');
      // (as duas laterais "reais" mas curtas também passam aqui: o detector normal exige 50% de cada uma)
      const tl = cross(L, T), tr = cross(R, T), br = cross(R, B), bl = cross(L, B);
      const w = Math.hypot(tr.x - tl.x, tr.y - tl.y);
      const rel = w / ipd;
      if (rel < 0.9 || rel > 2.2) continue;
      const hr = h / (w / ratio);
      if (hr < 0.72 || hr > 1.025) continue;
      const cx = (tl.x + tr.x + br.x + bl.x) / 4;
      const cy = (tl.y + tr.y + br.y + bl.y) / 4;
      if (Math.abs(cx - mid.x) > 0.6 * ipd) continue;
      if (cy > mid.y || mid.y - cy > 2.5 * ipd) continue;
      const quad = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
      let score = 0;
      if (pixels) {
        const v = colorVerdict(pixels, quad, ipd, { deduzidoL: !!L.deduzida, deduzidoR: !!R.deduzida });
        if (!v.ok) continue;
        if (v.ambiguo && hr < 0.85) continue;                    // cor não ajuda → formato mais rígido
        score = v.score;
      }
      score += (L.deduzida ? 0 : 1) + (R.deduzida ? 0 : 1);                     // prefere lado real
      if (score > bestScore) {
        bestScore = score;
        best = { ...quad, deduzido: [L.deduzida && 'esquerda', R.deduzida && 'direita'].filter(Boolean) };
      }
    }
  }
  return best;
}

// escolhe o melhor retângulo de cartão; face = { ipd, mid:{x,y} } em px da mesma imagem
export function findCardFromLines({ verts, hors }, face, { ratio = 85.6 / 53.98, pixels = null, debug = null } = {}) {
  const { ipd, mid } = face;
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const L = verts[i];
      const R = verts[j];
      if (Math.abs(L.k - R.k) > 0.07) continue;                  // laterais paralelas (~4°)
      const w = (R.at - L.at) / Math.sqrt(1 + L.k * L.k);
      const rel = w / ipd;
      if (rel < 0.9 || rel > 2.2) continue;
      const cx = (L.at + R.at) / 2;
      if (Math.abs(cx - mid.x) > 0.6 * ipd) continue;
      for (let a = 0; a < hors.length; a++) {
        for (let b = a + 1; b < hors.length; b++) {
          const T = hors[a];
          const B = hors[b];
          if (Math.abs(T.k - B.k) > 0.07) continue;
          if (Math.abs(T.k + L.k) > 0.1) continue;               // cima/baixo perpendiculares às laterais
          const h = (B.at - T.at) / Math.sqrt(1 + T.k * T.k);
          const hr = h / (w / ratio);                            // 1 = cartão de frente; testa inclina → menor
          // inclinar na testa só ENCURTA a altura; altura "grande demais" = largura pega por dentro
          // (ex.: borda de um desenho interno do cartão quando o dedo cobre a lateral de verdade)
          if (hr < 0.72 || hr > 1.025) { debug?.push({ L: Math.round(L.at), R: Math.round(R.at), T: Math.round(T.at), B: Math.round(B.at), motivo: 'altura ' + hr.toFixed(2) }); continue; }
          const tl = cross(L, T);
          const tr = cross(R, T);
          const br = cross(R, B);
          const bl = cross(L, B);
          const cy = (tl.y + br.y) / 2;
          if (cy > mid.y || mid.y - cy > 2.5 * ipd) continue;    // na testa, acima dos olhos
          // apoio de cada borda = quanto dela tem segmento de verdade DENTRO do retângulo
          // (extensão sobreposta e comprimento somado, o menor dos dois).
          // As LATERAIS dão a largura (a escala): têm de estar quase inteiras — não dá para adivinhar
          // uma lateral coberta pelo dedo (o detector pegaria a borda de um desenho interno do cartão).
          // Cima/baixo podem ter o dedo no meio, mas precisam atravessar o cartão (bloco interno não atravessa).
          const yTop = Math.min(tl.y, tr.y), yBot = Math.max(bl.y, br.y);
          const xLeft = Math.min(tl.x, bl.x), xRight = Math.max(tr.x, br.x);
          const cov = (lo, hi, a, b) => Math.max(0, Math.min(hi, b) - Math.max(lo, a)) / (b - a);
          const sL = Math.min(Math.min(L.len, h) / h, cov(L.lo, L.hi, yTop, yBot));
          const sR = Math.min(Math.min(R.len, h) / h, cov(R.lo, R.hi, yTop, yBot));
          const sT = Math.min(Math.min(T.len, w) / w, cov(T.lo, T.hi, xLeft, xRight));
          const sB = Math.min(Math.min(B.len, w) / w, cov(B.lo, B.hi, xLeft, xRight));
          if (sL < 0.5 || sR < 0.5 || sT < 0.45 || sB < 0.45) { debug?.push({ L: Math.round(L.at), R: Math.round(R.at), T: Math.round(T.at), B: Math.round(B.at), motivo: `apoio E${sL.toFixed(2)} D${sR.toFixed(2)} C${sT.toFixed(2)} B${sB.toFixed(2)}` }); continue; }   // dedos no canto cobrem parte da lateral; borda de baixo tem pouco contraste com a pele (a cor confere)
          const sup = (sL + sR + sT + sB) / 2;
          const quad = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
          let score;
          if (pixels) {
            const v = colorVerdict(pixels, quad, ipd);
            if (!v.ok) { debug?.push({ L: Math.round(L.at), R: Math.round(R.at), T: Math.round(T.at), B: Math.round(B.at), motivo: 'cor ' + v.score.toFixed(2) }); continue; }   // bordas não separam cartão de fundo
            if (v.ambiguo && hr < 0.85) continue;                // cor não ajuda → formato mais rígido
            score = 2 * v.score + sup;
          } else {
            score = 2 * rel + hr + sup;                          // sem pixels: a maior válida = bordas de fora
          }
          if (score > bestScore) {
            bestScore = score;
            best = { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl, support: sup };
          }
        }
      }
    }
  }
  return best;
}

// O cartão aparece pela metade? Borda de cima e de baixo bem visíveis, do tamanho de um cartão, na testa,
// mas sem as duas laterais → quase sempre é a MÃO cobrindo uma lateral (visto com um lojista 14/10).
// Serve só para dar a instrução certa; nunca para medir.
export function looksLikeCoveredCard({ hors }, face, { ratio = 85.6 / 53.98 } = {}) {
  const { ipd, mid } = face;
  for (let a = 0; a < hors.length; a++) {
    for (let b = a + 1; b < hors.length; b++) {
      const T = hors[a];
      const B = hors[b];
      if (Math.abs(T.k - B.k) > 0.07) continue;
      const h = B.at - T.at;
      const comprimento = Math.min(T.hi - T.lo, B.hi - B.lo);
      if (comprimento < 0.8 * ipd) continue;                                        // bordas compridas
      if (h < 0.4 * ipd || h > 1.1 * ipd) continue;                                 // altura de cartão
      const cy = (T.at + B.at) / 2;
      if (cy > mid.y || mid.y - cy > 2.5 * ipd) continue;                           // na testa
      const cx = (Math.max(T.lo, B.lo) + Math.min(T.hi, B.hi)) / 2;
      if (Math.abs(cx - mid.x) > 0.8 * ipd) continue;
      if (comprimento / h > ratio * 1.25) continue;                                 // faixa longa (não é cartão)
      return true;
    }
  }
  return false;
}

// parte OpenCV: Hough na região da testa. canvasEl = quadro inteiro; face em px do quadro.
export function detectCardByLines(canvasEl, face, pre = null) {
  const cv = window.cv;
  const ipd = Math.hypot(face.rightEye.x - face.leftEye.x, face.rightEye.y - face.leftEye.y);
  const mid = { x: (face.leftEye.x + face.rightEye.x) / 2, y: (face.leftEye.y + face.rightEye.y) / 2 };
  const r = pre ? pre.r : foreheadRect(face, canvasEl.width, canvasEl.height);
  if (!r) return null;
  const { x0, y0 } = r;
  let edges = null;
  let ownEdges = false;
  const lines = new cv.Mat();
  try {
    if (pre) edges = pre.edges;
    else {
      const roi = readRegion(canvasEl, r);
      try { edges = colorEdges(roi, 40, 120); ownEdges = true; } finally { roi.delete(); }
    }
    cv.HoughLinesP(edges, lines, 1, Math.PI / 360, 25, Math.max(15, 0.2 * ipd), Math.max(3, 0.06 * ipd));
    const segs = [];
    for (let i = 0; i < lines.rows; i++) {
      const d = lines.data32S;
      segs.push({ x1: d[i * 4] + x0, y1: d[i * 4 + 1] + y0, x2: d[i * 4 + 2] + x0, y2: d[i * 4 + 3] + y0 });
    }
    const grouped = groupLines(segs, { refX: mid.x, refY: mid.y - ipd, mergePx: Math.max(3, ipd * 0.04) });
    if (typeof window !== 'undefined') window.__dnpLines = { segs: segs.length, verts: grouped.verts.length, hors: grouped.hors.length };
    const debug = typeof window !== 'undefined' && window.__dnpLinesDebug ? [] : null;
    // 1º as 4 bordas visíveis; se não der, deduz a lateral escondida pelas pontas de cima/baixo
    const res = findCardFromLines(grouped, { ipd, mid }, { pixels: pre ? pre.pixels : null, debug })
      || inferCardFromEdges(grouped, { ipd, mid }, { pixels: pre ? pre.pixels : null });
    if (debug) window.__dnpLinesDebug = debug;
    if (!res && typeof window !== 'undefined') window.__dnpCoberto = looksLikeCoveredCard(grouped, { ipd, mid });
    else if (typeof window !== 'undefined') window.__dnpCoberto = false;
    return res;
  } finally {
    if (edges && ownEdges) edges.delete(); lines.delete();
  }
}
