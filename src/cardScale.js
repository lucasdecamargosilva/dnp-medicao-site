import { distance } from './geometry.js';

export const CARD_MM = { width: 85.6, height: 53.98 };
const RATIO = CARD_MM.width / CARD_MM.height;

// Escala SÓ pela largura (13/10/2026): a altura do cartão encolhe quando ele inclina na testa
// (fica deitado sobre a curvatura), e a média largura+altura enviesava a escala. A altura agora
// serve só para medir essa inclinação (skew = 1 − cos(inclinação) aproximado pela razão).
export function cardScale(corners) {
  const widthPx = (distance(corners.topLeft, corners.topRight) + distance(corners.bottomLeft, corners.bottomRight)) / 2;
  const heightPx = (distance(corners.topLeft, corners.bottomLeft) + distance(corners.topRight, corners.bottomRight)) / 2;
  const mmPerPixel = CARD_MM.width / widthPx;
  const ratio = widthPx / heightPx;                 // cartão de frente = 1,586
  const skew = Math.abs(ratio - RATIO) / RATIO;     // 0 = de frente; ~0,015 ≈ 10° de inclinação
  const rollDeg = Math.abs(Math.atan2(corners.topRight.y - corners.topLeft.y, corners.topRight.x - corners.topLeft.x) * 180 / Math.PI);
  return { mmPerPixel, skew, rollDeg };
}
