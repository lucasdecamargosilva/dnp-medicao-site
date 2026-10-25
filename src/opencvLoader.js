// src/opencvLoader.js — carrega o OpenCV.js sob demanda (usado pela medição ao vivo e pelo modo foto)
//
// OpenCV é carregado SÓ DEPOIS do detector de rosto (13/10): o opencv.js cria um objeto global
// `Module` e, se ele já existir quando o MediaPipe inicializa, o MediaPipe trava a página inteira.
let carregando = null;

export function loadOpenCv() {
  if (window.cv && window.cv.Mat) return Promise.resolve();
  if (carregando) return carregando;
  const TIMEOUT_MS = 15000;
  carregando = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/opencv.js';
    script.onerror = () => reject(new Error('OpenCV não carregou. Verifique a conexão e recarregue a página.'));
    document.head.appendChild(script);
    const start = Date.now();
    const check = () => {
      if (window.cv && window.cv.Mat) resolve();
      else if (Date.now() - start >= TIMEOUT_MS) {
        reject(new Error('OpenCV não carregou. Verifique a conexão e recarregue a página.'));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
  return carregando;
}
