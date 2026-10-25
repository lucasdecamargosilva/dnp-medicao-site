// src/photoMeasure.js — medida de UMA foto (24/10): mesma conta da medição ao vivo (app.js), mas com o
// campo de visão vindo da própria foto (EXIF) quando existir. Pura: recebe o que os detectores acharam.
import { cardScale } from './cardScale.js';
import { computeDnp } from './dnpCalculator.js';
import { cameraToCardMm, scaleAtPupils, distanceMonoFromNear } from './optics.js';

// face: { leftEye, rightEye, noseCenter } · corners: cantos do cartão · ladoMaior: px do lado maior da foto
// opt: { cardToPupilMm, rotationCenterMm }
export function medidaDaFoto({ face, corners, ladoMaior, hfovDeg, opt }) {
  const { mmPerPixel, skew, rollDeg } = cardScale(corners);
  const dCard = cameraToCardMm(mmPerPixel, ladoMaior, hfovDeg);          // câmera → cartão (mm)
  const mmPupila = scaleAtPupils(mmPerPixel, dCard, opt.cardToPupilMm);  // escala no plano das pupilas
  const perto = computeDnp({ ...face, mmPerPixel: mmPupila });
  const D = dCard + opt.cardToPupilMm;                                   // câmera → pupilas
  const esquerdo = distanceMonoFromNear(perto.left, D, opt.rotationCenterMm);
  const direito = distanceMonoFromNear(perto.right, D, opt.rotationCenterMm);
  return { dp: esquerdo + direito, esquerdo, direito, distanciaCm: D / 10, larguraCartaoPx: 85.6 / mmPerPixel, skew, rollDeg };
}

// junta as fotos boas: mediana e quanto elas discordam entre si
export function juntaFotos(medidas) {
  const ok = medidas.filter(Boolean);
  if (!ok.length) return null;
  const med = (k) => {
    const a = ok.map((m) => m[k]).sort((p, q) => p - q);
    const i = a.length >> 1;
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  };
  const dps = ok.map((m) => m.dp);
  return {
    dp: med('dp'), esquerdo: med('esquerdo'), direito: med('direito'), n: ok.length,
    margem: ok.length > 1 ? (Math.max(...dps) - Math.min(...dps)) / 2 : null,
  };
}
