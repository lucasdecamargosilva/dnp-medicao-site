// src/photoMode.js — modo FOTO (24/10/2026, pedido do Lucas): muita gente tinha dificuldade em segurar
// o cartão na posição certa ao vivo. Aqui a pessoa (ou alguém para ela) tira a foto com calma e envia.
// Cada foto passa pelas mesmas verificações da medição ao vivo (rosto, cartão inteiro, cabeça reta,
// olhando para a câmera); a lente vem do EXIF quando o celular manda. Até 3 fotos → mediana.
import { createFaceDetector, detectFace } from './faceDetector.js';
import { loadOpenCv } from './opencvLoader.js';
import { findCard } from './cardDetector.js';
import { detectCardByLines } from './cardLines.js';
import { checkPose } from './poseGate.js';
import { lerExif, hfovFromF35 } from './exif.js';
import { medidaDaFoto, juntaFotos } from './photoMeasure.js';
import { mostraResultado } from './resultCard.js';

const HFOV_CELULAR = 67;   // câmera principal típica de celular (26 mm equivalente, foto 4:3) quando não há EXIF
const MAX_LADO = 3200;     // reduz fotos enormes (12–48 MP) para caber na memória do celular
const MAX_FOTOS = 3;
const n1 = (x) => Number(x).toFixed(1).replace('.', ',');

export async function iniciaModoFoto({ opt, voz }) {
  const sec = document.getElementById('foto');
  const status = document.getElementById('foto-status');
  const lista = document.getElementById('foto-lista');
  const inputs = [document.getElementById('foto-camera'), document.getElementById('foto-galeria')];
  sec.hidden = false;
  inputs.forEach((i) => { i.disabled = true; });

  status.textContent = 'Preparando… (alguns segundos na primeira vez)';
  const landmarker = await createFaceDetector((e) => { status.textContent = e; });
  status.textContent = 'Preparando o leitor do cartão…';
  await loadOpenCv();
  status.textContent = '';
  inputs.forEach((i) => { i.disabled = false; });

  const fotos = [];   // { medida | null }
  const onChange = async (ev) => {
    const arquivos = [...ev.target.files].slice(0, MAX_FOTOS);
    ev.target.value = '';
    for (const arq of arquivos) {
      if (fotos.length >= MAX_FOTOS) fotos.shift(), lista.firstElementChild?.remove();
      const item = document.createElement('div');
      item.className = 'foto-item';
      item.innerHTML = '<div class="foto-info">Analisando a foto…</div>';
      lista.appendChild(item);
      let r;
      try { r = await analisaFoto(arq, { landmarker, opt }); } catch (e) { r = { motivo: 'Não consegui abrir essa foto: ' + e.message }; }
      fotos.push(r);
      item.innerHTML = (r.miniatura ? `<img src="${r.miniatura}" alt="">` : '') +
        (r.medida
          ? `<div class="foto-info"><b class="foto-ok">✓ Foto boa</b><span>DP ${n1(r.medida.dp)} mm · a ~${Math.round(r.medida.distanciaCm)} cm</span><span class="foto-lente">lente: ${r.lente}</span></div>`
          : `<div class="foto-info"><b class="foto-ruim">✗ Não deu para medir</b><span>${r.motivo}</span></div>`);
    }
    mostraConjunto(fotos, voz);
  };
  inputs.forEach((i) => { i.onchange = onChange; });
}

function mostraConjunto(fotos, voz) {
  const boas = fotos.filter((f) => f.medida);
  const status = document.getElementById('foto-status');
  if (!boas.length) {
    status.textContent = 'Nenhuma foto deu para medir ainda. Veja o motivo embaixo de cada foto e tire outra.';
    return;
  }
  const j = juntaFotos(boas.map((f) => f.medida));
  status.textContent = boas.length < 2
    ? 'Deu para medir! Se puder, envie mais 1 ou 2 fotos para conferir.'
    : `Deu para medir com ${boas.length} fotos.`;
  const avisos = [];
  if (boas.length === 1) avisos.push('Medido com 1 foto só. Com 2 ou 3 fotos a medida fica mais garantida.');
  if (j.margem != null && j.margem > 1) avisos.push(`As fotos deram valores diferentes (±${n1(j.margem)} mm). Tire mais uma foto com calma, olhando para a lente.`);
  const tecnico = boas.map((f, i) => `<div>Foto ${i + 1}: DP ${n1(f.medida.dp)} mm · OD ${n1(f.medida.direito)} · OE ${n1(f.medida.esquerdo)} · ~${Math.round(f.medida.distanciaCm)} cm · cartão ${Math.round(f.medida.larguraCartaoPx)} px · lente ${f.lente}</div>`).join('');
  mostraResultado({ dp: j.dp, esquerdo: j.esquerdo, direito: j.direito, margem: j.margem, aviso: avisos.join(' '), tecnico },
    { onRefazer: () => { document.getElementById('resCard')?.remove(); document.body.classList.remove('res-aberto'); } });
  voz?.sayResult(j.dp, `Pronto! Sua D P deu ${n1(j.dp)} milímetros.`);
}

// abre a foto já na orientação certa (o navegador aplica a rotação do EXIF ao desenhar)
async function abreFoto(arq) {
  const url = URL.createObjectURL(arq);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function analisaFoto(arq, { landmarker, opt }) {
  const exif = lerExif(await arq.arrayBuffer());
  const canvas = await abreFoto(arq);
  const ladoMaior = Math.max(canvas.width, canvas.height);
  const ladoMenor = Math.min(canvas.width, canvas.height);
  const hfovExif = hfovFromF35(exif?.f35, ladoMaior, ladoMenor);
  const hfov = hfovExif || HFOV_CELULAR;
  const lente = hfovExif ? `lida da foto (${exif.f35} mm)` : 'estimada (a foto não trouxe a informação)';

  const face = detectFace(landmarker, canvas);
  if (!face) return { motivo: 'Não encontrei o rosto. A foto precisa mostrar o rosto inteiro, de frente.', miniatura: miniatura(canvas) };

  const corners = achaCartao(canvas, face);
  if (!corners) {
    return {
      motivo: window.__dnpCoberto
        ? 'O cartão aparece, mas a mão cobre a lateral dele. Segure só com um dedo no meio da borda de cima.'
        : 'Não achei o cartão. Ele precisa estar deitado na testa, com as 4 bordas aparecendo (dedo só no meio da borda de cima).',
      miniatura: miniatura(canvas, face),
    };
  }

  const m = medidaDaFoto({ face, corners, ladoMaior, hfovDeg: hfov, opt });
  const pose = checkPose({
    eyeOpen: face.eyeOpen, gaze: face.gaze, lookDown: face.lookDown,
    leftEye: face.leftEye, rightEye: face.rightEye, noseCenter: face.noseCenter,
    cardSkew: m.skew, cardRollDeg: m.rollDeg,
    // sem checar "rosto no centro": quem fotografa pode não centralizar, e isso não muda a medida
  });
  const mini = miniatura(canvas, face, corners);
  if (!pose.ok) return { motivo: pose.message, miniatura: mini };
  if (m.larguraCartaoPx < 90) return { motivo: 'O cartão ficou pequeno demais na foto. Tire mais de perto ou use um pouco de zoom.', miniatura: mini };
  if (m.distanciaCm < 25) return { motivo: 'A foto foi tirada perto demais. Afaste o celular (o ideal é outra pessoa tirar a ~1 metro).', miniatura: mini };
  return { medida: m, lente, miniatura: mini };
}

// Foto é uma imagem só: tenta achar o cartão em 3 tamanhos (100%, 60%, 40%). Os limites do detector
// foram ajustados com vídeo (~2 MP); numa foto de 12 MP a textura da pele/cabelo gera bordas demais.
const ESCALAS = [1, 0.6, 0.4];
function achaCartao(canvas, face) {
  let coberto = false;
  for (const k of ESCALAS) {
    let c = canvas;
    let f = face;
    if (k !== 1) {
      c = document.createElement('canvas');
      c.width = Math.round(canvas.width * k);
      c.height = Math.round(canvas.height * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, c.width, c.height);
      const s = (p) => ({ x: p.x * k, y: p.y * k });
      f = { ...face, leftEye: s(face.leftEye), rightEye: s(face.rightEye), noseCenter: s(face.noseCenter) };
    }
    const q = findCard(c, f, detectCardByLines);
    coberto = coberto || !!window.__dnpCoberto;
    if (q) {
      window.__dnpCoberto = false;
      const s = (p) => ({ x: p.x / k, y: p.y / k });
      return { topLeft: s(q.topLeft), topRight: s(q.topRight), bottomRight: s(q.bottomRight), bottomLeft: s(q.bottomLeft), deduzido: q.deduzido };
    }
  }
  window.__dnpCoberto = coberto;
  return null;
}

// miniatura com o que foi achado (pupilas em azul, cartão em verde), para a pessoa conferir
function miniatura(canvas, face, corners) {
  const k = 360 / Math.max(canvas.width, canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const g = c.getContext('2d');
  g.drawImage(canvas, 0, 0, c.width, c.height);
  g.lineWidth = 2;
  if (corners) {
    g.strokeStyle = '#16a34a';
    g.beginPath();
    [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].forEach((p, i) => (i ? g.lineTo(p.x * k, p.y * k) : g.moveTo(p.x * k, p.y * k)));
    g.closePath();
    g.stroke();
  }
  if (face) {
    g.fillStyle = '#2563eb';
    for (const p of [face.leftEye, face.rightEye]) { g.beginPath(); g.arc(p.x * k, p.y * k, 3, 0, Math.PI * 2); g.fill(); }
  }
  return c.toDataURL('image/jpeg', 0.8);
}
