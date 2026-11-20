"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Check, FileUp } from "lucide-react";
import {
  dedupe,
  guessMapping,
  IMPORT_FIELD_LABEL,
  IMPORT_FIELDS,
  mapRows,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  type ImportField,
  type Mapping,
} from "@/lib/leads/csv";
import { STATUS_LABEL } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { btn, hint, input, panel, panelHead } from "../../_ui/kit";
import { importLeads, type ImportResult } from "../actions";

type Sheet = { name: string; headers: string[]; rows: string[][] };

/** The three steps of a CSV import: choose a file, map columns, confirm. */
export function Importer() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  async function choose(file: File | undefined) {
    setProblem("");
    setResult(null);
    setSheet(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES)
      return setProblem(
        "That file is over 1 MB. Split it and import in parts.",
      );
    const table = parseCsv(await file.text());
    if (table.length < 2)
      return setProblem(
        "That file needs a header row and at least one row of leads.",
      );
    const [headers, ...rows] = table;
    if (rows.length > MAX_IMPORT_ROWS)
      return setProblem(
        `That file has ${rows.length.toLocaleString("en-US")} rows. Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} at a time.`,
      );
    setSheet({ name: file.name, headers, rows });
    setMapping(guessMapping(headers));
  }

  const preview = useMemo(() => {
    if (!sheet) return null;
    const { leads, problems } = mapRows(sheet.rows, mapping);
    const { fresh, inFile } = dedupe(leads, { emails: [], phones: [] });
    return { leads: fresh, repeated: inFile.length, problems };
  }, [sheet, mapping]);

  const mapped = new Set(Object.values(mapping));
  const canContact = mapped.has("email") || mapped.has("phone");

  function setColumn(index: number, field: ImportField | "") {
    setMapping((current) => {
      const next: Mapping = {};
      // A field belongs to one column: picking it here takes it from there.
      for (const [i, f] of Object.entries(current))
        if (Number(i) !== index && f !== field) next[Number(i)] = f;
      if (field) next[index] = field;
      return next;
    });
  }

  function run() {
    if (!preview || preview.leads.length === 0) return;
    start(async () => {
      try {
        setResult(
          await importLeads(
            preview.leads.map(
              ({ name, email, phone, company, website, status }) => ({
                name,
                email,
                phone,
                company,
                website,
                status,
              }),
            ),
          ),
        );
      } catch {
        setResult({
          ok: false,
          message:
            "The import didn't go through. Check your connection and try again.",
        });
      }
    });
  }

  if (result?.ok)
    return (
      <section className={cn(panel, "items-center px-6 py-10 text-center")}>
        <span className="grid size-11 place-items-center rounded-full bg-[#0B0B0C] text-white">
          <Check aria-hidden className="size-5" />
        </span>
        <h2 role="status" className="mt-4 text-[17px] font-medium">
          {result.added === 0
            ? "Nothing new to add"
            : `${result.added} ${result.added === 1 ? "lead" : "leads"} imported`}
        </h2>
        <p className="mt-1 max-w-[420px] text-[13px] leading-[1.55] text-[#0B0B0C]/60">
          {[
            result.alreadyHere
              ? `${result.alreadyHere} already in this workspace (matched by email or phone), left as they were`
              : "",
            (result.repeated ?? 0) + (preview?.repeated ?? 0)
              ? `${(result.repeated ?? 0) + (preview?.repeated ?? 0)} repeated in the file`
              : "",
            (preview?.problems.length ?? 0) + (result.rejected ?? 0)
              ? `${new Set(preview?.problems.map((p) => p.row)).size + (result.rejected ?? 0)} rows had a problem`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || "Every row went in."}
          . No consent was recorded for imported leads.
        </p>
        <div className="mt-5 flex gap-2">
          <Link href="/app/leads" className={btn.primary}>
            See your leads
          </Link>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => {
              setSheet(null);
              setResult(null);
            }}
          >
            Import another file
          </button>
        </div>
      </section>
    );

  return (
    <div className="flex flex-col gap-3">
      <section className={panel}>
        <h2 className={panelHead}>1. Choose a file</h2>
        <div className="p-4">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-black/20 px-4 py-7 text-center focus-within:ring-2 focus-within:ring-black/20 hover:bg-black/[0.02]",
            )}
          >
            <FileUp aria-hidden className="size-5 text-[#0B0B0C]/50" />
            <span className="mt-2 text-[13.5px] font-medium">
              {sheet ? sheet.name : "Choose a CSV file"}
            </span>
            <span className={`${hint} mt-1`}>
              {sheet
                ? `${sheet.rows.length} rows, ${sheet.headers.length} columns. Choose another to replace it.`
                : `A header row, then one lead per row. Up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows and 1 MB.`}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
          {problem && (
            <p role="alert" className="mt-3 text-[13px] text-[#B42318]">
              {problem}
            </p>
          )}
        </div>
      </section>

      {sheet && preview && (
        <>
          <section className={panel}>
            <h2 className={panelHead}>
              2. Match the columns
              <span className="text-[11.5px] font-normal text-[#0B0B0C]/50">
                We guessed from the headers. Change any that are wrong.
              </span>
            </h2>
            <div className="overflow-x-auto p-4">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="text-[11.5px] text-[#0B0B0C]/50">
                    <th scope="col" className="pb-2 font-medium">
                      Column in your file
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      First row
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      Goes into
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.headers.map((header, i) => (
                    <tr key={i} className="border-t border-black/[0.05]">
                      <td className="max-w-[200px] truncate py-2 pr-3 font-medium">
                        {header || `Column ${i + 1}`}
                      </td>
                      <td className="max-w-[220px] truncate py-2 pr-3 text-[#0B0B0C]/55">
                        {sheet.rows[0]?.[i] || "–"}
                      </td>
                      <td className="py-1.5">
                        <select
                          aria-label={`Field for ${header || `column ${i + 1}`}`}
                          value={mapping[i] ?? ""}
                          onChange={(e) =>
                            setColumn(i, e.target.value as ImportField | "")
                          }
                          className={cn(
                            input,
                            "h-8 w-[170px] py-0 text-[12.5px]",
                          )}
                        >
                          <option value="">Don&apos;t import</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {IMPORT_FIELD_LABEL[f]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!canContact && (
                <p role="alert" className="mt-3 text-[13px] text-[#B42318]">
                  Match a column to Email or Phone: every lead needs one of
                  them.
                </p>
              )}
            </div>
          </section>

          <section className={panel}>
            <h2 className={panelHead}>3. Check and import</h2>
            <div className="p-4">
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Ready to import", preview.leads.length],
                  ["Repeated in the file", preview.repeated],
                  [
                    "Rows with a problem",
                    new Set(preview.problems.map((p) => p.row)).size,
                  ],
                ].map(([text, n]) => (
                  <div
                    key={text}
                    className="rounded-xl border border-black/[0.07] px-2 py-3"
                  >
                    <dd className="text-[22px] leading-none font-medium tabular-nums">
                      {n}
                    </dd>
                    <dt className="mt-1.5 text-[11.5px] text-[#0B0B0C]/55">
                      {text}
                    </dt>
                  </div>
                ))}
              </dl>

              {preview.leads.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-xl border border-black/[0.07]">
                  <table className="w-full min-w-[560px] text-left text-[12.5px]">
                    <thead>
                      <tr className="border-b border-black/[0.06] text-[11.5px] text-[#0B0B0C]/50">
                        {["Name", "Email", "Phone", "Company", "Status"].map(
                          (h) => (
                            <th
                              key={h}
                              scope="col"
                              className="px-3 py-2 font-medium"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.leads.slice(0, 5).map((l) => (
                        <tr
                          key={l.row}
                          className="border-b border-black/[0.045] last:border-0"
                        >
                          <td className="max-w-[160px] truncate px-3 py-2">
                            {l.name || "–"}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2">
                            {l.email ?? "–"}
                          </td>
                          <td className="px-3 py-2">{l.phone ?? "–"}</td>
                          <td className="max-w-[160px] truncate px-3 py-2">
                            {l.company ?? "–"}
                          </td>
                          <td className="px-3 py-2">
                            {STATUS_LABEL[l.status]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.leads.length > 5 && (
                    <p className="border-t border-black/[0.05] px-3 py-2 text-[11.5px] text-[#0B0B0C]/45">
                      and {preview.leads.length - 5} more
                    </p>
                  )}
                </div>
              )}

              {preview.problems.length > 0 && (
                <details className="mt-3 text-[12.5px]">
                  <summary className="cursor-pointer text-[#0B0B0C]/65">
                    See what was wrong ({preview.problems.length})
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[#0B0B0C]/60">
                    {preview.problems.slice(0, 100).map((p, i) => (
                      <li key={i}>
                        Line {p.row}: {p.problem}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <p className={`${hint} mt-4`}>
                Leads already in this workspace (same email or phone) are
                skipped, not overwritten. Imported leads have no consent
                recorded: add it per lead when you have it.
              </p>
              {result && !result.ok && result.message && (
                <p role="alert" className="mt-3 text-[13px] text-[#B42318]">
                  {result.message}
                </p>
              )}
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={pending || preview.leads.length === 0}
                  onClick={run}
                  className={btn.primary}
                >
                  {pending
                    ? "Importing…"
                    : `Import ${preview.leads.length} ${preview.leads.length === 1 ? "lead" : "leads"}`}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
