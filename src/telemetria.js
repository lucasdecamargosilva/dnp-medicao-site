// src/telemetria.js — resumo de cada medição (17/11): quanto tempo levou, se chegou ao resultado e em
// QUAL instrução a pessoa ficou presa. Motivo: "a galera fica um tempão ajustando e não lê" — sem isso
// não dá para saber qual verificação trava. NÃO envia foto, rosto nem nada que identifique a pessoa.
// Tabela public.dp_medicao_log (Supabase do Provou Levou): o público só consegue gravar, não ler.
const URL_LOG = 'https://quantic-supabase.k5jwra.easypanel.host/rest/v1/dp_medicao_log';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIiwKICAgICJpc3MiOiAic3VwYWJhc2UtZGVtbyIsCiAgICAiaWF0IjogMTY0MTc2OTIwMCwKICAgICJleHAiOiAxNzk5NTM1NjAwCn0.pCFnSnrlSUM2EwXi9gxAegpoC-9U0Mjx3iAtROR-E20';   // chave pública (a mesma do env.js)

let st = null;

export function inicia(modo) {
  st = { modo, t0: performance.now(), ult: null, msgAtual: null, travas: {}, quadros: 0, enviado: false };
}

// chamada a cada quadro com a instrução que está na tela
export function marca(msg) {
  if (!st) return;
  const agora = performance.now();
  if (st.ult != null && st.msgAtual) {
    const dt = (agora - st.ult) / 1000;
    if (dt < 2) st.travas[st.msgAtual] = (st.travas[st.msgAtual] || 0) + dt;   // pausa longa (aba escondida) não conta
  }
  st.ult = agora;
  st.msgAtual = String(msg || '').slice(0, 80);
  st.quadros += 1;
}

function origem() {
  try {
    if (window.top !== window && document.referrer) return new URL(document.referrer).hostname;
  } catch (e) { /* sem acesso */ }
  return location.search.includes('embed=1') ? 'embutido' : 'direto';
}

export function envia({ concluiu, fotos = null, dp = null } = {}) {
  if (!st || st.enviado) return;
  st.enviado = true;
  const dur = (performance.now() - st.t0) / 1000;
  if (!concluiu && dur < 3) return;   // abriu e fechou: não é medição
  const travas = {};
  for (const [k, v] of Object.entries(st.travas).sort((a, b) => b[1] - a[1]).slice(0, 12)) travas[k] = Math.round(v * 10) / 10;
  const corpo = {
    origem: origem(), modo: st.modo, celular: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
    duracao_s: Math.round(dur * 10) / 10, concluiu: !!concluiu, fps: Math.round((st.quadros / Math.max(dur, 0.1)) * 10) / 10,
    fotos, dp: Number.isFinite(dp) ? Math.round(dp * 10) / 10 : null, travas,
  };
  try {
    fetch(URL_LOG, { method: 'POST', keepalive: true, headers: { apikey: ANON, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(corpo) }).catch(() => {});
  } catch (e) { /* nunca atrapalha a medição */ }
}

// saiu da página sem terminar: manda o que tiver (com concluiu=false)
addEventListener('pagehide', () => envia({ concluiu: false }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') envia({ concluiu: false }); });
