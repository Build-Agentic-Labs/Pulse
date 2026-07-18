export const WORKER_ICON_LETTERS = "ABCDEFGHIJKLMNO".split("");

const workerIconColors = [
  "#0f7f75",
  "#c2642b",
  "#315f7f",
  "#7a6a2b",
  "#8b3f45",
  "#3d6f4f",
  "#6d4b8d",
  "#b18a2c",
  "#2d6d89",
  "#a65335",
  "#51606d",
  "#19826a",
  "#a8485b",
  "#5b7d36",
  "#7d5a35",
];

export function WorkerIcon({
  className = "h-11 w-11",
  colorIndex,
  letter,
}: {
  className?: string;
  colorIndex: number;
  letter: string;
}) {
  const color = workerIconColors[colorIndex % workerIconColors.length];

  return (
    <svg aria-hidden="true" className={`${className} shrink-0`} viewBox="0 0 48 48">
      <path d="M16 15.5c.6-5.2 3.7-8.2 8-8.2s7.4 3 8 8.2H16Z" fill={color} />
      <path d="M15.2 15.8h17.6" stroke="#111" strokeLinecap="round" strokeOpacity="0.35" strokeWidth="2.2" />
      <circle cx="24" cy="17.8" r="6.8" fill={color} />
      <path d="M12.5 41.5V30.8c0-5 4-9 9-9h5c5 0 9 4 9 9v10.7h-23Z" fill={color} />
      <text
        x="24"
        y="37.5"
        fill="#fff"
        fontFamily="var(--font-ui-family)"
        fontSize="16"
        fontWeight="900"
        textAnchor="middle"
      >
        {letter}
      </text>
    </svg>
  );
}
