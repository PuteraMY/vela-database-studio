import { resultCsv } from "../lib/export";
import { navigateTabs } from "./keyboard";
import { useMemo, useRef, useState, useEffect } from "react";
import { useStudio } from "../state/studio";
import { compare } from "../engine/expression";
import type { QueryResult } from "../engine/types";
import { Icon } from "./Icon";
function download(result: QueryResult, format: "csv" | "json") {
  const text =
    format === "csv"
      ? resultCsv(result)
      : JSON.stringify({ columns: result.columns, rows: result.rows }, null, 2);
  const url = URL.createObjectURL(
    new Blob([text], {
      type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `vela-hasil.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Results({
  dense,
  toast,
}: {
  dense: boolean;
  toast: (message: string) => void;
}) {
  const results = useStudio((s) => s.results),
    error = useStudio((s) => s.error),
    busy = useStudio((s) => s.busy),
    comparison = useStudio((s) => s.comparison),
    compareEnabled = useStudio((s) => s.compare);
  const [tab, setTab] = useState<"hasil" | "mesej" | "banding">("hasil"),
    [resultIndex, setResultIndex] = useState(-1);
  const result =
    results[
      resultIndex < 0
        ? results.length - 1
        : Math.min(resultIndex, results.length - 1)
    ];
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(
      null,
    ),
    [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSort(null);
    setScrollTop(0);
    setResultIndex(-1);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [results]);
  const rows = useMemo(() => {
    if (!result) return [];
    if (!sort) return result.rows;
    return [...result.rows].sort(
      (a, b) => (sort.desc ? -1 : 1) * compare(a[sort.column], b[sort.column]),
    );
  }, [result, sort]);
  const height = dense ? 32 : 42,
    start = Math.max(0, Math.floor(scrollTop / height) - 5),
    end = Math.min(rows.length, start + 45);
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(resultCsv({ ...result, rows }));
      toast("Hasil disalin ke papan klip.");
    } catch {
      toast("Salinan tidak dibenarkan oleh pelayar. Gunakan eksport CSV.");
    }
  };
  return (
    <>
      <div className="result-tabs">
        <div role="tablist" aria-label="Paparan hasil" onKeyDown={navigateTabs}>
          <button
            role="tab"
            aria-selected={tab === "hasil"}
            tabIndex={tab === "hasil" ? 0 : -1}
            onClick={() => setTab("hasil")}
          >
            <Icon name="table" />
            Hasil
            {result && (
              <span className="tab-count">
                {result.rows.length.toLocaleString("ms-MY")}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={tab === "mesej"}
            tabIndex={tab === "mesej" ? 0 : -1}
            onClick={() => setTab("mesej")}
          >
            <Icon name="terminal" />
            Mesej{error && <span className="error-dot" />}
          </button>
          <button
            role="tab"
            aria-selected={tab === "banding"}
            tabIndex={tab === "banding" ? 0 : -1}
            onClick={() => setTab("banding")}
            className="compare-tab"
          >
            Banding SQLite
          </button>
        </div>
        <div className="result-tools">
          <button
            aria-label="Salin hasil"
            title="Salin hasil"
            disabled={!result?.rows.length}
            onClick={() => void copy()}
          >
            <Icon name="copy" />
          </button>
          <button
            aria-label="Eksport CSV"
            title="Eksport CSV"
            disabled={!result?.rows.length}
            onClick={() => result && download({ ...result, rows }, "csv")}
          >
            <Icon name="download" />
            <span>CSV</span>
          </button>
          <button
            aria-label="Eksport JSON"
            title="Eksport JSON"
            disabled={!result?.rows.length}
            onClick={() => result && download({ ...result, rows }, "json")}
          >
            JSON
          </button>
        </div>
      </div>
      {error ? (
        <div className="error-state" role="alert">
          <Icon name="terminal" size={24} />
          <div>
            <strong>Pertanyaan tidak dapat dijalankan</strong>
            <p>{error.message}</p>
            <span>Semak ungkapan dalam editor dan cuba lagi.</span>
          </div>
        </div>
      ) : busy ? (
        <div className="panel-empty" role="status">
          <span className="loading-ring" />
          <h3>Enjin sedang bekerja</h3>
          <p>Pertanyaan dijalankan dalam Web Worker.</p>
        </div>
      ) : tab === "mesej" ? (
        <div className="message-list">
          {results.length ? (
            results.map((r, i) => (
              <div key={i}>
                <Icon name="check" />
                <span>
                  <strong>Pernyataan {i + 1}</strong>
                  <p>{r.message}</p>
                </span>
                <code>{r.ms.toFixed(2)} ms</code>
              </div>
            ))
          ) : (
            <div className="small-empty">
              Mesej pelaksanaan akan muncul di sini.
            </div>
          )}
        </div>
      ) : tab === "banding" ? (
        <div className="comparison">
          <div className="eyebrow">DUA ENJIN · SATU PERTANYAAN</div>
          <h3>Semak dengan SQLite</h3>
          <p>
            Bandingkan nilai dan susunan hasil SELECT yang sama pada data
            semasa.
          </p>
          <label className="check-control">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) =>
                useStudio.getState().setCompare(e.target.checked)
              }
            />
            Aktifkan Banding SQLite
          </label>
          {comparison ? (
            <>
              <div className="comparison-times">
                <div>
                  <span>VELA</span>
                  <strong>
                    {comparison.velaMs.toFixed(2)}
                    <small>ms</small>
                  </strong>
                </div>
                <div>
                  <span>SQLite</span>
                  <strong>
                    {comparison.sqliteMs.toFixed(2)}
                    <small>ms</small>
                  </strong>
                </div>
              </div>
              <div
                className={
                  comparison.match ? "comparison-match" : "comparison-diff"
                }
              >
                <Icon name={comparison.match ? "check" : "close"} />
                <strong>
                  {comparison.match ? "Hasil sepadan" : "Perbezaan dikesan"}
                </strong>
              </div>
              <p role="status">{comparison.detail}</p>
              {comparison.differences.length > 0 && (
                <div
                  className="diff-scroll"
                  tabIndex={0}
                  aria-label="Perbezaan hasil"
                >
                  <table className="diff-table">
                    <thead>
                      <tr>
                        <th>Sel</th>
                        <th>VELA</th>
                        <th>SQLite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.differences.map((d) => (
                        <tr key={`${d.statement}-${d.row}-${d.column}`}>
                          <td>
                            P{d.statement} · B{d.row} · L{d.column}
                          </td>
                          <td>{d.vela}</td>
                          <td>{d.sqlite}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="hint">
                    Sehingga 20 perbezaan pertama. P: pernyataan, B: baris, L:
                    lajur.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="hint">
              Aktifkan mod ini, kemudian tekan Jalankan. WASM dimuatkan hanya
              apabila diperlukan.
            </p>
          )}
        </div>
      ) : result?.columns.length ? (
        <>
          <div className="result-summary" role="status" aria-live="polite">
            <span className="success-mark">
              <Icon name="check" size={13} />
            </span>
            <span>Pertanyaan berjaya</span>
            <i />
            <span>{rows.length.toLocaleString("ms-MY")} baris</span>
            <span className="result-time">
              <Icon name="clock" size={13} />
              {result.ms.toFixed(2)} ms
            </span>
            {results.length > 1 && (
              <select
                aria-label="Pernyataan hasil"
                value={resultIndex < 0 ? results.length - 1 : resultIndex}
                onChange={(e) => setResultIndex(Number(e.target.value))}
              >
                {results.map((_, i) => (
                  <option key={i} value={i}>
                    Pernyataan {i + 1}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div
            className="table-scroll"
            ref={scroller}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <table
              className={dense ? "data-table dense" : "data-table"}
              aria-label="Hasil pertanyaan"
              aria-rowcount={rows.length + 1}
            >
              <thead>
                <tr>
                  <th className="row-number">#</th>
                  {result.columns.map((name, i) => (
                    <th key={`${name}-${i}`}>
                      <button
                        onClick={() => {
                          setSort({
                            column: i,
                            desc: sort?.column === i ? !sort.desc : false,
                          });
                          setScrollTop(0);
                          if (scroller.current) scroller.current.scrollTop = 0;
                        }}
                      >
                        <span>{name}</span>
                        <span
                          className={
                            sort?.column === i ? "sort-active" : "sort-icon"
                          }
                        >
                          {sort?.column === i ? (sort.desc ? "↓" : "↑") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {start > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={result.columns.length + 1}
                      style={{ height: start * height, padding: 0, border: 0 }}
                    />
                  </tr>
                )}
                {rows.slice(start, end).map((row, i) => (
                  <tr key={start + i} aria-rowindex={start + i + 2}>
                    <td className="row-number">{start + i + 1}</td>
                    {row.map((v, j) => (
                      <td
                        key={j}
                        className={typeof v === "number" ? "numeric" : ""}
                      >
                        {v === null ? (
                          <span className="null-value">NULL</span>
                        ) : (
                          String(v)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {end < rows.length && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={result.columns.length + 1}
                      style={{
                        height: (rows.length - end) * height,
                        padding: 0,
                        border: 0,
                      }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
            {!rows.length && (
              <div className="panel-empty">
                <Icon name="filter" size={28} />
                <h3>Tiada baris sepadan</h3>
                <p>Cuba longgarkan syarat WHERE anda.</p>
              </div>
            )}
          </div>
          <div className="result-footer">
            <span>
              {rows.length
                ? `${Math.min(start + 1, rows.length)}–${Math.min(end, rows.length)} daripada ${rows.length.toLocaleString("ms-MY")} baris`
                : "0 baris"}
            </span>
            <span>
              <span className="tiny-square" />
              Paparan maya{sort ? " · Disusun dalam paparan" : ""}
            </span>
          </div>
        </>
      ) : (
        <div className="panel-empty">
          <Icon name={result ? "check" : "table"} size={28} />
          <h3>
            {result ? "Pernyataan selesai" : "Data bermula dengan pertanyaan"}
          </h3>
          <p>
            {result?.message ?? "Tulis SQL dalam editor dan tekan Jalankan."}
          </p>
        </div>
      )}
    </>
  );
}
