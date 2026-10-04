import type { SupabaseClient, Session } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const listeners = new Set<(event: string, session: Session | null) => void>();
export const mobileAuth = {
  userId: "user-test" as string | null,
  change(userId: string | null) {
    this.userId = userId;
    for (const listener of listeners) listener(userId ? "SIGNED_IN" : "SIGNED_OUT", userId ? { user: { id: userId } } as Session : null);
  },
  client: {
    auth: {
      async getSession() { return { data: { session: mobileAuth.userId ? { user: { id: mobileAuth.userId } } : null }, error: null }; },
      onAuthStateChange(callback: (event: string, session: Session | null) => void) {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
      },
    },
  } as unknown as SupabaseClient<Database>,
};
