import { useEffect, useState, useCallback } from "react";
import { sb, isDemo, enterDemo, exitDemo } from "../lib/supabase";

/** Sessão + login (Google) + acesso teste (demo) + logout. */
export function useAuth() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [erro, setErro] = useState("");
  // modo demo ("Acesso teste"): base fake, sem tocar o Supabase real
  const [demo, setDemo] = useState(isDemo());

  useEffect(() => {
    // em modo demo a sessão é local: assume logado sem consultar o Supabase
    if (isDemo()) { setLogado(true); return; }
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setLogado(!!s));
    sb.auth.getSession().then(({ data }) => setLogado(!!data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const entrarGoogle = useCallback(async () => {
    setErro("");
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) setErro("Falha no login Google: " + error.message);
  }, []);

  // entra no modo demonstração: liga a base fake e marca como logado
  const entrarTeste = useCallback(() => {
    setErro("");
    enterDemo();
    setDemo(true);
    setLogado(true);
  }, []);

  const sair = useCallback(async () => {
    if (isDemo()) {
      exitDemo();
      setDemo(false);
      setLogado(false);
      return;
    }
    await sb.auth.signOut();
  }, []);

  return { logado, erro, demo, entrarGoogle, entrarTeste, sair };
}
