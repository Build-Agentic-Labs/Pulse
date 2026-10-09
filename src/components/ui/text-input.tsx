import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ControlDensity } from "./button";
import "./controls.css";

export function TextInput({ density = "standard", className = "", ...props }: ComponentPropsWithRef<"input"> & { density?: ControlDensity }) {
  return <input {...props} className={`ui-control-input ${className}`} data-density={density} />;
}

/** Keeps the label/help relationship explicit without changing input or save state. */
export function Field({ inputId, label, hint, children, className = "" }: { inputId: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return <div className={`ui-control-field ${className}`}>
    <label htmlFor={inputId} className="ui-control-label">{label}</label>
    {children}
    {hint ? <p id={`${inputId}-hint`} className="ui-control-hint">{hint}</p> : null}
  </div>;
}
