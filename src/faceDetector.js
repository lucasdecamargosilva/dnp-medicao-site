import {
  FaceLandmarker,
  FilesetResolver,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

// "Esquerda"/"direita" abaixo são sempre do ponto de vista do SUJEITO
// (paciente), não de quem olha a imagem/câmera. Validação manual (Task 11)
// deve confirmar cobrindo um olho de cada vez.
const LEFT_PUPIL = 473;   // centro da íris ESQUERDA do sujeito (FACEMESH_LEFT_IRIS)
const RIGHT_PUPIL = 468;  // centro da íris DIREITA do sujeito (FACEMESH_RIGHT_IRIS)
const NOSE_BRIDGE = 168;
// contorno da íris (4 pontos cada): direita do sujeito 469–472, esquerda 474–477 (13/10/2026)
const RIGHT_IRIS = [469, 470, 471, 472];
const LEFT_IRIS = [474, 475, 476, 477];
// pálpebras (cima, baixo, canto, canto) para detectar olho fechado/piscando
// (Fittingbox: "Keep your eyes wide open" — pesquisa §2.1 [REA])
const RIGHT_LIDS = [159, 145, 33, 133];
const LEFT_LIDS = [386, 374, 362, 263];

const WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const STAGE_TIMEOUT_MS = 60000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} demorou mais de ${ms / 1000}s`)), ms)
    ),
  ]);
}

function buildLandmarker(fileset, delegate) {
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,   // traz eyeLookDown/Up/In/Out: para onde a pessoa está olhando (14/10)
  });
}

// onProgress(msg) é opcional: recebe o texto da etapa atual para mostrar na tela.
export async function createFaceDetector(onProgress = () => {}) {
  onProgress('Baixando o motor do detector (WASM ~9MB)…');
  const fileset = await withTimeout(
    FilesetResolver.forVisionTasks(WASM_PATH),
    STAGE_TIMEOUT_MS,
    'Download do motor do detector'
  );

  // CPU por padrão (13/10): a inicialização em GPU TRAVA a página inteira em alguns navegadores/Macs
  // (thread principal bloqueada → nem o timeout dispara). GPU só sob pedido: ?gpu=1
  const wantGpu = new URLSearchParams(location.search).get('gpu') === '1';
  if (wantGpu) {
    try {
      onProgress('Carregando modelo do rosto (GPU)…');
      return await withTimeout(buildLandmarker(fileset, 'GPU'), STAGE_TIMEOUT_MS, 'Modelo (GPU)');
    } catch (gpuErr) {
      console.warn('Detector em GPU falhou, tentando CPU:', gpuErr);
    }
  }
  onProgress('Carregando modelo do rosto…');
  return await withTimeout(buildLandmarker(fileset, 'CPU'), STAGE_TIMEOUT_MS, 'Modelo do rosto');
}

export function detectFace(landmarker, videoEl) {
  const result = landmarker.detectForVideo(videoEl, performance.now());
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;

  const lm = result.faceLandmarks[0];
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const toPx = (p) => ({ x: p.x * w, y: p.y * h });

  // diâmetro da íris em px: média dos dois eixos (horizontal 0–2, vertical 1–3) dos dois olhos
  const irisDiam = (ids) => {
    const p = ids.map((i) => toPx(lm[i]));
    return (Math.hypot(p[0].x - p[2].x, p[0].y - p[2].y) + Math.hypot(p[1].x - p[3].x, p[1].y - p[3].y)) / 2;
  };
  const irisPx = lm.length > 477 ? (irisDiam(LEFT_IRIS) + irisDiam(RIGHT_IRIS)) / 2 : null;

  // abertura = altura/largura do olho; aberto ~0,25–0,35, piscando < 0,12
  const openness = ([up, down, c1, c2]) => {
    const [a, b, c, d] = [up, down, c1, c2].map((i) => toPx(lm[i]));
    return Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.hypot(c.x - d.x, c.y - d.y));
  };
  const eyeOpen = Math.min(openness(LEFT_LIDS), openness(RIGHT_LIDS));

  // para onde está olhando (horizontal): posição da íris entre o canto de FORA e o de DENTRO de cada olho
  // (0 = canto de fora, 1 = canto de dentro). Olhando para um lado, as duas íris andam na mesma direção,
  // então um olho vai para dentro e o outro para fora: |tD − tE|/2 ≈ quanto desviou (≈0 olhando a câmera,
  // e não depende do formato do olho nem da convergência, que move os dois para dentro).
  const along = (iris, fora, dentro) => {
    const [p, a, b] = [iris, fora, dentro].map((i) => toPx(lm[i]));
    const vx = b.x - a.x, vy = b.y - a.y;
    return ((p.x - a.x) * vx + (p.y - a.y) * vy) / Math.max(1, vx * vx + vy * vy);
  };
  const gaze = lm.length > 473 ? Math.abs(along(RIGHT_PUPIL, 33, 133) - along(LEFT_PUPIL, 263, 362)) / 2 : 0;

  // olhar para BAIXO (ex.: olhando a tela em vez da câmera, que fica em cima): blendshapes do MediaPipe, 0–1
  const bs = {};
  (result.faceBlendshapes?.[0]?.categories || []).forEach((c) => { bs[c.categoryName] = c.score; });
  const lookDown = bs.eyeLookDownLeft != null ? (bs.eyeLookDownLeft + bs.eyeLookDownRight) / 2 : null;

  return {
    eyeOpen,
    gaze,
    lookDown,
    leftEye: toPx(lm[LEFT_PUPIL]),
    rightEye: toPx(lm[RIGHT_PUPIL]),
    noseCenter: toPx(lm[NOSE_BRIDGE]),
    irisPx,
  };
}
