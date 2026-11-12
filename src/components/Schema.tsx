import { useState } from "react";
import { useStudio } from "../state/studio";
import { Icon } from "./Icon";
import { datasetNames } from "../engine/datasets";
export function Schema({
  onImport,
  onGenerate,
  onSelect,
}: {
  onImport: () => void;
  onGenerate: () => void;
  onSelect: () => void;
}) {
  const schema = useStudio((s) => s.schema),
    dataset = useStudio((s) => s.dataset),
    busy = useStudio((s) => s.busy);
  const [filter, setFilter] = useState("");
  return (
    <>
      <div className="pane-heading">
        <span>SKEMA PANGKALAN DATA</span>
        <span className="micro-count">{schema.length}</span>
      </div>
      <div className="schema-search">
        <Icon name="search" size={14} />
        <input
          aria-label="Cari jadual"
          placeholder="Cari jadual…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <kbd>/</kbd>
      </div>
      <div className="schema-root">
        <Icon name="database" />
        <strong>
          {datasetNames[dataset].toLowerCase().replaceAll(" ", "_")}
        </strong>
        <span className="live-dot" />
      </div>
      <div className="schema-tables">
        {schema.length === 0 ? (
          <div className="small-empty">Memuatkan skema…</div>
        ) : (
          schema
            .filter((t) => t.name.includes(filter.toLowerCase()))
            .map((table, i) => (
              <details
                key={table.name}
                open={i === 0 || table.name === "pendaftaran" || undefined}
              >
                <summary>
                  <Icon name="chevron" size={12} className="disclosure" />
                  <Icon name="table" size={14} />
                  <span>{table.name}</span>
                  <span className="table-count">
                    {table.rowCount.toLocaleString("ms-MY")}
                  </span>
                </summary>
                <div className="column-list">
                  {table.columns.map((c) => (
                    <div className="column-row" key={c.name}>
                      <span className={c.primary ? "key-icon" : "column-icon"}>
                        {c.primary ? (
                          <Icon name="key" size={12} />
                        ) : c.references ? (
                          <Icon name="link" size={12} />
                        ) : (
                          <span>⊞</span>
                        )}
                      </span>
                      <span>{c.name}</span>
                      <small>
                        {c.type === "INTEGER"
                          ? "int"
                          : c.type === "BOOLEAN"
                            ? "bool"
                            : c.type.toLowerCase()}
                      </small>
                    </div>
                  ))}
                  {table.indexes.map((i) => (
                    <div
                      className="schema-index"
                      key={i.name}
                      title="Takrif indeks sahaja; storan fizikal belum tersedia"
                    >
                      <Icon name="bolt" size={12} />
                      <span>{i.name}</span>
                    </div>
                  ))}
                  <button
                    className="preview-table"
                    onClick={() => {
                      useStudio
                        .getState()
                        .setSql(`SELECT * FROM ${table.name} LIMIT 100;`);
                      onSelect();
                    }}
                  >
                    <Icon name="arrow" size={12} />
                    Buka pertanyaan
                  </button>
                </div>
              </details>
            ))
        )}
        {schema.length > 0 &&
          !schema.some((t) => t.name.includes(filter.toLowerCase())) && (
            <div className="small-empty">Tiada jadual sepadan.</div>
          )}
      </div>
      <div className="schema-actions">
        <button onClick={onImport} disabled={busy}>
          <Icon name="upload" />
          Import CSV
        </button>
        <button onClick={onGenerate} disabled={busy}>
          <Icon name="plus" />
          Jana data
        </button>
      </div>
      <div className="schema-foot">
        <span className="live-dot" />
        <span>Enjin dalam pelayar</span>
        <div>
          {schema.reduce((n, t) => n + t.rowCount, 0).toLocaleString("ms-MY")}{" "}
          baris <span>·</span> Dalam memori
        </div>
      </div>
    </>
  );
}
