// Loopback-only pilot. This fixed disposable database is never the linked Supabase project.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(root, '../../..');
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:pfmea-local-fixture@127.0.0.1:58522/pfmea_cell_test' });
const actors = { alice: 'a7300000-0000-0000-0000-000000000001', bob: 'a7300000-0000-0000-0000-000000000002' };
const api = { name: 'isolated-pfmea-database', configureServer(server) {
  server.middlewares.use('/fixture', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const actor = actors[url.searchParams.get('editor')] ?? actors.alice;
    let body = ''; for await (const chunk of req) body += chunk;
    const args = body ? JSON.parse(body) : undefined;
    const client = await pool.connect();
    try {
      if (url.pathname === '/setup') {
        await client.query('insert into products(id,project_id,custom_fields) values($1,$2,$3) on conflict(id) do nothing', ['browser-product-v2', 'fixture-project', { productPfmeaDocument: args }]);
      }
      await client.query('begin');
      await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      let data;
      if (url.pathname === '/patch') {
        if (args.p_product_id !== 'browser-product-v2' || args.p_project_id !== 'fixture-project') throw new Error('Fixture scope required');
        data = (await client.query('select patch_pfmea_cells($1,$2,$3,$4,$5) as document', [args.p_product_id,args.p_project_id,args.p_document_id,args.p_mutation_id,JSON.stringify(args.p_changes)])).rows[0].document;
      } else data = (await client.query("select custom_fields->'productPfmeaDocument' as document from products where id='browser-product-v2' and project_id='fixture-project'")).rows[0]?.document;
      await client.query('commit');
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data, error: null }));
    } catch(error) {
      await client.query('rollback');
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: null, error: { message: error.message, code: error.code, details: error.detail } }));
    } finally { client.release(); }
  });
} };
const server = await createServer({ configFile: false, root, plugins: [{ name: 'fixture-client-only', enforce: 'pre', resolveId(source, importer) { if (source === './client' && importer?.includes('/src/lib/planner/')) return path.join(root, 'client.ts'); } },react(),api], resolve: { alias: [
 { find: '@/lib/planner/client', replacement: path.join(root,'client.ts') },
 { find: 'next/image', replacement: path.join(root,'image.tsx') },
 { find: '@', replacement: path.join(repo,'src') },
 { find: 'react-dom', replacement: path.join(repo,'node_modules/react-dom') },
 { find: 'react', replacement: path.join(repo,'node_modules/react') },
]}, define: { 'process.env': '{}' }, server: { host:'127.0.0.1',port:3005,strictPort:true,fs:{allow:[repo]} } });
await server.listen();
console.log('Isolated PFMEA pilot ready at http://127.0.0.1:3005');
