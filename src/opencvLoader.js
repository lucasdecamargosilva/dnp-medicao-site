// src/opencvLoader.js — carrega o OpenCV.js sob demanda (usado pela medição ao vivo e pelo modo foto)
//
// OpenCV é carregado SÓ DEPOIS do detector de rosto (13/10): o opencv.js cria um objeto global
// `Module` e, se ele já existir quando o MediaPipe inicializa, o MediaPipe trava a página inteira.
let carregando = null;

// 18/11: limite de 15 s era curto no celular — o arquivo chega compactado (~4 MB) mas o aparelho ainda
// precisa preparar ~10 MB de código (10–20 s num celular médio) → "OpenCV não carregou". Agora 90 s,
// e se falhar a próxima chamada tenta de novo do zero (antes a falha ficava presa até recarregar).
const TIMEOUT_MS = 90000;
let inicio = 0;
export const segundosOpenCv = () => (inicio ? Math.round((Date.now() - inicio) / 1000) : 0);

export function loadOpenCv() {
  if (window.cv && window.cv.Mat) return Promise.resolve();
  if (carregando) return carregando;
  inicio = Date.now();
  carregando = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/opencv.js';
    const falha = (msg) => {
      script.remove();
      carregando = null;
      reject(new Error(msg));
    };
    script.onerror = () => falha('Não consegui baixar o leitor do cartão. Verifique a internet e toque em tentar de novo.');
    document.head.appendChild(script);
    const check = () => {
      if (window.cv && window.cv.Mat) resolve();
      else if (Date.now() - inicio >= TIMEOUT_MS) falha('O leitor do cartão demorou demais para abrir. Verifique a internet e tente de novo.');
      else setTimeout(check, 100);
    };
    check();
  });
  return carregando;
}
