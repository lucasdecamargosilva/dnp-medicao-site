// src/statusBoard.js — evita mensagem "piscando": cada quadro (30/s) dá um aviso diferente,
// então a tela mostra o aviso que MAIS apareceu na última janela e só troca depois de um tempo mínimo.

export function createStableText({ windowMs = 1200, holdMs = 900 } = {}) {
  return { windowMs, holdMs, history: [], shown: null, shownAt: -Infinity };
}

// registra o aviso do quadro e devolve o texto que deve estar na tela
export function pushText(st, text, now) {
  st.history.push({ text, t: now });
  while (st.history.length && now - st.history[0].t > st.windowMs) st.history.shift();
  const counts = new Map();
  for (const h of st.history) counts.set(h.text, (counts.get(h.text) || 0) + 1);
  let best = text;
  let bestN = -1;
  for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
  if (st.shown === null || (best !== st.shown && now - st.shownAt >= st.holdMs)) {
    st.shown = best;
    st.shownAt = now;
  }
  return st.shown;
}

// liga/desliga suavizado: "ok" se esteve ok em pelo menos metade dos quadros da janela
export function createStableFlag(windowMs = 800) {
  return { windowMs, history: [] };
}

export function pushFlag(fl, ok, now) {
  fl.history.push({ ok, t: now });
  while (fl.history.length && now - fl.history[0].t > fl.windowMs) fl.history.shift();
  const n = fl.history.filter((h) => h.ok).length;
  return n * 2 >= fl.history.length;
}
