// src/optics.js — correções ópticas da medição (13/10/2026)
//
// A escala do cartão (mm/px) vale no PLANO DO CARTÃO (testa). As pupilas ficam alguns mm
// atrás desse plano, então aparecem menores na foto: sem corrigir, a DNP sai pequena.
// Além disso, olhando para a câmera a ~40 cm os olhos convergem (giram para dentro), e a
// DNP medida é a "de perto"; a lente usa a DNP "de longe". As duas correções estão aqui,
// com os parâmetros expostos para calibrar contra uma medida de referência.

export const OPTICS_DEFAULTS = {
  hfovDeg: 64,            // campo de visão horizontal da webcam (estimado; webcams ficam ~60–70°)
  cardToPupilMm: 12,      // quanto o plano das pupilas fica atrás do cartão encostado na testa
  rotationCenterMm: 11,   // centro de rotação do olho atrás do PLANO DA PUPILA (~13,5 a partir da córnea; pesquisa 13/10)
  irisDiameterMm: 11.7,   // diâmetro médio da íris visível (HVID), só para conferência
};

// distância focal em pixels a partir do campo de visão horizontal
export function focalPx(imageWidthPx, hfovDeg) {
  return (imageWidthPx / 2) / Math.tan((hfovDeg * Math.PI) / 180 / 2);
}

// distância câmera→cartão (mm): d = f * (mm/px no plano do cartão)
export function cameraToCardMm(mmPerPixelCard, imageWidthPx, hfovDeg) {
  return focalPx(imageWidthPx, hfovDeg) * mmPerPixelCard;
}

// escala no plano das pupilas: o objeto mais longe tem mais mm por pixel (proporção das distâncias)
export function scaleAtPupils(mmPerPixelCard, cameraToCard, cardToPupilMm) {
  return mmPerPixelCard * (cameraToCard + cardToPupilMm) / cameraToCard;
}

// DNP de longe a partir da DNP de perto (monocular), olhando um alvo na linha média a D mm do plano das pupilas.
// Cada olho gira em torno de um centro r mm atrás da pupila; a pupila desloca r·sen(θ) para dentro,
// com tan(θ) = mono_far / (D + r). Resolve por iteração (converge em 3–4 passos).
export function distanceMonoFromNear(monoNearMm, eyeToTargetMm, rotationCenterMm) {
  let far = monoNearMm;
  for (let i = 0; i < 6; i++) {
    const theta = Math.atan(far / (eyeToTargetMm + rotationCenterMm));
    far = monoNearMm + rotationCenterMm * Math.sin(theta);
  }
  return far;
}

// escala alternativa pela íris (só para conferir se o cartão foi bem detectado)
export function scaleFromIris(irisDiameterPx, irisDiameterMm) {
  return irisDiameterPx > 0 ? irisDiameterMm / irisDiameterPx : null;
}
