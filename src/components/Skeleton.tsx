/* ---------- skeletons de carregamento ----------
   Mostrados enquanto a primeira carga de lançamentos acontece, no lugar do
   "Carregando…" cru. Mantêm o layout estável (sem salto) e dão sensação de
   resposta imediata. */

export function Sk({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[8px] ${className}`} />;
}

function SkKpi() {
  return (
    <div className="bg-card border border-line rounded-[18px] p-4 sm:p-[18px] shadow-card">
      <Sk className="h-[12px] w-[60%]" />
      <Sk className="h-[24px] w-[80%] mt-[10px]" />
      <Sk className="h-[11px] w-[45%] mt-[8px]" />
    </div>
  );
}

function SkPanel({ h = "h-[150px]" }: { h?: string }) {
  return (
    <div className="bg-card border border-line rounded-[18px] p-4 sm:p-5 shadow-card">
      <Sk className="h-[15px] w-[40%]" />
      <Sk className={`w-full mt-4 ${h}`} />
    </div>
  );
}

/* Skeleton da tela inicial (hero + pendências + dois painéis). */
export function SkInicio() {
  return (
    <div className="fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[18px]">
        <div className="lg:col-span-2"><SkPanel h="h-[180px]" /></div>
        <SkPanel h="h-[180px]" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[18px] mt-[18px]">
        <SkPanel h="h-[160px]" />
        <SkPanel h="h-[160px]" />
      </div>
    </div>
  );
}

/* Skeleton genérico de aba com KPIs + tabela. */
export function SkTabela() {
  return (
    <div className="fade-in">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[14px] mb-[18px]">
        {Array.from({ length: 4 }).map((_, i) => <SkKpi key={i} />)}
      </div>
      <SkPanel h="h-[320px]" />
    </div>
  );
}
