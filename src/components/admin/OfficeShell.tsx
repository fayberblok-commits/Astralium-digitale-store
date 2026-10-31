"use client";

/**
 * Manager's Office shell (Phase 4 upgrade, item 10): the admin page
 * renders every section server-side (already permission-filtered) and
 * this shell presents them as an office: a sidebar on wide screens, a
 * horizontally scrolling tab strip on phones. Only the active section
 * is mounted, so panels fetch their data when opened.
 */
import { useState, type ReactNode } from "react";

export interface OfficeSection {
  id: string;
  label: string;
  node: ReactNode;
}

export default function OfficeShell({
  title,
  signedInAs,
  sections,
}: {
  title: string;
  signedInAs: ReactNode;
  sections: OfficeSection[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const current = sections.find((s) => s.id === active) ?? sections[0];
  return (
    <div className="office">
      <div className="office-head">
        <h1>{title}</h1>
        <div className="muted office-who">{signedInAs}</div>
      </div>
      <div className="office-body">
        <nav className="office-nav" aria-label={title}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === current?.id ? "office-tab active" : "office-tab"}
              aria-current={s.id === current?.id ? "page" : undefined}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="office-main">{current?.node}</div>
      </div>
    </div>
  );
}
