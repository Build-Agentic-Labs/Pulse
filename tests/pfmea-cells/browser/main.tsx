import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PfmeaWorkspace } from '@/components/line-workspace/pfmea-workspace';
import { usePfmeaSaveQueue } from '@/components/line-workspace/use-pfmea-save-queue';
import { WorkspaceWriteTracker } from '@/domain/workspace-save-status';
import { emptyPlannerState } from '@/domain/empty-planner-state';
import { createPfmeaDocumentFromProcedure, PRODUCT_PFMEA_DOCUMENT_FIELD as FIELD, type PfmeaDocument } from '@/domain/pfmea';
import type { Task } from '@/domain/types';
import { setup, loseNextResponse } from './client';
import '@/components/line-workspace.css';
const task = { id:'fixture-task', wbs:'1', name:'Isolated collaboration fixture', manufacturingCode:'TEST', scenarioId:emptyPlannerState.scenario.id, rowType:'task', customFields:{}, manufacturingSteps:Array.from({length:242},(_,i)=>({id:`step-${i}`,sequence:i+1,instruction:'Fixture instruction',name:`Fixture step ${i}`})) } as Task;
const product = { ...emptyPlannerState.product, id: 'browser-product-v2' };
const original = createPfmeaDocumentFromProcedure(product, emptyPlannerState.scenario, [task], []);
function Grid({ initial }: { initial: PfmeaDocument }) {
 const [saved,setSaved] = useState(initial);
 const [tracker] = useState(() => new WorkspaceWriteTracker('fixture-project'));
 const { queue, result, ready, localError, connection } = usePfmeaSaveQueue(product.id, 'fixture-project', tracker, setSaved, { remote: saved, enabled: true, active: true, cellSaving: true });
 return ready ? <><p>{result?.error}</p><PfmeaWorkspace product={{ ...product, customFields: { [FIELD]: queue.latest() ?? saved } }} scenario={emptyPlannerState.scenario} tasks={[task]} zones={[]} readOnly={connection.paused} connectionError={connection.paused ? connection.message : undefined} backupError={localError} saveResult={result} onRetrySave={() => void connection.reconnect()} onCellCommit={() => void queue.flush()} onDocumentChange={document => queue.schedule(document,saved)} /></> : <p>Loading isolated fixture</p>;
}
function App() {
 const [initial,setInitial] = useState<PfmeaDocument>();
 useEffect(() => { void setup(original).then(result => setInitial(result.data)); }, []);
 return <><button onClick={loseNextResponse}>Lose next save response</button><p>Isolated test database · 242 synthetic rows · Editor {new URLSearchParams(location.search).get('editor') ?? 'alice'}</p>{initial ? <Grid initial={initial} /> : null}</>;
}
createRoot(document.getElementById('root')!).render(<App />);
