import { Trash2 } from "lucide-react";
import { ProcedureToolPicker } from "@/components/procedure-tool-picker";

export function MobileStepTools({
  selectedTools,
  onAddTool,
  onRemoveTool,
  manualAdd,
  toolLibrary,
}: {
  selectedTools: string[];
  onAddTool: (toolName: string) => void;
  onRemoveTool: (toolName: string) => void;
  toolLibrary: string[];
  manualAdd?: {
    value: string;
    sequence: number;
    onChange: (value: string) => void;
    disabled?: boolean;
  };
}) {
  const toolNames = [...new Set(selectedTools)]
    .filter((tool) => tool.trim())
    .sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  return (
    <div className="ui-photo-mobile-tool-picker">
      {manualAdd ? (
        <ProcedureToolPicker
          mobile
          value={manualAdd.value}
          toolLibrary={toolLibrary}
          assignedTools={toolNames}
          stepSequence={manualAdd.sequence}
          onValueChange={manualAdd.onChange}
          onAdd={onAddTool}
          disabled={manualAdd.disabled}
        />
      ) : null}
      {toolNames.length > 0 ? (
        <div className="ui-photo-mobile-tool-grid">
          {toolNames.map((tool) => {
            return (
              <div key={tool} className="ui-photo-mobile-tool-card group">
                <div className="ui-photo-mobile-tool-name">{tool}</div>
                <button
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveTool(tool);
                  }}
                  aria-label={`Remove ${tool}`}
                  title={`Remove ${tool}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ui-photo-mobile-empty">
          No tools added to this step yet.
        </div>
      )}
    </div>
  );
}
