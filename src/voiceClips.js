// src/voiceClips.js — falas pré-gravadas com voz neural (GPT "echo", mesma do agente de voz do Lucas)
//
// A voz do navegador é robótica; como as instruções são um conjunto fixo, geramos um áudio para cada
// uma (tools/gerar-audios.mjs → audio/<id>.mp3) e a página só toca o arquivo. "tela" = texto exato
// mostrado na página; "fala" = o que a voz diz (pode ser mais curto/natural). Texto sem áudio aqui
// cai na voz do navegador.

export const CLIPS = [
  { id: 'centralize', tela: 'Centralize o rosto na câmera.', fala: 'Centralize o rosto na câmera.' },
  { id: 'sem-cartao', tela: 'Não achei o cartão. Segure-o pela borda de CIMA, deixando as laterais (esquerda e direita) livres.', fala: 'Não achei o cartão. Segure ele pela borda de cima, deixando os lados livres.' },
  { id: 'olhos', tela: 'Abra bem os olhos e olhe para a câmera.', fala: 'Abra bem os olhos e olhe para a câmera.' },
  { id: 'afaste-pouco', tela: 'Afaste um pouco o rosto da câmera (uns 50 cm).', fala: 'Afaste um pouco o rosto da câmera.' },
  { id: 'chegue-perto', tela: 'Chegue um pouco mais perto da câmera (uns 50 cm).', fala: 'Chegue um pouco mais perto da câmera.' },
  { id: 'parado', tela: 'Isso! Fique parado olhando para a câmera…', fala: 'Isso! Agora fique parado, olhando para a câmera.' },
  { id: 'cartao-reto', tela: 'Deixe o cartão reto (na horizontal).', fala: 'Deixe o cartão reto, na horizontal.' },
  { id: 'cartao-plano', tela: 'Não incline o cartão; deixe-o plano na testa.', fala: 'Encoste o cartão retinho na testa.' },
  { id: 'cabeca-reta', tela: 'Endireite a cabeça (não incline).', fala: 'Endireite a cabeça.' },
  { id: 'olhe-reto', tela: 'Olhe reto para a frente (não vire o rosto).', fala: 'Olhe reto para a frente, sem virar o rosto.' },
  { id: 'de-frente', tela: 'Fique bem de frente para a câmera (rosto no centro da imagem).', fala: 'Fique bem de frente para a câmera.' },
  { id: 'olhe-camera', tela: 'Olhe fixo para a câmera, na lentinha.', fala: 'Olhe fixo para a câmera, na lentinha.' },
  { id: 'medindo', tela: 'Medindo… não se mexa.', fala: 'Medindo. Não se mexa.' },
  { id: 'mexeu', tela: 'Você se mexeu. Vamos de novo: fique parado.', fala: 'Você se mexeu. Vamos de novo, fique parado.' },
  { id: 'mal-detectado', tela: 'Rosto muito próximo ou mal detectado.', fala: 'Não estou vendo bem o seu rosto.' },
  // modo afastar (opcional, ?modo=afastar)
  { id: 'aproxime-40', tela: 'Aproxime o rosto da câmera (uns 40 cm), com o cartão na testa.', fala: 'Aproxime o rosto da câmera, com o cartão na testa.' },
  { id: 'afaste-devagar', tela: 'Agora afaste-se DEVAGAR, olhando para a câmera…', fala: 'Agora se afaste devagar, olhando para a câmera.' },
  { id: 'longe-demais', tela: 'Longe demais. Volte para perto e afaste de novo, mais devagar.', fala: 'Longe demais. Volte para perto e se afaste de novo, mais devagar.' },
  { id: 'quase-la', tela: 'Quase lá. Aproxime de novo e afaste ainda mais devagar.', fala: 'Quase lá. Aproxime de novo e se afaste ainda mais devagar.' },
];

// resultado "Pronto! Sua DP deu 63 vírgula 4 milímetros." montado com pedaços
export const RESULT_CLIPS = [
  { id: 'pronto-dp', fala: 'Pronto! Sua D P deu' },
  ...Array.from({ length: 31 }, (_, i) => ({ id: `n${50 + i}`, fala: String(50 + i) })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `v${i}`, fala: `vírgula ${i} milímetros.` })),
];

const porTela = new Map(CLIPS.map((c) => [c.tela, c.id]));
export const clipForText = (texto) => porTela.get(texto) || null;

// sequência de clipes para uma DP (50,0–80,9 mm); null se fora da faixa
export function resultClips(dp) {
  const r = Math.round(dp * 10) / 10;
  const inteiro = Math.floor(r);
  const dec = Math.round((r - inteiro) * 10);
  if (inteiro < 50 || inteiro > 80) return null;
  return ['pronto-dp', `n${inteiro}`, `v${dec}`];
}
