// src/distanceGuide.js — conduz o cliente: aproximar (~40 cm) e depois afastar devagar (~65 cm)
//
// Usa a largura do cartão como fração da largura do quadro (independe da resolução da câmera).
// Com FOV ~64°: 0,16 ≈ 42 cm; 0,10 ≈ 68 cm. Mesma ideia do faceSizeRatio do Fittingbox
// (guiar pelo tamanho na imagem, não por distância estimada) — ver pesquisa §2.1 [REA].
//
// 14/10: o "pode parar" usa a VARIAÇÃO ROBUSTA das medidas coletadas (p90/p10 das larguras, a mesma
// conta da extrapolação). Antes comparava com o maior cartão já visto: um quadro mal medido inflava
// esse máximo e a página parava cedo ("afastou pouco 1,27×").

export const GUIDE_DEFAULTS = {
  nearRatio: 0.16,    // começa a coletar quando o cartão ocupa ≥16% da largura
  farRatio: 0.085,    // longe demais (~80 cm): se ainda não variou o bastante, recomeça de perto
  targetRange: 1.55,  // para quando as larguras coletadas variam 1,55× (p90/p10)
};

export function createGuide(opts = {}) {
  return { ...GUIDE_DEFAULTS, ...opts, phase: 'aproximar', sweeps: 0 };
}

// variação robusta das larguras coletadas (p90/p10)
export function robustRange(widths) {
  if (widths.length < 5) return 1;
  const a = [...widths].sort((p, q) => p - q);
  const at = (p) => a[Math.round((a.length - 1) * p)];
  return at(0.9) / at(0.1);
}

// cardRatio = largura do cartão / largura do quadro; range = robustRange das medidas já coletadas
// devolve { collect, done, tooFar, progress (0–1), message } e atualiza g
export function guideStep(g, cardRatio, range = 1) {
  if (g.phase === 'aproximar') {
    if (cardRatio >= g.nearRatio) {
      g.phase = 'afastar';
    } else {
      return { collect: false, done: false, tooFar: false, progress: 0, message: 'Aproxime o rosto da câmera (uns 40 cm), com o cartão na testa.' };
    }
  }
  const progress = Math.max(0, Math.min(1, Math.log(range) / Math.log(g.targetRange)));
  if (range >= g.targetRange) {
    g.sweeps += 1;
    return { collect: true, done: true, tooFar: false, progress: 1, message: 'Pode parar.' };
  }
  if (cardRatio <= g.farRatio) {
    g.sweeps += 1;
    return { collect: false, done: false, tooFar: true, progress, message: 'Longe demais. Volte para perto e afaste de novo, mais devagar.' };
  }
  return { collect: true, done: false, tooFar: false, progress, message: 'Agora afaste-se DEVAGAR, olhando para a câmera…' };
}

// recomeça o afastamento mantendo o que já foi coletado
export function restartSweep(g) {
  g.phase = 'aproximar';
}

// ---- modo PARADO (padrão desde 14/10, pedido do Lucas: sem ter que se afastar) ----
// Fica a uns 50 cm e segura. Usa a largura do cartão em relação ao LADO MAIOR do quadro (vale em
// pé e deitado). Com FOV ~64° no lado maior: 0,17 ≈ 40 cm · 0,137 ≈ 50 cm · 0,11 ≈ 62 cm.
export const STATIC_DEFAULTS = { minRatio: 0.11, maxRatio: 0.17 };

export function staticStep(cardRatioLong, opts = {}) {
  const { minRatio, maxRatio } = { ...STATIC_DEFAULTS, ...opts };
  if (cardRatioLong > maxRatio) return { collect: false, message: 'Afaste um pouco o rosto da câmera (uns 50 cm).' };
  if (cardRatioLong < minRatio) return { collect: false, message: 'Chegue um pouco mais perto da câmera (uns 50 cm).' };
  return { collect: true, message: 'Isso! Fique parado olhando para a câmera…' };
}
