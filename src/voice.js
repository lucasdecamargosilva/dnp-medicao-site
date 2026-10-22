// src/voice.js — assistente de voz: fala a instrução da tela para o cliente não precisar ler (14/10)
//
// Voz boa: áudios pré-gravados com a voz neural do agente de voz do Lucas (audio/*.mp3, ver voiceClips.js);
// frase sem áudio cai na voz do navegador (Web Speech API).
//
// Fala quando o aviso MUDA e repete
// o mesmo aviso se a pessoa continuar parada nele. Aviso novo interrompe o anterior (pedido do Lucas).

import { clipForText, resultClips } from './voiceClips.js';

export const VOICE_DEFAULTS = { repeatMs: 9000 };

// decide se fala agora (pura, testável). Devolve false, 'fala' ou 'corta' (interrompe a fala atual).
// Aviso NOVO: corta o que estiver falando e fala o novo na hora (o texto da tela já é estabilizado,
// então não picota). Mesmo aviso: só repete depois de repeatMs e se não estiver falando.
export function shouldSpeak(st, text, now, speaking) {
  if (!text) return false;
  if (text !== st.lastText) {
    st.lastText = text;
    st.lastAt = now;
    return speaking ? 'corta' : 'fala';
  }
  if (!speaking && now - st.lastAt >= st.repeatMs) {
    st.lastAt = now;
    return 'fala';
  }
  return false;
}

// voz em português; evita a "Luciana" quando houver outra (preferência do Lucas). ?voz=Nome força uma.
function pickVoice(preferName) {
  const voices = window.speechSynthesis.getVoices();
  const pt = voices.filter((v) => /^pt(-|_)?BR/i.test(v.lang) || /^pt/i.test(v.lang));
  if (preferName) {
    const v = voices.find((x) => x.name.toLowerCase().includes(preferName.toLowerCase()));
    if (v) return v;
  }
  return pt.find((v) => !/luciana/i.test(v.name) && /BR/i.test(v.lang)) || pt.find((v) => /BR/i.test(v.lang)) || pt[0] || null;
}

export function createVoice({ preferName = null, onBlocked = () => {}, onUnlocked = () => {}, ...opts } = {}) {
  const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const st = { ...VOICE_DEFAULTS, ...opts, lastText: null, lastAt: -Infinity, on: true, voice: null, unlocked: false };
  if (ok) {
    const load = () => { st.voice = pickVoice(preferName); };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }
  // player dos áudios gravados: um por vez; novo corta o anterior
  let audio = null;
  let fila = [];
  const tocando = () => !!audio && !audio.paused && !audio.ended;
  const paraAudio = () => { fila = []; if (audio) { audio.onended = null; audio.pause(); } };
  function tocaClipes(ids) {
    paraAudio();
    if (ok) window.speechSynthesis.cancel();
    fila = [...ids];
    const proximo = () => {
      const id = fila.shift();
      if (!id) return;
      audio = new Audio(`audio/${id}.mp3`);
      audio.onended = proximo;
      audio.play().then(
        () => { if (!st.unlocked) { st.unlocked = true; onUnlocked(); } },
        (e) => { if (e && e.name === 'NotAllowedError') { st.lastText = null; onBlocked(); } },
      );
    };
    proximo();
  }

  return {
    get on() { return st.on; },
    get unlocked() { return st.unlocked; },
    set on(v) { st.on = !!v; if (!st.on) { paraAudio(); if (ok) window.speechSynthesis.cancel(); } },
    // fala a DP do resultado com os pedaços gravados ("Pronto! Sua DP deu" + "63" + "vírgula 4 milímetros")
    sayResult(dp, fallbackText) {
      if (!st.on) return;
      const ids = resultClips(dp);
      if (!ids) return this.say(fallbackText, { force: true });
      st.lastText = fallbackText; st.lastAt = performance.now();
      tocaClipes(ids);
    },
    // chama a cada quadro com o aviso atual da tela
    say(text, { force = false } = {}) {
      if (!st.on) return;
      const clip = clipForText(text);
      if (clip) {
        const acao = force ? 'corta' : shouldSpeak(st, text, performance.now(), tocando());
        if (!acao) return;
        if (force) { st.lastText = text; st.lastAt = performance.now(); }
        tocaClipes([clip]);
        return;
      }
      if (!ok) return;
      const speaking = window.speechSynthesis.speaking || window.speechSynthesis.pending || tocando();
      // forçado sem nada falando = fala direto (no iPhone precisa ser no mesmo instante do toque)
      const acao = force ? (speaking ? 'corta' : 'fala') : shouldSpeak(st, text, performance.now(), speaking);
      if (!acao) return;
      if (force) { st.lastText = text; st.lastAt = performance.now(); }
      const u = new SpeechSynthesisUtterance(text.replace(/…/g, '.'));
      u.lang = 'pt-BR';
      if (st.voice) u.voice = st.voice;
      u.rate = 1.05;
      // o navegador só deixa falar depois de um toque na página: avisa quando bloquear
      u.onstart = () => { if (!st.unlocked) { st.unlocked = true; onUnlocked(); } };
      u.onerror = (e) => { if (e.error === 'not-allowed') { st.lastText = null; onBlocked(); } };
      if (acao === 'corta') {
        paraAudio();
        window.speechSynthesis.cancel();
        // o Chrome às vezes descarta uma fala dada logo após o cancel(); espera um instante
        setTimeout(() => { if (st.lastText === text) window.speechSynthesis.speak(u); }, 60);
      } else {
        window.speechSynthesis.speak(u);
      }
    },
  };
}
