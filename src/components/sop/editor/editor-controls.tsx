import { Button, IconButton } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

export function RowDeleteButton({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <IconButton
      tone="danger"
      title={title}
      label={title}
      onClick={onClick}
    >
      <Trash2 size={13} />
    </IconButton>
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
    <Button
      variant="ghost"
      className="mt-2"
      onClick={onClick}
    >
      <Plus size={13} />
      {label}
    </Button>
  );
}
