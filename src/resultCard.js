// src/resultCard.js — tela de resultado (24/10/2026)
// Antes o resultado saía como texto solto embaixo da câmera, misturado com números técnicos, e no
// celular a pessoa nem via (ficava abaixo do vídeo). Agora abre um cartão por cima de tudo, com a DP
// grande, um desenho de onde fica cada DNP, botão de copiar e os detalhes técnicos recolhidos.

const n1 = (x) => Number(x).toFixed(1).replace('.', ',');

// dados: { dp, esquerdo, direito, margem?, aviso?, tecnico? (html) }
// esquerdo/direito = olho ESQUERDO/DIREITO do próprio cliente (OE/OD da receita)
export function mostraResultado(dados, { onRefazer } = {}) {
  document.getElementById('resCard')?.remove();
  const el = document.createElement('div');
  el.id = 'resCard';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Resultado da medição');
  const margem = Number.isFinite(dados.margem) && dados.margem > 0
    ? `<span class="res-margem">margem ±${n1(dados.margem)} mm</span>` : '';
  el.innerHTML = `
    <div class="res-box">
      <div class="res-ok">✓ Medição pronta</div>
      <div class="res-rot">Sua DP (distância pupilar)</div>
      <div class="res-num">${n1(dados.dp)}<small> mm</small></div>
      <div class="res-sub">Para longe — é este número que vai no pedido da lente.</div>
      ${margem}
      ${desenho(dados)}
      <div class="res-dnp">
        <div><span>Olho direito (OD)</span><b>${n1(dados.direito)} mm</b></div>
        <div><span>Olho esquerdo (OE)</span><b>${n1(dados.esquerdo)} mm</b></div>
      </div>
      <div class="res-exp">DNP é a distância de cada pupila até o meio do nariz. Somando as duas dá a DP.</div>
      ${dados.aviso ? `<div class="res-aviso">${dados.aviso}</div>` : ''}
      <div class="res-acoes">
        <button type="button" class="res-bt res-bt-pri" data-acao="copiar">Copiar medidas</button>
        <button type="button" class="res-bt" data-acao="refazer">Medir de novo</button>
      </div>
      ${dados.tecnico ? `<details class="res-tec"><summary>Detalhes técnicos</summary>${dados.tecnico}</details>` : ''}
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('res-aberto');

  const texto = `DP ${n1(dados.dp)} mm · DNP OD ${n1(dados.direito)} mm · DNP OE ${n1(dados.esquerdo)} mm`;
  const btCopiar = el.querySelector('[data-acao="copiar"]');
  btCopiar.onclick = async () => {
    try { await navigator.clipboard.writeText(texto); btCopiar.textContent = 'Copiado ✓'; }
    catch (e) { btCopiar.textContent = texto; }
    setTimeout(() => { btCopiar.textContent = 'Copiar medidas'; }, 2500);
  };
  el.querySelector('[data-acao="refazer"]').onclick = () => (onRefazer ? onRefazer() : location.reload());
  el.querySelector('.res-box').focus?.();
  return el;
}

// Rosto visto de frente: o olho DIREITO do cliente fica à ESQUERDA do desenho (como numa foto).
function desenho(d) {
  return `
    <svg class="res-svg" viewBox="0 0 320 150" aria-hidden="true">
      <path d="M40 150 C40 60 90 18 160 18 C230 18 280 60 280 150" class="res-rosto"/>
      <line x1="160" y1="40" x2="160" y2="140" class="res-nariz"/>
      <g class="res-olho"><ellipse cx="100" cy="80" rx="30" ry="15"/><circle cx="100" cy="80" r="8" class="res-pupila"/></g>
      <g class="res-olho"><ellipse cx="220" cy="80" rx="30" ry="15"/><circle cx="220" cy="80" r="8" class="res-pupila"/></g>
      <line x1="100" y1="44" x2="220" y2="44" class="res-seta res-seta-dp"/>
      <line x1="100" y1="38" x2="100" y2="66" class="res-guia"/><line x1="220" y1="38" x2="220" y2="66" class="res-guia"/>
      <text x="160" y="36" class="res-txt res-txt-dp">DP ${n1(d.dp)}</text>
      <line x1="100" y1="118" x2="160" y2="118" class="res-seta"/>
      <line x1="160" y1="118" x2="220" y2="118" class="res-seta"/>
      <line x1="100" y1="94" x2="100" y2="124" class="res-guia"/><line x1="220" y1="94" x2="220" y2="124" class="res-guia"/>
      <text x="122" y="140" class="res-txt">OD ${n1(d.direito)}</text>
      <text x="198" y="140" class="res-txt">OE ${n1(d.esquerdo)}</text>
    </svg>`;
}
