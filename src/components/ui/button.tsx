import type { ComponentPropsWithRef } from "react";
import "./controls.css";

export type ControlDensity = "compact" | "standard" | "touch";
type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  density?: ControlDensity;
  pending?: boolean;
  static?: boolean;
};

/** className is for placement; variants own the control's visual treatment. */
export function Button({ variant = "primary", density = "standard", pending = false, static: staticPress = false, disabled, type = "button", className = "", ...props }: ButtonProps) {
  return <button {...props} type={type} className={`ui-control-button ${className}`} data-variant={variant} data-density={density} data-static={staticPress || undefined} disabled={disabled || pending} aria-busy={pending || undefined} />;
}

export function IconButton({ label, tone = "neutral", ...props }: Omit<ButtonProps, "aria-label"> & { label: string; tone?: "neutral" | "danger" }) {
  return <Button variant="ghost" {...props} aria-label={label} data-icon-only data-tone={tone} />;
}
