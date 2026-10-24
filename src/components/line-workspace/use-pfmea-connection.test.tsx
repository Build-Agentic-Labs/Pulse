import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePfmeaConnection } from './use-pfmea-connection';
function network(online: boolean) { Object.defineProperty(navigator,'onLine',{configurable:true,value:online}); window.dispatchEvent(new Event(online?'online':'offline')); }
beforeEach(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:true}));
afterEach(()=>vi.restoreAllMocks());
describe('online-only PFMEA editing',()=>{
  it('pauses on connection loss without rechecking or discarding work',()=>{
    const check=vi.fn(); const {result}=renderHook(()=>usePfmeaConnection('a',true,false,check));
    act(()=>network(false)); expect(result.current.paused).toBe(true); expect(check).not.toHaveBeenCalled();
  });
  it('resumes only after a successful server recheck',async()=>{
    let finish!:()=>void; const check=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const {result}=renderHook(()=>usePfmeaConnection('a',true,false,check));
    act(()=>network(false)); await act(async()=>network(true));
    expect(result.current.paused).toBe(true); expect(result.current.checking).toBe(true);
    await act(async()=>finish()); expect(result.current.paused).toBe(false);
  });
  it('does not resume when connectivity drops during a recheck',async()=>{
    let finish!:()=>void; const {result}=renderHook(()=>usePfmeaConnection('a',true,false,()=>new Promise<void>(resolve=>{finish=resolve;})));
    act(()=>network(false)); await act(async()=>network(true)); act(()=>network(false));
    await act(async()=>finish()); expect(result.current.paused).toBe(true);
  });
  it('retains a failed recheck and allows explicit retry',async()=>{
    const check=vi.fn().mockRejectedValueOnce(new Error('Server unavailable')).mockResolvedValueOnce(undefined);
    const {result}=renderHook(()=>usePfmeaConnection('a',true,false,check));
    await act(async()=>{await result.current.reconnect();}); expect(result.current.paused).toBe(true); expect(result.current.message).toBe('Server unavailable');
    await act(async()=>{await result.current.reconnect();}); expect(result.current.paused).toBe(false);
  });
  it('pauses after a failed save even when the browser reports online',()=>{
    const {result}=renderHook(()=>usePfmeaConnection('a',true,true,async()=>{})); expect(result.current.paused).toBe(true);
  });
  it('does not issue hidden-PFMEA reads',()=>{
    const check=vi.fn(); const {result}=renderHook(()=>usePfmeaConnection('a',false,false,check));
    act(()=>network(false)); act(()=>network(true)); expect(check).not.toHaveBeenCalled(); expect(result.current.paused).toBe(false);
  });
  it('does not let an old scope request change the new scope state',async()=>{
    let finish!:()=>void;
    const {result,rerender}=renderHook(({scope})=>usePfmeaConnection(scope,true,false,()=>new Promise<void>(resolve=>{finish=resolve;})),{initialProps:{scope:'a'}});
    await act(async()=>{void result.current.reconnect();}); rerender({scope:'b'});
    act(()=>network(false)); await act(async()=>finish()); expect(result.current.paused).toBe(true);
  });
});
