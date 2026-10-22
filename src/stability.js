// src/stability.js — só mede com a pessoa PARADA e OLHANDO para a câmera (14/10, pedido do Lucas)
//
// Fittingbox (pesquisa §2.1/§2.2 [REA]) exige 15 quadros estáveis e 2 s na pose certa antes das fotos.
// Aqui: janela recente de posições das pupilas e da largura do cartão; "parado" = pupilas mexeram
// menos de 4,5% da distância entre elas e o cartão variou menos de 5% na janela (ignora o pior quadro).

export const STABILITY_DEFAULTS = {
  windowMs: 700,        // janela para decidir se está parado
  maxPupilMove: 0.045,  // fração da distância entre pupilas (0,02 = 2–3 px no celular: menor que a tremida
                        // natural da detecção, nunca ficava "parado" — 14/10)
  maxCardChange: 0.05,  // fração da largura do cartão
  settleMs: 1500,       // parado + olhando por 1,5 s antes de começar a medir
  measureMs: 3000,      // medição dura pelo menos 3 s
  minFrames: 45,        // e junta pelo menos 45 quadros
  maxGaze: 0.12,        // íris fora do centro do olho (fração da largura do olho) = não olha a câmera
};

export function createStability(opts = {}) {
  return { ...STABILITY_DEFAULTS, ...opts, hist: [] };
}

// frame: { t, le:{x,y}, re:{x,y}, w } → { stable, pupilMove, cardChange }
export function pushFrame(st, f) {
  st.hist.push(f);
  while (st.hist.length && f.t - st.hist[0].t > st.windowMs) st.hist.shift();
  const h = st.hist;
  // poucos quadros recentes (o cartão falha em alguns) = NÃO SEI, não "se mexeu" (null)
  if (h.length < 3 || f.t - h[0].t < st.windowMs * 0.5) return { stable: null, pupilMove: NaN, cardChange: NaN };
  const ipd = Math.hypot(f.re.x - f.le.x, f.re.y - f.le.y) || 1;
  // deslocamento em relação à MÉDIA da janela, e ignora o pior quadro (um quadro mal detectado não conta)
  const mx = (sel) => h.reduce((a, k) => a + sel(k), 0) / h.length;
  const c = { lx: mx((k) => k.le.x), ly: mx((k) => k.le.y), rx: mx((k) => k.re.x), ry: mx((k) => k.re.y) };
  const moves = h.map((k) => Math.max(Math.hypot(k.le.x - c.lx, k.le.y - c.ly), Math.hypot(k.re.x - c.rx, k.re.y - c.ry))).sort((a, b) => a - b);
  const move = moves[Math.max(0, moves.length - 2)];
  const ws = h.map((k) => k.w).sort((a, b) => a - b);
  const cardChange = (ws[Math.max(0, ws.length - 2)] - ws[Math.min(1, ws.length - 1)]) / ws[ws.length >> 1];
  const pupilMove = move / ipd;
  return { stable: pupilMove <= st.maxPupilMove && cardChange <= st.maxCardChange, pupilMove, cardChange };
}

export function resetStability(st) {
  st.hist = [];
}

// máquina de estados da medição parada: 'posicionar' → 'firmar' (1,5 s parado) → 'medir' (≥3 s)
// ok = pose/cartão/distância/olhar ok neste quadro; stable = pushFrame(...).stable
export function stepMeasure(m, { ok, stable, t, nSamples }, cfg = STABILITY_DEFAULTS) {
  // sem dados suficientes para saber se está parado: só espera (não zera a contagem nem cancela)
  if (stable === null) {
    if (m.phase === 'medir') return { collect: false, reset: false, done: false, message: 'Medindo… não se mexa.', progress: Math.min(1, (t - m.since) / cfg.measureMs) };
    if (m.phase === 'firmar') return { collect: false, reset: false, done: false, message: 'Isso! Fique parado olhando para a câmera…' };
    return { collect: false, reset: false, done: false, message: null };
  }
  if (m.phase === 'medir') {
    // só recomeça por MOVIMENTO DE VERDADE; falha de um instante (pose/cartão tremeu num quadro)
    // apenas pula o quadro — antes isso cancelava e dizia "você se mexeu" com a pessoa parada (14/10)
    if (!stable) {
      m.phase = 'posicionar';
      return { collect: false, reset: true, done: false, message: 'Você se mexeu. Vamos de novo: fique parado.' };
    }
    if (!ok) {
      return { collect: false, reset: false, done: false, message: 'Medindo… não se mexa.', progress: Math.min(1, (t - m.since) / cfg.measureMs) };
    }
    const done = t - m.since >= cfg.measureMs && nSamples + 1 >= cfg.minFrames;
    return { collect: true, reset: false, done, message: 'Medindo… não se mexa.', progress: Math.min(1, (t - m.since) / cfg.measureMs) };
  }
  if (!ok || !stable) {
    // firmando: falha de um instante (distância/pose oscilou num quadro) não zera a contagem
    if (m.phase === 'firmar' && (m.badSince ??= t) && t - m.badSince < 500) {
      return { collect: false, reset: false, done: false, message: 'Isso! Fique parado olhando para a câmera…' };
    }
    m.phase = 'posicionar';
    m.badSince = null;
    return { collect: false, reset: false, done: false, message: null };
  }
  m.badSince = null;
  if (m.phase !== 'firmar') { m.phase = 'firmar'; m.since = t; }
  if (t - m.since >= cfg.settleMs) {
    m.phase = 'medir'; m.since = t;
    return { collect: true, reset: false, done: false, message: 'Medindo… não se mexa.', progress: 0 };
  }
  return { collect: false, reset: false, done: false, message: 'Isso! Fique parado olhando para a câmera…' };
}
