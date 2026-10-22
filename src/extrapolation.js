// src/extrapolation.js — DP "de longe" por extrapolação para distância infinita (13/10/2026)
//
// Ideia (pesquisa §3.2): a DP crua (escala do cartão, sem correção nenhuma) encolhe quanto mais
// perto o cliente está, porque (a) as pupilas ficam atrás do cartão e (b) os olhos convergem para
// a câmera. Os dois efeitos somados valem ~ (Δ+r)/d, e 1/d é proporcional à largura do cartão em px.
// Medindo enquanto o cliente se afasta, o valor "quando o cartão tende a zero px" (d → ∞) é a DP de
// longe — sem depender do FOV da câmera, da profundidade cartão→pupila (Δ) nem do raio de rotação (r).
//
// Ajustamos 1/DP_crua = 1/DP_longe + c·w (e não DP_crua = a + b·w): o termo de 2ª ordem que sobra
// no inverso é Δ·r/d², ~4× menor que (Δ+r)²/d² do ajuste direto (validado nos testes com o modelo exato).

export const EXTRAP_DEFAULTS = {
  minFrames: 40,       // frames válidos durante o afastamento (60 era demais a ~8 quadros/s)
  minRangeRatio: 1.5,  // largura do cartão (p90/p10) precisa variar pelo menos 1,5× (ex.: 40 → 60 cm)
  maxRmsMm: 0.8,       // resíduo do ajuste; acima disso o cliente mexeu o cartão/olhar no meio
  plausibleKMm: [10, 40], // Δ+r estimado; fora disso desconfiar (só aviso)
};

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const percentile = (xs, p) => {
  const a = [...xs].sort((x, y) => x - y);
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
};

// regressão robusta de Theil–Sen: inclinação = mediana das inclinações entre todos os pares
export function theilSen(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = xs[j] - xs[i];
      if (Math.abs(dx) > 1e-9) slopes.push((ys[j] - ys[i]) / dx);
    }
  }
  if (!slopes.length) return null;
  const b = median(slopes);
  const a = median(xs.map((x, i) => ys[i] - b * x));
  return { a, b };
}

// points: [{ w, total, left, right }] — w = largura do cartão em px; total/left/right = DP crua em mm
// focalPx (opcional): só para o diagnóstico Δ+r; não entra no resultado.
export function fitInfinity(points, { focalPx = null, cardWidthMm = 85.6, ...opts } = {}) {
  const cfg = { ...EXTRAP_DEFAULTS, ...opts };
  const pts = points.filter((p) => p.w > 0 && p.total > 0 && Number.isFinite(p.total));
  const n = pts.length;
  const problems = [];
  if (n < 3) return { ok: false, n, problems: ['poucos frames'] };

  const ws = pts.map((p) => p.w);
  const fit = theilSen(ws, pts.map((p) => 1 / p.total));
  if (!fit || fit.a <= 0) return { ok: false, n, problems: ['ajuste não convergiu'] };

  const total = 1 / fit.a;
  // monoculares pela proporção de cada olho (mais estável que extrapolar cada olho sozinho)
  const left = total * median(pts.map((p) => p.left / p.total));
  const right = total - left;

  const rangeRatio = percentile(ws, 0.9) / percentile(ws, 0.1);
  const residuals = pts.map((p) => p.total - 1 / (fit.a + fit.b * p.w));
  const rmsMm = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  // 1/DP = (1/a)(1 + K/d) e d = f·85,6/w  →  K = c·a_dp·f·85,6
  const kMm = focalPx ? fit.b * total * focalPx * cardWidthMm : null;

  if (n < cfg.minFrames) problems.push(`poucos frames (${n} de ${cfg.minFrames})`);
  if (rangeRatio < cfg.minRangeRatio) problems.push(`afastou pouco (variação ${rangeRatio.toFixed(2)}× de ${cfg.minRangeRatio}×)`);
  if (rmsMm > cfg.maxRmsMm) problems.push(`medidas instáveis (resíduo ${rmsMm.toFixed(2)} mm)`);
  const warnings = [];
  if (kMm != null && (kMm < cfg.plausibleKMm[0] || kMm > cfg.plausibleKMm[1])) {
    warnings.push(`Δ+r estimado ${kMm.toFixed(0)} mm fora do esperado (${cfg.plausibleKMm.join('–')} mm): cartão escorregou ou olhar mudou?`);
  }

  return { ok: problems.length === 0, n, total, left, right, rangeRatio, rmsMm, kMm, problems, warnings };
}
