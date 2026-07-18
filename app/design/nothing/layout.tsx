// The nd-* classes the showcase renders live in this stylesheet; it is scoped to
// this route rather than globals.css so no other route pays for it.
import "@/theme/nothing-design.css";

export default function NothingDesignLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-full overflow-auto">{children}</div>;
}
