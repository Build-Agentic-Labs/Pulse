"use client";
import { formatInstruction, type InstructionFormat } from "@/domain/instruction-bullets";
export function InstructionFormatToolbar({sequence,value,onChange}: {sequence:number;value:string;onChange:(value:string)=>void}) {
  return <div className="inline-flex items-center gap-0.5" role="group" aria-label={`Step ${sequence} instruction formatting`}>
    {([['steps','A–B–C'],['bullets','Bullets'],['note','Note'],['check','Check']] as const).map(([format,label]) =>
      <button key={format} type="button" className="ui-btn-ghost h-7 px-2 text-[10px]"
        aria-label={`Format step ${sequence} as ${format}`} title={`Format current or selected lines as ${label}`}
        onMouseDown={event=>event.preventDefault()}
        onClick={event=>{
          const container = event.currentTarget.closest('[data-instruction-step]');
          const textarea = container?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Step ${sequence} instruction"]`);
          if (!textarea) return;
          const result = formatInstruction(value,textarea.selectionStart,textarea.selectionEnd,format as InstructionFormat);
          onChange(result.value);
          requestAnimationFrame(()=>{if(textarea.isConnected && textarea.value===result.value){textarea.focus({preventScroll:true});textarea.setSelectionRange(result.selectionStart,result.selectionStart);}});
        }}>{label}</button>)}
  </div>;
}
