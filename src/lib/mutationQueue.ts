// ---------------------------------------------------------------------------
// Fila de escritas no banco (background).
//
// Objetivo: o clique numa ação (aplicar categoria, confirmar receita, editar
// um lançamento…) NÃO deve travar o produto esperando o round-trip do banco.
// A UI atualiza na hora (otimista) e a persistência entra nesta fila, que
// processa em SÉRIE, uma escrita por vez.
//
// Por que série (concorrência 1)?
//  · ordem preservada: "aplicar X" seguido de "desfazer X" no mesmo alvo grava
//    na ordem em que o usuário clicou — sem corrida entre requests paralelos;
//  · pressão previsível no Supabase: nunca dispara N escritas simultâneas.
//
// A fila é um singleton de módulo (uma só por app). Componentes só empurram
// jobs e, se quiserem, observam `pendentes` para mostrar um "salvando…".
// ---------------------------------------------------------------------------

type Job = () => Promise<void>;

interface Entry {
  job: Job;
  resolve: () => void;
  reject: (e: unknown) => void;
}

const fila: Entry[] = [];
let rodando = false;
let pendentes = 0;
const listeners = new Set<() => void>();

function notificar() {
  listeners.forEach((l) => {
    try { l(); } catch { /* um listener quebrado não pode derrubar a fila */ }
  });
}

async function processar() {
  if (rodando) return;
  rodando = true;
  while (fila.length) {
    const e = fila.shift()!;
    try {
      await e.job();
      e.resolve();
    } catch (err) {
      // o erro é entregue a quem enfileirou (p/ rollback otimista); a fila
      // segue viva e processa os próximos jobs normalmente.
      e.reject(err);
    } finally {
      pendentes = Math.max(0, pendentes - 1);
      notificar();
    }
  }
  rodando = false;
}

/**
 * Enfileira uma escrita. Resolve quando o job completa; rejeita (sem derrubar a
 * fila) se ele falhar — deixando o chamador reverter o estado otimista.
 */
export function enfileirar(job: Job): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fila.push({ job, resolve, reject });
    pendentes += 1;
    notificar();
    // dispara o processamento no próximo tick (não bloqueia o chamador)
    void processar();
  });
}

/** Quantidade de escritas ainda não concluídas (na fila + a que roda agora). */
export function pendentesFila(): number {
  return pendentes;
}

/** Observa mudanças no número de pendências (para indicadores de "salvando…"). */
export function assinarFila(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
