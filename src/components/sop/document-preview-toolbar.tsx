import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Shared chrome for SOP and general WI document previews. */
export function DocumentPreviewToolbar({ children, actions, onClose }: {
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="sop-preview-bar sop-document-toolbar">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">{children}</div>
      <div className="flex max-w-[55%] shrink-0 items-center gap-2 overflow-x-auto">
        {actions}
        <button type="button" className="ui-btn-ghost h-9 w-9 shrink-0 px-0" onClick={onClose} aria-label="Close preview">
          <X size={16} className="mx-auto" />
        </button>
      </div>
    </div>
  );
}
