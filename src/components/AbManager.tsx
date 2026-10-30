"use client";
/** Admin A/B experiments + results (Phase 5, feature 23). */
import { useCallback, useEffect, useState } from "react";

export interface AbDict {
  save: string; saved: string; name: string; variants: string; status: string;
  results: string; exposures: string; conversions: string; rate: string;
  significant: string; notSignificant: string; empty: string; addExperiment: string;
  headline: string; weight: string; variantKey: string;
}

interface Variant { key: string; weight: number; headline: string }
interface Experiment {
  id: string; name: string; slot: string; status: string; variants: Variant[]; createdAt: string;
}
interface VariantResult { key: string; exposures: number; conversions: number; rate: number; vsControl: { z: number; pValue: number; significant95: boolean } | null }
interface Results { experimentId: string; variants: VariantResult[] }

export default function AbManager({ dict }: { dict: AbDict }) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [results, setResults] = useState<Results[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ab-tests");
      if (!res.ok) return;
      const data = (await res.json()) as { config: { experiments: Experiment[] }; results: Results[] };
      setExperiments(data.config.experiments);
      setResults(data.results);
    } catch { /* empty state renders */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    await fetch("/api/admin/ab-tests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { experiments } }),
    });
    setSaved(true);
    void load();
  }

  function addExperiment() {
    const id = `exp-${experiments.length + 1}`;
    setExperiments((xs) => [
      ...xs,
      {
        id, name: id, slot: "hero_title", status: "draft", createdAt: new Date().toISOString(),
        variants: [
          { key: "control", weight: 50, headline: "" },
          { key: "b", weight: 50, headline: "" },
        ],
      },
    ]);
  }

  function patchExp(i: number, patch: Partial<Experiment>) {
    setExperiments((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function patchVariant(i: number, j: number, patch: Partial<Variant>) {
    setExperiments((xs) =>
      xs.map((x, xi) => (xi === i ? { ...x, variants: x.variants.map((v, vj) => (vj === j ? { ...v, ...patch } : v)) } : x)),
    );
  }

  return (
    <div>
      {experiments.length === 0 && <p className="empty-note">{dict.empty}</p>}
      {experiments.map((exp, i) => {
        const res = results.find((r) => r.experimentId === exp.id);
        return (
          <article key={exp.id} className="panel" style={{ marginBottom: 12 }}>
            <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label>
                {dict.name}{" "}
                <input type="text" value={exp.name} onChange={(e) => patchExp(i, { name: e.target.value })} />
              </label>
              <label>
                {dict.status}{" "}
                <select value={exp.status} onChange={(e) => patchExp(i, { status: e.target.value })}>
                  <option value="draft">draft</option>
                  <option value="running">running</option>
                  <option value="stopped">stopped</option>
                </select>
              </label>
              <code>{exp.id} · slot: {exp.slot}</code>
            </p>
            <table className="admin-table">
              <thead>
                <tr><th>{dict.variantKey}</th><th>{dict.weight} %</th><th>{dict.headline}</th></tr>
              </thead>
              <tbody>
                {exp.variants.map((v, j) => (
                  <tr key={j}>
                    <td>
                      <input type="text" value={v.key} onChange={(e) => patchVariant(i, j, { key: e.target.value })} style={{ width: 110 }} />
                    </td>
                    <td>
                      <input type="number" min={0} max={100} value={v.weight} onChange={(e) => patchVariant(i, j, { weight: Number(e.target.value) })} style={{ width: 70 }} />
                    </td>
                    <td>
                      <input type="text" value={v.headline} onChange={(e) => patchVariant(i, j, { headline: e.target.value })} style={{ width: "100%" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {res && (
              <>
                <h4>{dict.results}</h4>
                <table className="admin-table">
                  <thead>
                    <tr><th>{dict.variantKey}</th><th>{dict.exposures}</th><th>{dict.conversions}</th><th>{dict.rate}</th><th>p</th><th></th></tr>
                  </thead>
                  <tbody>
                    {res.variants.map((v) => (
                      <tr key={v.key}>
                        <td>{v.key}</td>
                        <td>{v.exposures}</td>
                        <td>{v.conversions}</td>
                        <td>{(v.rate * 100).toFixed(1)}%</td>
                        <td>{v.vsControl ? v.vsControl.pValue.toFixed(3) : "—"}</td>
                        <td>
                          {v.vsControl
                            ? v.vsControl.significant95
                              ? <span className="pill pill-ok">{dict.significant}</span>
                              : <span className="muted">{dict.notSignificant}</span>
                            : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </article>
        );
      })}
      <p style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn" onClick={addExperiment}>{dict.addExperiment}</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button>
        {saved ? <span className="ok-text"> ✓ {dict.saved}</span> : null}
      </p>
    </div>
  );
}
