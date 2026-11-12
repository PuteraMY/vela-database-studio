import { navigateTabs } from "./keyboard";
import { useEffect, useState } from "react";
import type { Trace } from "../engine/types";
import { useStudio } from "../state/studio";
import { Icon, type IconName } from "./Icon";
export type InspectorTab = "pelan" | "pokok" | "transaksi" | "metrik";
const tabs: { id: InspectorTab; name: string; icon: IconName }[] = [
  { id: "pelan", name: "Pelan", icon: "layers" },
  { id: "pokok", name: "Pokok-B", icon: "tree" },
  { id: "transaksi", name: "Transaksi", icon: "database" },
  { id: "metrik", name: "Metrik", icon: "chart" },
];
function Plan({ trace }: { trace: Trace[] }) {
  const [step, setStep] = useState(-1),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<Trace | null>(null);
  useEffect(() => {
    setStep(-1);
    setPlaying(false);
    setSelected(null);
  }, [trace]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setStep((s) => {
          if (s >= trace.length - 1) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        }),
      650,
    );
    return () => clearInterval(timer);
  }, [playing, trace.length]);
  if (!trace.length)
    return (
      <div className="panel-empty">
        <Icon name="layers" size={30} />
        <h3>Pelan belum tersedia</h3>
        <p>Jalankan SELECT untuk melihat aliran operator sebenar.</p>
      </div>
    );
  const depth = (t: Trace): number => {
    const children = trace.filter((c) => c.parent === t.id);
    return children.length ? 1 + Math.max(...children.map(depth)) : 0;
  };
  const depths = trace.map(depth),
    maxDepth = Math.max(...depths),
    width = Math.max(
      284,
      140 *
        Math.max(...depths.map((d) => depths.filter((x) => x === d).length)) +
        4,
    );
  const positions = trace.map((t, i) => {
    const siblings = trace.filter((_, j) => depths[j] === depths[i]),
      idx = siblings.indexOf(t),
      w = siblings.length > 1 ? 124 : 228;
    return {
      x:
        siblings.length > 1
          ? (width - siblings.length * 140) / 2 + 10 + idx * 140
          : (width - 228) / 2,
      y: depths[i] * 96 + 18,
      w,
    };
  });
  const maxMs = Math.max(...trace.map((t) => t.ms), 0.001),
    active = selected ?? (step >= 0 ? trace[step] : trace.at(-1));
  return (
    <>
      <div className="inspector-heading">
        <div className="eyebrow">DI SEBALIK PERTANYAAN</div>
        <h2>Aliran pelaksanaan</h2>
        <p>Dari jadual ke jawapan.</p>
      </div>
      <div className="plan-legend">
        <span>
          <i className="legend-dot teal" />
          Operator sebenar
        </span>
        <span>{trace.length} langkah</span>
      </div>
      <div className="plan-canvas">
        <svg
          viewBox={`0 0 ${width} ${(maxDepth + 1) * 96 + 10}`}
          className="plan-svg"
          style={{ minWidth: width }}
          role="group"
          aria-label={`Pelan pelaksanaan: ${trace.map((t) => `${t.operator}, ${t.rowsOut} baris keluar`).join("; ")}`}
        >
          <defs>
            <pattern
              id="dots"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="0.65" fill="#263245" />
            </pattern>
            <marker
              id="flow-arrow"
              markerWidth="5"
              markerHeight="5"
              refX="4"
              refY="2.5"
              orient="auto"
            >
              <path d="M0 0 5 2.5 0 5" fill="none" stroke="#5B9DFF" />
            </marker>
          </defs>
          <rect width={width} height="100%" fill="url(#dots)" />
          {trace.map((t, i) => {
            if (t.parent === undefined) return null;
            const j = trace.findIndex((x) => x.id === t.parent),
              a = positions[i],
              b = positions[j];
            const d = `M${a.x + a.w / 2},${a.y + 65} C${a.x + a.w / 2},${a.y + 85} ${b.x + b.w / 2},${b.y - 18} ${b.x + b.w / 2},${b.y - 4}`;
            return (
              <g key={`edge-${t.id}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={step >= i ? "#5B9DFF" : "#33445D"}
                  strokeWidth="1"
                  markerEnd="url(#flow-arrow)"
                  className={playing ? "flow-line" : ""}
                />
              </g>
            );
          })}
          {trace.map((t, i) => {
            const p = positions[i],
              narrow = p.w < 150,
              highlight = step === i || selected?.id === t.id;
            return (
              <g
                key={t.id}
                className="plan-node"
                role="button"
                tabIndex={0}
                onClick={() => setSelected(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(t);
                  }
                }}
              >
                <title>
                  {t.detail} · {t.rowsIn} masuk → {t.rowsOut} keluar ·{" "}
                  {t.ms.toFixed(3)} ms
                </title>
                <rect
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height="65"
                  rx="3"
                  fill={highlight ? "#18322F" : "#111A27"}
                  stroke={highlight ? "#2EE6C5" : "#2A3A50"}
                />
                <rect
                  x={p.x}
                  y={p.y + 10}
                  width="2"
                  height="18"
                  fill={i < 2 ? "#5B9DFF" : "#2EE6C5"}
                />
                <text x={p.x + 12} y={p.y + 22} className="node-title">
                  {t.operator}
                </text>
                <text x={p.x + 12} y={p.y + 40} className="node-meta">
                  {narrow ? t.detail.split(" · ")[0] : `${t.rowsOut} baris`}
                </text>
                <text
                  x={p.x + p.w - 12}
                  y={p.y + 40}
                  textAnchor="end"
                  className="node-time"
                >
                  {narrow ? `${t.rowsOut}` : `${t.ms.toFixed(2)} ms`}
                </text>
                <rect
                  x={p.x + 12}
                  y={p.y + 52}
                  width={p.w - 24}
                  height="2"
                  fill="#253044"
                />
                <rect
                  x={p.x + 12}
                  y={p.y + 52}
                  width={Math.max(2, ((p.w - 24) * t.ms) / maxMs)}
                  height="2"
                  fill={i < 2 ? "#5B9DFF" : "#2EE6C5"}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="replay-controls">
        <button
          aria-label={playing ? "Jeda pelan" : "Main semula pelan"}
          onClick={() => {
            if (step >= trace.length - 1) setStep(-1);
            setPlaying(!playing);
          }}
        >
          <Icon name={playing ? "pause" : "play"} size={14} />
          <span>{playing ? "Jeda" : "Main semula"}</span>
        </button>
        <button
          aria-label="Langkah pelan"
          onClick={() => {
            setPlaying(false);
            setStep((s) => (s + 1) % trace.length);
          }}
        >
          <Icon name="step" size={15} />
        </button>
        <span>
          {Math.max(step + 1, 0)} / {trace.length}
        </span>
      </div>
      {active && (
        <div className="operator-detail">
          <div className="eyebrow">
            {selected ? "OPERATOR DIPILIH" : "RINGKASAN OPERATOR"}
          </div>
          <div>
            <span>{active.operator}</span>
            <strong>
              {active.ms.toFixed(2)} <small>ms</small>
            </strong>
          </div>
          <p>{active.detail}</p>
          <div className="operator-counts">
            <span>
              Masuk <b>{active.rowsIn.toLocaleString("ms-MY")}</b>
            </span>
            <Icon name="arrow" size={14} />
            <span>
              Keluar <b>{active.rowsOut.toLocaleString("ms-MY")}</b>
            </span>
          </div>
        </div>
      )}
      <div className="inspector-note">
        <Icon name="layers" size={13} />
        <span>
          Model Volcano · tarik satu baris setiap langkah. Masa operator
          termasuk anaknya; main semula menggunakan jejak yang dirakam.
        </span>
      </div>
    </>
  );
}
function Metrics() {
  const metrics = useStudio((s) => s.metrics);
  const max = Math.max(1, ...metrics.map((m) => m.ms));
  return (
    <>
      <div className="inspector-heading">
        <div className="eyebrow">TELEMETRI SESI</div>
        <h2>Setiap milisaat bermakna.</h2>
        <p>{metrics.length} pertanyaan dalam sesi ini.</p>
      </div>
      {!metrics.length ? (
        <div className="panel-empty">
          <Icon name="chart" size={28} />
          <p>Jalankan pertanyaan untuk merekod metrik.</p>
        </div>
      ) : (
        <>
          <div className="metric-primary">
            <span>LATENSI TERAKHIR</span>
            <strong>
              {metrics.at(-1)?.ms.toFixed(2)}
              <small>ms</small>
            </strong>
            <svg
              viewBox="0 0 270 120"
              role="img"
              aria-label={`Latensi ${metrics.map((m) => m.ms.toFixed(2)).join(", ")} milisaat`}
            >
              <path
                d="M10 20H260M10 60H260M10 100H260"
                stroke="#222C3D"
                fill="none"
                strokeDasharray="3 4"
              />
              <polyline
                points={metrics
                  .map(
                    (m, i) =>
                      `${10 + (i * 250) / Math.max(1, metrics.length - 1)},${100 - (m.ms / max) * 80}`,
                  )
                  .join(" ")}
                stroke="#2EE6C5"
                strokeWidth="2"
                fill="none"
              />
              {metrics.map((m, i) => (
                <circle
                  key={i}
                  cx={10 + (i * 250) / Math.max(1, metrics.length - 1)}
                  cy={100 - (m.ms / max) * 80}
                  r="3"
                  fill="#2EE6C5"
                />
              ))}
            </svg>
          </div>
          <div className="metric-pair">
            <div>
              <span>BARIS DIIMBAS</span>
              <strong>{metrics.at(-1)?.scanned.toLocaleString("ms-MY")}</strong>
            </div>
            <div>
              <span>BARIS HASIL</span>
              <strong>{metrics.at(-1)?.rows.toLocaleString("ms-MY")}</strong>
            </div>
          </div>
          <div className="metric-log">
            <div className="eyebrow">PERTANYAAN TERKINI</div>
            {[...metrics]
              .reverse()
              .slice(0, 8)
              .map((m, i) => (
                <div key={i}>
                  <span>#{metrics.length - i}</span>
                  <span>{m.scanned.toLocaleString("ms-MY")} baris</span>
                  <strong>{m.ms.toFixed(2)} ms</strong>
                </div>
              ))}
          </div>
          <div className="inspector-note">
            P0 menggunakan imbasan jadual. Bacaan halaman dan akses indeks
            fizikal belum tersedia.
          </div>
        </>
      )}
    </>
  );
}
function FuturePanel({ tree }: { tree: boolean }) {
  const schema = useStudio((s) => s.schema);
  return (
    <>
      <div className="inspector-heading">
        <div className="eyebrow">
          {tree ? "STORAN & INDEKS" : "KEKONSISTENAN DATA"}
        </div>
        <h2>
          {tree
            ? "Struktur di sebalik data."
            : "Satu perubahan pada satu masa."}
        </h2>
      </div>
      <div className="future-visual">
        <Icon name={tree ? "tree" : "database"} size={64} />
      </div>
      <div className="future-copy">
        <span className="tier-label">
          {tree ? "TIER P1" : "TIER P2"} · BELUM TERSEDIA
        </span>
        <h3>
          {tree ? "Pokok-B belum dibina" : "Transaksi belum dilaksanakan"}
        </h3>
        <p>
          {tree
            ? "Enjin P0 menyimpan baris dalam memori. Takrif indeks direkodkan, tetapi belum digunakan untuk mencari data."
            : "Setiap pernyataan mengesahkan semua kekangan sebelum mengubah data. BEGIN, COMMIT, ROLLBACK, WAL dan MVCC memerlukan tier seterusnya."}
        </p>
      </div>
      {tree && (
        <div className="index-definitions">
          <div className="eyebrow">TAKRIF INDEKS SEMASA</div>
          {schema
            .flatMap((t) => [
              ...t.columns
                .filter((c) => c.primary)
                .map((c) => ({
                  name: `${t.name}.${c.name}`,
                  columns: ["PRIMARY KEY"],
                })),
              ...t.indexes,
            ])
            .map((i) => (
              <div key={i.name}>
                <Icon name="key" size={13} />
                <span>
                  {i.name}
                  <small>{i.columns.join(", ")}</small>
                </span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
export function Inspector({
  tab,
  setTab,
}: {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
}) {
  const result = useStudio((s) => s.results.at(-1));
  return (
    <>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Pemeriksa enjin"
        onKeyDown={navigateTabs}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={15} />
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {tab === "pelan" ? (
          <Plan trace={result?.trace ?? []} />
        ) : tab === "metrik" ? (
          <Metrics />
        ) : (
          <FuturePanel tree={tab === "pokok"} />
        )}
      </div>
      <div className="inspector-bottom">
        <span className="live-dot" />
        Tiada pelayan. Semuanya di sini.
        <Icon name="bolt" size={12} />
      </div>
    </>
  );
}
