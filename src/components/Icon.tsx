import type { CSSProperties } from "react";
export type IconName =
  | "play"
  | "database"
  | "table"
  | "key"
  | "chevron"
  | "plus"
  | "search"
  | "command"
  | "code"
  | "chart"
  | "tree"
  | "layers"
  | "clock"
  | "download"
  | "copy"
  | "check"
  | "close"
  | "arrow"
  | "upload"
  | "book"
  | "save"
  | "settings"
  | "expand"
  | "filter"
  | "terminal"
  | "pause"
  | "step"
  | "bolt"
  | "link";
const paths: Record<IconName, string> = {
  play: "m8 5 11 7-11 7V5Z",
  database:
    "M20 6c0 2-3.6 3-8 3S4 8 4 6s3.6-3 8-3 8 1 8 3ZM4 6v12c0 2 3.6 3 8 3s8-1 8-3V6M4 12c0 2 3.6 3 8 3s8-1 8-3",
  table: "M3 4h18v16H3V4Zm0 5h18M9 9v11",
  key: "M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 4v10m0-4h4m-4-3h3",
  chevron: "m9 5 7 7-7 7",
  plus: "M12 5v14M5 12h14",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
  command:
    "M8 8h8v8H8V8Zm0 0H5a3 3 0 1 1 3-3v3Zm8 0V5a3 3 0 1 1 3 3h-3Zm0 8h3a3 3 0 1 1-3 3v-3Zm-8 0v3a3 3 0 1 1-3-3h3",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  chart: "M4 4v16h17M8 15v-4m5 4V7m5 8v-6",
  tree: "M9 3h6v5H9V3ZM3 16h6v5H3v-5Zm12 0h6v5h-6v-5ZM12 8v4M6 16v-4h12v4",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  copy: "M8 8h13v13H8V8ZM16 8V3H3v13h5",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  book: "M12 5c-4-3-8-2-10-1v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15",
  save: "M4 3h13l4 4v14H3V3h1Zm3 0v6h9V3M7 21v-8h10v8",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
  terminal: "m4 6 6 6-6 6m9 0h7",
  pause: "M8 5v14M16 5v14",
  step: "m5 5 10 7-10 7V5Zm14 0v14",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7",
  link: "m9 15 6-6m-8 4-2 2a4 4 0 0 0 6 6l3-3m-4-12 3-3a4 4 0 0 1 6 6l-2 2",
};
export function Icon({
  name,
  size = 16,
  className = "",
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
