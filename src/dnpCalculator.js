// src/dnpCalculator.js
import { distance, projectOntoLine } from './geometry.js';

export function computeDnp({ leftEye, rightEye, noseCenter, mmPerPixel }) {
  // projeta o centro do nariz na linha que liga os dois olhos
  const noseOnEyeLine = projectOntoLine(noseCenter, leftEye, rightEye);

  const leftPx = distance(leftEye, noseOnEyeLine);
  const rightPx = distance(rightEye, noseOnEyeLine);

  const left = leftPx * mmPerPixel;
  const right = rightPx * mmPerPixel;

  return { left, right, total: left + right };
}
