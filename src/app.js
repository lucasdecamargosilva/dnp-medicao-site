// src/app.js
import { startCamera } from './camera.js';
import { createFaceDetector, detectFace } from './faceDetector.js';
import { findCard } from './cardDetector.js';
import { detectCardByLines } from './cardLines.js';
import { cardScale } from './cardScale.js';
import { checkPose } from './poseGate.js';
import { computeDnp } from './dnpCalculator.js';
import { aggregate } from './aggregator.js';
import { OPTICS_DEFAULTS, focalPx, cameraToCardMm, scaleAtPupils, distanceMonoFromNear, scaleFromIris } from './optics.js';
import { fitInfinity, EXTRAP_DEFAULTS } from './extrapolation.js';
import { createGuide, guideStep, restartSweep, robustRange, staticStep } from './distanceGuide.js';
import { CARD_MM } from './cardScale.js';
import { createStableText, pushText, createStableFlag, pushFlag } from './statusBoard.js';
import { createVoice } from './voice.js';
import { createStability, pushFrame, stepMeasure } from './stability.js';
import { mostraResultado } from './resultCard.js';
import { loadOpenCv } from './opencvLoader.js';
import { iniciaModoFoto } from './photoMode.js';

// parâmetros ópticos, ajustáveis pela URL para calibrar (ex.: ?hfov=70&cartao=10&rot=13)
const qs = new URLSearchParams(location.search);
const OPT = {
  hfovDeg: Number(qs.get('hfov')) || OPTICS_DEFAULTS.hfovDeg,
  cardToPupilMm: qs.has('cartao') ? Number(qs.get('cartao')) : OPTICS_DEFAULTS.cardToPupilMm,
  rotationCenterMm: Number(qs.get('rot')) || OPTICS_DEFAULTS.rotationCenterMm,
  irisDiameterMm: OPTICS_DEFAULTS.irisDiameterMm,
};
const mediana = (xs) => { const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

const MAX_SWEEPS = 3;          // tentativas de afastamento antes de cair no método antigo
// modo de medição: PARADO é o padrão (14/10, pedido do Lucas); ?modo=afastar liga a extrapolação
const MODO_AFASTAR = qs.get('modo') === 'afastar';
// 14/10: o Lucas achou a medição RÁPIDA mais assertiva → é o padrão de novo. A versão que espera
// ficar parado + olhar fixo (stability.js) fica em ?modo=lento.
const MODO_LENTO = qs.get('modo') === 'lento';
const STATIC_FRAMES = 40;
// 25/10: FOTO AUTOMÁTICA (padrão da tela inicial; ?modo=auto): a câmera fica escaneando com as
// orientações e TIRA a foto sozinha quando está tudo certo e a pessoa parada — como no oculosworld.
// 3 fotos (cada uma passa por todas as verificações naquele instante) → mediana.
let MODO_AUTO = qs.get('modo') === 'auto';
const AUTO_FOTOS = 3;
const AUTO_FIRME_MS = 600;     // parado e tudo ok por esse tempo antes de cada foto
const AUTO_INTERVALO_MS = 450; // entre uma foto e outra

// "flash" + clique na hora da foto, e miniatura embaixo da câmera
function efeitoFoto(canvas) {
  const wrap = document.getElementById('wrap');
  wrap.classList.remove('flash');
  void wrap.offsetWidth;
  wrap.classList.add('flash');
  try {
    const ac = efeitoFoto.ac || (efeitoFoto.ac = new (window.AudioContext || window.webkitAudioContext)());
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 1800;
    g.gain.setValueAtTime(0.25, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.08);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.09);
  } catch (e) { /* sem som, tudo bem */ }
  const tira = document.getElementById('auto-fotos');
  const k = 120 / canvas.width;
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const img = document.createElement('img');
  img.src = c.toDataURL('image/jpeg', 0.7);
  if (ESPELHO) img.style.transform = 'scaleX(-1)';
  tira.appendChild(img);
}
const MAX_SAMPLES = 600;
const MIN_PIXELS = 1280 * 720; // abaixo disso a câmera é fraca (mesmo limite do Fittingbox, pesquisa §2.1 [REA])

const video = document.getElementById('video');
const work = document.getElementById('work');
const msg = document.getElementById('msg');
const resultEl = document.getElementById('result');
const progressEl = document.getElementById('progress');
const warnEl = document.getElementById('warn');
const checksEl = document.getElementById('checks');
const countEl = document.getElementById('count');
const overlay = document.getElementById('overlay');

// assistente de voz (o Chrome só deixa falar depois de um clique: botão "Ativar voz")
// voz LIGADA por padrão (14/10). Chrome/iPhone bloqueiam fala antes do 1º toque na página:
// se bloquear, mostra "toque na tela" e o primeiro toque em qualquer lugar destrava.
const vozBtn = document.getElementById('voz');
const vozAviso = document.getElementById('voz-aviso');
const voz = createVoice({
  preferName: qs.get('voz'),
  onBlocked: () => { vozAviso.hidden = false; },
  onUnlocked: () => { vozAviso.hidden = true; },
});
const atualizaBotao = () => { vozBtn.textContent = voz.on ? '🔊 Voz ligada (toque para desligar)' : '🔇 Voz desligada (toque para ligar)'; };
atualizaBotao();
vozBtn.onclick = (e) => {
  e.stopPropagation();
  voz.on = !voz.on;
  atualizaBotao();
  if (voz.on) voz.say(msg.textContent, { force: true });
};
const destrava = () => { if (voz.on && !voz.unlocked) voz.say(msg.textContent, { force: true }); };
document.addEventListener('pointerdown', destrava);
document.addEventListener('keydown', destrava);

// mensagem e checklist estáveis (sem piscar a cada quadro)
const stableMsg = createStableText();
const flags = { rosto: createStableFlag(), cartao: createStableFlag(), postura: createStableFlag(), distancia: createStableFlag() };
const LABELS = { rosto: 'Rosto', cartao: 'Cartão', postura: 'Postura', distancia: 'Distância' };
window.__dnp = { avisos: {}, quadros: 0 };
// painel de diagnóstico na tela: abrir com ?debug=1
if (qs.has('debug') || location.port === '8797' || location.hostname.endsWith('.trycloudflare.com')) {   // servidor de teste (local ou pelo link do celular) com diagnóstico
  const pre = document.createElement('pre');
  pre.style.cssText = 'font-size:12px;background:#f3f4f6;padding:8px;max-width:640px;white-space:pre-wrap';
  document.body.appendChild(pre);
  let ult = 0;
  setInterval(() => {
    const fps = (window.__dnp.quadros - ult) * 2;
    ult = window.__dnp.quadros;
    const c = window.__dnpCard;
    (window.__dnpHist ||= []).push({ fps, visivel: !document.hidden, c: c && { ipd: c.ipd, cands: c.cands.slice(0, 6) } });
    if (window.__dnpHist.length > 240) window.__dnpHist.shift();
    // manda o diagnóstico para o servidor local de teste (só funciona no servidor sem cache, porta 8797)
    const env = { fps, visivel: !document.hidden, msg: msg.textContent, olhar: window.__dnp.olhar, olharBaixo: window.__dnp.olharBaixo, parado: window.__dnp.parado, c: c && { ipd: c.ipd, mid: c.mid, cands: c.cands.slice(0, 8) } };
    if (!document.hidden && (window.__dnpN = (window.__dnpN || 0) + 1) % 4 === 0 && work.width) {
      const small = document.createElement('canvas');
      small.width = 960; small.height = Math.round(960 * work.height / work.width);
      small.getContext('2d').drawImage(work, 0, 0, small.width, small.height);
      env.jpeg = small.toDataURL('image/jpeg', 0.7);
    }
    fetch('/__debug', { method: 'POST', body: JSON.stringify(env) }).catch(() => {});
    pre.textContent = `quadros/s: ${fps}  ·  vídeo ${video.videoWidth}×${video.videoHeight}\n` +
      (c ? `distância entre pupilas: ${c.ipd}px\nretângulos candidatos: ${c.cands.length}\n` +
        c.cands.slice(0, 6).map((k) => `  largura ${k.w}px (${k.rel}× pupilas) centro ${k.cx},${k.cy} → ${k.motivo}`).join('\n')
        : 'nenhum retângulo com proporção de cartão');
  }, 500);
}   // diagnóstico: quantas vezes cada aviso apareceu (ver no console)
const lastCard = { at: -Infinity, msg: '', flags: {} };   // última instrução com o cartão visível
function report(text, f) {
  const now = performance.now();
  if (f.cartao) { lastCard.msg = text; lastCard.flags = f; }
  window.__dnp.avisos[text] = (window.__dnp.avisos[text] || 0) + 1;
  window.__dnp.quadros += 1;
  const shown = pushText(stableMsg, text, now);
  setMsg(shown);
  voz.say(shown);
  checksEl.innerHTML = Object.keys(flags)
    .map((k) => `<span class="chk ${pushFlag(flags[k], !!f[k], now) ? 'ok' : ''}">${LABELS[k]}</span>`)
    .join('');
}

// desenha o que foi detectado por cima do vídeo (cartão em verde, pupilas em azul) e, sem cartão,
// um GUIA tracejado mostrando onde encostar o cartão e onde pôr o dedo (lojista não sabia segurar, 14/10)
// Câmera ESPELHADA por padrão (24/10, pedido do Lucas): a pessoa se vê como num espelho, então ir
// para a direita move a imagem para a direita. Só a EXIBIÇÃO vira (CSS em #wrap.espelho); a detecção
// lê o quadro original da câmera, então as medidas e o lado OD/OE não mudam. ?espelho=0 desliga.
const ESPELHO = qs.get('espelho') !== '0';
if (ESPELHO) document.getElementById('wrap').classList.add('espelho');
// o overlay também é espelhado pelo CSS; o texto é desvirado aqui para não sair ao contrário
function textoLegivel(g, t, x, y) {
  g.save();
  g.translate(x, y);
  if (ESPELHO) g.scale(-1, 1);
  g.strokeText(t, 0, 0);
  g.fillText(t, 0, 0);
  g.restore();
}

function drawOverlay(face, corners) {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  const g = overlay.getContext('2d');
  g.clearRect(0, 0, overlay.width, overlay.height);
  const lw = Math.max(2, overlay.width / 400);
  if (face && !corners) {
    const ipd = Math.hypot(face.rightEye.x - face.leftEye.x, face.rightEye.y - face.leftEye.y);
    const cx = (face.leftEye.x + face.rightEye.x) / 2;
    const cw = 1.35 * ipd;
    const ch = cw / 1.586;
    const cy = (face.leftEye.y + face.rightEye.y) / 2 - 0.85 * ipd;
    g.save();
    g.setLineDash([lw * 5, lw * 4]);
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = lw * 1.5;
    g.strokeRect(cx - cw / 2, cy - ch / 2, cw, ch);
    g.setLineDash([]);
    // dedo: bolinha amarela no meio da borda de cima
    g.fillStyle = '#facc15';
    g.beginPath();
    g.arc(cx, cy - ch / 2, lw * 5, 0, Math.PI * 2);
    g.fill();
    g.font = `bold ${Math.round(lw * 9)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.lineWidth = lw * 2;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    textoLegivel(g, 'dedo aqui', cx, cy - ch / 2 - lw * 8);
    g.fillStyle = '#fff';
    textoLegivel(g, 'cartão aqui', cx, cy + lw * 3);
    g.restore();
  }
  if (corners) {
    g.strokeStyle = '#16a34a';
    g.lineWidth = lw * 1.5;
    g.beginPath();
    const c = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
    g.moveTo(c[0].x, c[0].y);
    c.slice(1).forEach((p) => g.lineTo(p.x, p.y));
    g.closePath();
    g.stroke();
  }
  if (face) {
    g.fillStyle = '#2563eb';
    for (const p of [face.leftEye, face.rightEye]) {
      g.beginPath();
      g.arc(p.x, p.y, lw * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function setMsg(t) { msg.textContent = t; }

function drawFrameToWork() {
  work.width = video.videoWidth;
  work.height = video.videoHeight;
  work.getContext('2d').drawImage(video, 0, 0, work.width, work.height);
}

function fmt(m) {
  return `${m.value.toFixed(1)}mm ±${m.margin.toFixed(1)}`;
}

async function main() {
  setMsg('Ligando a câmera…');
  await startCamera(video);

  setMsg('Carregando detector de rosto…');
  const t0 = performance.now();
  let etapa = 'Carregando detector de rosto…';
  const tick = setInterval(() => setMsg(`${etapa} (${Math.round((performance.now() - t0) / 1000)}s)`), 500);
  let landmarker;
  try {
    landmarker = await createFaceDetector((e) => { etapa = e; });
  } finally {
    clearInterval(tick);
  }

  setMsg('Carregando OpenCV…');
  await loadOpenCv();

  if (video.videoWidth * video.videoHeight < MIN_PIXELS) {
    warnEl.textContent = `Câmera com resolução baixa (${video.videoWidth}×${video.videoHeight}); a medida pode sair menos precisa.`;
  }

  const guide = createGuide();
  // medição parada: só mede com a pessoa parada e olhando a câmera (stability.js)
  const est = createStability();
  const med = { phase: 'posicionar', avisoAte: 0 };
  // durante a medição, quadro sem rosto/cartão/pose ok só é PULADO; recomeça só se durar mais de 1,2 s
  // (antes qualquer falha de um instante cancelava e dizia "você se mexeu" com a pessoa parada)
  const quebraMedicao = () => {
    med.firmeDesde = null;   // foto automática: qualquer quadro ruim zera o "tudo certo há X ms"
    if (MODO_AFASTAR || !MODO_LENTO || med.phase !== 'medir') return;
    const agora = performance.now();
    if (med.falhaDesde == null) med.falhaDesde = agora;
    if (agora - med.falhaDesde > 1200) {
      samples.length = 0;
      med.phase = 'posicionar';
      med.falhaDesde = null;
      med.aviso = avisoPerdi;
      med.avisoAte = agora + 1500;
    }
  };
  const avisoMexeu = 'Você se mexeu. Vamos de novo: fique parado.';
  const avisoPerdi = 'Não achei o cartão. Segure-o pela borda de CIMA, deixando as laterais (esquerda e direita) livres.';   // já tem áudio gravado
  const samples = [];   // por frame: crua (para extrapolar) + corrigida por FOV (método antigo, comparação)
  // FOV vale para o LADO MAIOR do quadro (com o celular em pé, a largura é o lado menor)
  const ladoMaior = Math.max(video.videoWidth, video.videoHeight);
  const f = focalPx(ladoMaior, OPT.hfovDeg);

  function finish(fit) {
    const old = aggregate(samples);
    const perto = aggregate(samples.map((x) => x.perto));
    const irisTotal = mediana(samples.map((x) => x.totalPelaIris));
    const n1 = (x) => x.toFixed(1);
    // DP = distância entre as duas pupilas (binocular); DNP = de cada pupila até o meio do nariz (monocular)
    const bloco = (dp, e, d) =>
      `<div style="font-size:2rem;font-weight:800">DP: ${dp} mm</div>` +
      `<div style="color:#555;margin-bottom:6px">distância pupilar (entre as duas pupilas), para longe — é a que vai na lente</div>` +
      `<div>DNP olho esquerdo: <strong>${e} mm</strong> · DNP olho direito: <strong>${d} mm</strong></div>` +
      `<div style="color:#555;font-size:0.9rem">DNP = de cada pupila até o meio do nariz (DP = esquerda + direita)</div>`;
    const principal = !fit
      ? bloco(n1(old.total.value), n1(old.left.value), n1(old.right.value))
      : fit.ok
      ? bloco(n1(fit.total), n1(fit.left), n1(fit.right))
      : `<div style="color:#b45309">Não deu para extrapolar (${fit.problems.join('; ')}). Resultado pelo método antigo:</div>` +
        bloco(fmt(old.total), fmt(old.left), fmt(old.right));
    fetch('/__debug', { method: 'POST', body: JSON.stringify({ resultado: { modo: fit ? 'afastar' : 'parado', ok: fit?.ok, dp: fit?.total, n: fit?.n ?? samples.length, variacao: fit?.rangeRatio, residuo: fit?.rmsMm, k: fit?.kMm, problemas: fit?.problems, antigo: old.total.value, antigoE: old.left.value, antigoD: old.right.value, margem: old.total.margin, distanciaCm: mediana(samples.map((x) => x.distanciaMm)) / 10, lado: ladoMaior, iris: mediana(samples.map((x) => x.totalPelaIris)) } }) }).catch(() => {});
    // números técnicos (comparações, parâmetros) ficam recolhidos em "Detalhes técnicos" no cartão
    const tecnico = '<div>' + principal + '</div>' +
      (fit ? `<div style="margin-top:10px;font-size:0.9rem;color:#555">Comparação — DP pelo método antigo (correção por FOV): ${fmt(old.total)} · de perto sem correção: ${fmt(perto.total)}</div>` : `<div style="margin-top:10px;font-size:0.9rem;color:#555">Variação entre quadros: ±${old.total.margin.toFixed(1)} mm · de perto sem correção: ${fmt(perto.total)}</div>`) +
      (Number.isFinite(irisTotal) ? `<div style="font-size:0.9rem;color:#555">Conferência pela íris (método antigo): ${irisTotal.toFixed(1)} mm</div>` : '') +
      (!fit ? `<div style="font-size:0.8rem;color:#888">Medição parada: ${samples.length} quadros a ~${(mediana(samples.map((x) => x.distanciaMm)) / 10).toFixed(0)} cm · FOV ${OPT.hfovDeg}°, cartão→pupila ${OPT.cardToPupilMm} mm, rotação ${OPT.rotationCenterMm} mm</div>` : '') +
      (fit ? `<div style="font-size:0.8rem;color:#888">Extrapolação: ${fit.n} frames, cartão variou ${fit.rangeRatio ? fit.rangeRatio.toFixed(2) : '–'}×, resíduo ${fit.rmsMm ? fit.rmsMm.toFixed(2) : '–'} mm, Δ+r ≈ ${fit.kMm ? fit.kMm.toFixed(0) : '–'} mm · FOV ${OPT.hfovDeg}°, cartão→pupila ${OPT.cardToPupilMm} mm, rotação ${OPT.rotationCenterMm} mm</div>` : '') +
      (fit && fit.warnings && fit.warnings.length ? `<div style="font-size:0.85rem;color:#b45309">${fit.warnings.join(' ')}</div>` : '') +
      '';
    const usaFit = !!(fit && fit.ok);
    mostraResultado({
      dp: usaFit ? fit.total : old.total.value,
      esquerdo: usaFit ? fit.left : old.left.value,
      direito: usaFit ? fit.right : old.right.value,
      margem: usaFit ? null : old.total.margin,
      aviso: fit && !fit.ok ? 'Não deu para usar o método de afastar; o resultado veio pela medição parada.' : '',
      tecnico,
    });
    progressEl.value = 1;
    setMsg('Pronto!');
    const totalFala = (fit && fit.ok ? fit.total : old.total.value).toFixed(1).replace('.', ',');
    voz.sayResult(fit && fit.ok ? fit.total : old.total.value, `Pronto! Sua D P deu ${totalFala} milímetros.`);
  }

  function loop() {
    try {
      const face = detectFace(landmarker, video);
      if (!face) {
        quebraMedicao();
        drawOverlay(null, null);
        report('Centralize o rosto na câmera.', {});
        return requestAnimationFrame(loop);
      }

      drawFrameToWork();
      // contorno fechado primeiro; se o dedo quebrar o contorno, tenta pelas retas das bordas
      const corners = findCard(work, face, detectCardByLines);
      drawOverlay(face, corners);
      window.__dnp.ultimo = { corners, olhos: [face.leftEye, face.rightEye] };
      window.__dnp.olhar = face.gaze;
      window.__dnp.olharBaixo = face.lookDown;
      if (!corners) {
        // perdeu o cartão por um instante: mantém a instrução atual (não fica falando "não achei")
        quebraMedicao();
        if (performance.now() - lastCard.at < 1000) {
          report(lastCard.msg, lastCard.flags);
        } else {
          report(window.__dnpCoberto
            ? 'Estou vendo o cartão, mas a mão está cobrindo a lateral. Segure só pela borda de cima, com um dedo.'
            : 'Não achei o cartão. Segure-o pela borda de CIMA, deixando as laterais (esquerda e direita) livres.', { rosto: true });
        }
        return requestAnimationFrame(loop);
      }
      lastCard.at = performance.now();

      const { mmPerPixel, skew, rollDeg } = cardScale(corners);
      const pose = checkPose({
        eyeOpen: face.eyeOpen,
        gaze: face.gaze,          // olhar para o lado
        lookDown: face.lookDown,  // olhar para baixo (pedido do Lucas: mediu olhando a tela)
        frameWidth: video.videoWidth,
        leftEye: face.leftEye,
        rightEye: face.rightEye,
        noseCenter: face.noseCenter,
        cardSkew: skew,
        cardRollDeg: rollDeg,
      });

      if (!pose.ok) {
        quebraMedicao();
        report(MODO_LENTO && performance.now() < med.avisoAte ? med.aviso : MODO_LENTO && med.phase === 'medir' ? 'Medindo… não se mexa.' : pose.message, { rosto: true, cartao: true });
        return requestAnimationFrame(loop);
      }

      // guia de distância pelo tamanho do cartão na imagem
      const wPx = CARD_MM.width / mmPerPixel;
      let step;
      if (MODO_AFASTAR) {
        step = guideStep(guide, wPx / video.videoWidth, robustRange(samples.map((x) => x.w)));
      } else if (MODO_AUTO) {
        // foto automática: espera tudo certo + parado, aí tira a foto (até 3)
        const agora = performance.now();
        const sp = staticStep(wPx / ladoMaior);
        const stab = pushFrame(est, { t: agora, le: face.leftEye, re: face.rightEye, w: wPx });
        let tira = false;
        if (!sp.collect || stab.stable === false) {
          med.firmeDesde = null;
        } else if (stab.stable === true) {
          med.firmeDesde ??= agora;
          tira = agora - med.firmeDesde >= AUTO_FIRME_MS && agora - (med.ultimaFoto || 0) >= AUTO_INTERVALO_MS;
        }
        if (tira) { med.ultimaFoto = agora; efeitoFoto(work); }
        step = { collect: tira, tooFar: false, done: tira && samples.length + 1 >= AUTO_FOTOS,
          progress: samples.length / AUTO_FOTOS, message: sp.collect ? 'Isso! Fique parado olhando para a câmera…' : sp.message };
      } else if (!MODO_LENTO) {
        // medição rápida: coleta assim que estiver na faixa de distância, 40 quadros
        step = { ...staticStep(wPx / ladoMaior), done: false, tooFar: false };
        step.progress = Math.min(1, samples.length / STATIC_FRAMES);
        if (step.collect && samples.length + 1 >= STATIC_FRAMES) step.done = true;
      } else {
        const agora = performance.now();
        const sp = staticStep(wPx / ladoMaior);
        const stab = pushFrame(est, { t: agora, le: face.leftEye, re: face.rightEye, w: wPx });
        window.__dnp.parado = { ...stab, fase: med.phase };
        const r = stepMeasure(med, { ok: sp.collect, stable: stab.stable, t: agora, nSamples: samples.length });
        if (r.reset) { samples.length = 0; med.aviso = avisoMexeu; med.avisoAte = agora + 1500; }
        if (r.collect) med.falhaDesde = null;
        const msgParado = agora < med.avisoAte ? med.aviso : r.message || sp.message;
        step = { collect: r.collect, done: r.done, tooFar: false, progress: r.progress ?? 0, message: msgParado };
      }
      progressEl.value = step.progress;
      if (step.tooFar) {
        if (guide.sweeps >= MAX_SWEEPS && samples.length) return finish(fitInfinity(samples.map((x) => ({ w: x.w, ...x.cru })), { focalPx: f }));
        restartSweep(guide);
        report(step.message, { rosto: true, cartao: true, postura: true });
        return requestAnimationFrame(loop);
      }
      if (!step.collect) {
        if (!MODO_AFASTAR && !MODO_AUTO) countEl.textContent = '';
        if (MODO_AUTO) countEl.textContent = samples.length ? `📸 ${samples.length} de ${AUTO_FOTOS} fotos — continue parado` : '📸 A foto é tirada sozinha quando estiver tudo certo';
        report(step.message, { rosto: true, cartao: true, postura: true });
        return requestAnimationFrame(loop);
      }

      // DP crua (só escala do cartão) — é o que a extrapolação usa
      const cru = computeDnp({ ...face, mmPerPixel });
      // método antigo (correção por FOV/Δ/r chutados), mantido para comparação e como reserva
      const dCard = cameraToCardMm(mmPerPixel, ladoMaior, OPT.hfovDeg);
      const mmPupila = scaleAtPupils(mmPerPixel, dCard, OPT.cardToPupilMm);
      const perto = computeDnp({ ...face, mmPerPixel: mmPupila });
      const D = dCard + OPT.cardToPupilMm;   // câmera -> plano das pupilas (o cliente olha para a câmera)
      const left = distanceMonoFromNear(perto.left, D, OPT.rotationCenterMm);
      const right = distanceMonoFromNear(perto.right, D, OPT.rotationCenterMm);
      const sIris = scaleFromIris(face.irisPx, OPT.irisDiameterMm);
      const totalPelaIris = sIris ? (distanceMonoFromNear(perto.left / mmPupila * sIris, D, OPT.rotationCenterMm) + distanceMonoFromNear(perto.right / mmPupila * sIris, D, OPT.rotationCenterMm)) : NaN;
      if (samples.length < MAX_SAMPLES) {
        samples.push({ w: wPx, cru, left, right, total: left + right, perto, distanciaMm: D, totalPelaIris });
      }

      if (step.done && !MODO_AFASTAR) return finish(null);
      if (step.done) {
        const fit = fitInfinity(samples.map((x) => ({ w: x.w, ...x.cru })), { focalPx: f });
        if (fit.ok || guide.sweeps >= MAX_SWEEPS) return finish(fit);
        // não ficou bom: medidas instáveis → descarta e recomeça; faltou frame/afastamento → soma com a próxima passada
        if (fit.rmsMm > 0.8) samples.length = 0;
        restartSweep(guide);
        setMsg(`Quase lá (${fit.problems.join('; ')}). Aproxime de novo e afaste ainda mais devagar.`);
        voz.say('Quase lá. Aproxime de novo e afaste ainda mais devagar.', { force: true });
        return setTimeout(() => requestAnimationFrame(loop), 1500);
      }
      report(step.message, { rosto: true, cartao: true, postura: true, distancia: true });
      progressEl.title = `${samples.length} medidas`;
      countEl.textContent = MODO_AFASTAR ? `${samples.length} de ${EXTRAP_DEFAULTS.minFrames} medidas` : MODO_AUTO ? `📸 ${samples.length} de ${AUTO_FOTOS} fotos — continue parado` : MODO_LENTO ? `Medindo… ${Math.round(step.progress * 100)}%` : `${samples.length} de ${STATIC_FRAMES} medidas`;
      requestAnimationFrame(loop);
    } catch (err) {
      report('Erro na medição: ' + err.message + ' — tentando de novo…', {});
      requestAnimationFrame(loop);
    }
  }

  loop();
}

// Tela inicial: FOTO AUTOMÁTICA (recomendado) ou enviar foto da galeria.
// ?modo=auto|foto|vivo|lento|afastar pula a escolha.
function iniciaAuto() {
  MODO_AUTO = true;
  document.getElementById('instr-vivo').hidden = true;
  document.getElementById('instr-auto').hidden = false;
  iniciaVivo();
}
function iniciaVivo() {
  document.getElementById('escolha').hidden = true;
  document.getElementById('vivo').hidden = false;
  main().catch((err) => setMsg(err.message));
}
function iniciaFoto() {
  document.getElementById('escolha').hidden = true;
  iniciaModoFoto({ opt: OPT, voz }).catch((err) => { document.getElementById('foto-status').textContent = err.message; });
}
const modo = qs.get('modo');
if (modo === 'foto') iniciaFoto();
else if (modo === 'auto') iniciaAuto();
else if (modo) iniciaVivo();
else {
  document.getElementById('escolha').hidden = false;
  document.getElementById('bt-auto').onclick = iniciaAuto;
  document.getElementById('bt-foto').onclick = iniciaFoto;
}
