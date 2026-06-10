import { createClient } from "@supabase/supabase-js";

// A publishable key pode ficar no front: o RLS exige login para ler/editar.
export const SUPABASE_URL = "https://qjotxjunuurfezqgtugr.supabase.co";
export const SUPABASE_ANON = "sb_publishable_uAYhGJThgMK4S2NV0B32wA_-m9huQH8";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
