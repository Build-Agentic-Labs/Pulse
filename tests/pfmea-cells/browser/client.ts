let dropNextResponse = false;
export function loseNextResponse() { dropNextResponse = true; }
const actor = new URLSearchParams(location.search).get('editor') === 'bob' ? 'bob' : 'alice';
async function request(path: string, body?: unknown) {
  const response = await fetch(`/fixture/${path}?editor=${actor}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return response.json();
}
export const load = () => request('read');
export const setup = (document: unknown) => request('setup', document);
export const plannerClient = () => ({
  rpc: async (_name: string, args: unknown) => { const result = await request('patch', args); if (dropNextResponse && !result.error) { dropNextResponse = false; throw new Error('Simulated lost response after server commit'); } return result; },
  from: () => { const query = { select: () => query, eq: () => query, maybeSingle: async () => { const result = await load(); return { data: result.data ? { custom_fields: { productPfmeaDocument: result.data } } : null, error: result.error }; } }; return query; },
  auth: { onAuthStateChange(callback: (event: string, session: unknown) => void) { queueMicrotask(() => callback('INITIAL_SESSION', { user: { id: actor } })); return { data: { subscription: { unsubscribe() {} } } }; } },
});
export const getUserFromSession = async () => ({ data: { user: { id: actor } } });
export const createPlannerSupabaseClient = plannerClient;
export const supabaseUrl = undefined;
