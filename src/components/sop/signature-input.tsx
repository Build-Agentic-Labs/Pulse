"use client";
import { useEffect, useState } from "react";
import { signatureStrokePath, type SignatureStrokes } from "@/domain/sop/signature";
import { SignaturePad } from "./signature-pad";
import { loadSignatureFont, typedSignatureStrokes } from "./typed-signature";

export function SignatureInput({ value, onChange, disabled = false }: { value: SignatureStrokes; onChange: (value: SignatureStrokes) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [name, setName] = useState("");
  const [drawn, setDrawn] = useState(value);
  const [fontReady, setFontReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void loadSignatureFont().then(() => { if (active) setFontReady(true); }).catch(() => { if (active) setError("Couldn’t load the handwriting font. You can still draw your signature."); }); return () => { active = false; }; }, []);
  function typeName(text: string) {
    setName(text);
    try { onChange(typedSignatureStrokes(text)); setError(""); }
    catch (caught) { onChange([]); setError(caught instanceof Error ? caught.message : "Could not prepare signature."); }
  }
  return <div className="space-y-3">
    <div className="flex gap-1" role="group" aria-label="Signature method">
      {(["draw", "type"] as const).map(next => <button key={next} type="button" aria-pressed={mode === next} disabled={disabled || (next === "type" && !fontReady)} className={`rounded px-3 py-1.5 text-xs ${mode === next ? "bg-surface-muted text-ink" : "text-ink-secondary"}`} onClick={() => { if (next === mode) return; if (next === "type") { setDrawn(value); typeName(name); } else onChange(drawn); setMode(next); }}>{next === "draw" ? "Draw" : "Type"}</button>)}
    </div>
    {mode === "draw" ? <SignaturePad value={value} disabled={disabled} onChange={onChange} /> : <div>
      <input aria-label="Type your full name" className="ui-field-standalone w-full" placeholder="Type your full name" maxLength={80} value={name} disabled={disabled} onChange={event => typeName(event.target.value)} />
      <div className="mt-3 flex h-28 items-center justify-center rounded-md border border-line bg-white px-4 text-black" aria-label="Typed signature preview"><svg viewBox="0 0 600 180" className="h-full w-full" aria-hidden="true">{value.map((stroke, index) => <path key={index} d={signatureStrokePath(stroke)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />)}</svg></div>
    </div>}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    <p className="text-[11px] leading-4 text-ink-tertiary">Your signature is saved for reuse when you sign.</p>
  </div>;
}
