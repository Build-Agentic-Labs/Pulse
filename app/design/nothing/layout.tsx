export default function NothingDesignLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-full overflow-auto">{children}</div>;
}
