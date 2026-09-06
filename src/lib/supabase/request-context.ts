import { cache } from "react";
import { createSupabaseServerClient } from "./server";

/** Request-scoped only: cookie authentication is never cached across users. */
export const getServerAuthContext = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return { supabase, user: data.user };
});
