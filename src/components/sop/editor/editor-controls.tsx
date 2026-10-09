import { Plus, Trash2 } from "lucide-react";

export function RowDeleteButton({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="ui-btn-ghost h-9 w-9 shrink-0 px-0 text-ink-tertiary hover:text-danger"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Trash2 size={13} />
    </button>
  );
}

export function AddButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="ui-btn-ghost mt-2 h-8 gap-1.5 px-3"
      onClick={onClick}
    >
      <Plus size={13} />
      {label}
    </button>
  );
}
