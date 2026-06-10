import { useEffect, useState, useCallback } from "react";
import { sb } from "../lib/supabase";

/** Sessão + login (Google / e-mail) + logout. */
export function useAuth() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
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

  const entrarEmail = useCallback(async (email: string, senha: string) => {
    setErro("");
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) setErro("Falha no login: " + error.message);
  }, []);

  const sair = useCallback(async () => { await sb.auth.signOut(); }, []);

  return { logado, erro, entrarGoogle, entrarEmail, sair };
}
