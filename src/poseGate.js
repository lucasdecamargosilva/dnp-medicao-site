import { distance } from './geometry.js';

const MAX_ROLL_RATIO = 0.1;   // |dy| / distância entre olhos
const MAX_YAW_RATIO = 0.15;   // assimetria esq/dir vs nariz
const MAX_CARD_SKEW = 0.15;   // cartão deitado para trás na testa encurta a ALTURA; a escala usa só a LARGURA,
                              // então dá para tolerar ~30° (0,02 recusava o cartão do Lucas apoiado na testa)
const MAX_CARD_ROLL_DEG = 6;  // cartão girado no plano. Fittingbox usa ±3°, mas aqui a largura é medida ao longo da
                              // própria borda (não muda com giro pequeno) e segurando com a mão 3° recusava demais
const MAX_LOOK_DOWN = 0.2;    // eyeLookDown do MediaPipe (0–1). Fotos do Lucas: olhando a câmera 0,04; olhando
                              // para baixo 0,34 e 0,67 (0,35 deixava passar a 1ª) — 14/10
const MAX_GAZE = 0.07;        // olhar desviado ~10° para o lado (fração da largura do olho)
const MIN_EYE_OPEN = 0.14;    // abaixo disso = piscando/olho semicerrado (pupila mal localizada)
const MAX_CENTER_OFFSET = 0.1; // meio dos olhos até o centro da imagem, em fração da largura:
                               // a correção de convergência supõe a câmera bem na frente

export function checkPose({ leftEye, rightEye, noseCenter, cardSkew, cardRollDeg = 0, eyeOpen = null, frameWidth = null, gaze = null, lookDown = null }) {
  const eyeSpan = distance(leftEye, rightEye);

  if (eyeSpan < 1) {
    return { ok: false, message: 'Rosto muito próximo ou mal detectado.' };
  }

  const rollRatio = Math.abs(leftEye.y - rightEye.y) / eyeSpan;
  if (rollRatio > MAX_ROLL_RATIO) {
    return { ok: false, message: 'Endireite a cabeça (não incline).' };
  }

  const leftHalf = Math.abs(noseCenter.x - leftEye.x);
  const rightHalf = Math.abs(rightEye.x - noseCenter.x);
  const yawRatio = Math.abs(leftHalf - rightHalf) / eyeSpan;
  if (yawRatio > MAX_YAW_RATIO) {
    return { ok: false, message: 'Olhe reto para a frente (não vire o rosto).' };
  }

  if (eyeOpen != null && eyeOpen < MIN_EYE_OPEN) {
    return { ok: false, message: 'Abra bem os olhos e olhe para a câmera.' };
  }

  if ((gaze != null && gaze > MAX_GAZE) || (lookDown != null && lookDown > MAX_LOOK_DOWN)) {
    return { ok: false, message: 'Olhe fixo para a câmera, na lentinha.' };
  }

  if (frameWidth) {
    const offset = Math.abs((leftEye.x + rightEye.x) / 2 - frameWidth / 2) / frameWidth;
    if (offset > MAX_CENTER_OFFSET) {
      return { ok: false, message: 'Fique bem de frente para a câmera (rosto no centro da imagem).' };
    }
  }

  if (cardRollDeg > MAX_CARD_ROLL_DEG && cardRollDeg < 180 - MAX_CARD_ROLL_DEG) {
    return { ok: false, message: 'Deixe o cartão reto (na horizontal).' };
  }

  if (cardSkew > MAX_CARD_SKEW) {
    return { ok: false, message: 'Não incline o cartão; deixe-o plano na testa.' };
  }

  return { ok: true, message: '' };
}
