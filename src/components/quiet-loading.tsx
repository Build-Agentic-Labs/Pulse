type QuietLoadingProps = {
  active?: boolean;
  label?: string;
  reserveClassName?: string;
};

/**
 * Holds the final layout's space without painting placeholder bars or animation.
 * Loading remains available to assistive technology while visual transitions stay quiet.
 */
export function QuietLoading({
  active = true,
  label = "Loading content",
  reserveClassName = "min-h-[260px]",
}: QuietLoadingProps) {
  return (
    <div
      className={reserveClassName}
      aria-busy={active ? "true" : undefined}
      aria-label={active ? label : undefined}
      role={active ? "status" : undefined}
    />
  );
}
