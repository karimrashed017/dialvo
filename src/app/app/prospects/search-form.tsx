"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { Brief } from "@/lib/prospects/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import { btn, hint, labelCls } from "../_ui/kit";
import { saveSearch, suggestSearch } from "./actions";
import { field } from "./ui";

type Values = Brief & { name: string };

const EMPTY: Values = {
  name: "",
  description: "",
  location: "",
  company_size: "",
  exclusions: "",
};

/**
 * "Who you sell to": the description a search works from. With nothing
 * saved yet, it asks once for a suggestion drawn from the workspace's
 * knowledge; the person edits it and saves.
 */
export function SearchForm({
  search,
  canSuggest,
  suggestOnOpen,
}: {
  search: (Values & { id: string }) | null;
  /** False when the server can't call the model (keys not set). */
  canSuggest: boolean;
  /** Ask for a suggestion straight away: the workspace has no search yet. */
  suggestOnOpen: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(search ?? EMPTY);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [suggesting, start] = useTransition();
  const asked = useRef(false);

  const suggest = () =>
    start(async () => {
      let result: Awaited<ReturnType<typeof suggestSearch>>;
      try {
        result = await suggestSearch();
      } catch {
        result = { ok: false, message: "Couldn't reach Dialvo. Try again." };
      }
      if (result.suggestion) setValues(result.suggestion);
      setNote(result.message ? { ok: result.ok, text: result.message } : null);
    });

  useEffect(() => {
    if (!suggestOnOpen || !canSuggest || asked.current) return;
    asked.current = true;
    suggest();
    // Once, when the empty form first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set =
    (key: keyof Values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((v) => ({ ...v, [key]: event.target.value }));

  return (
    <ActionForm
      action={saveSearch}
      onDone={(result) => {
        // A new search answers with its id: move to it.
        if (result.ok && !search && result.field)
          router.replace(`/app/prospects?search=${result.field}`);
      }}
    >
      {search && <input type="hidden" name="search" value={search.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label htmlFor="ps-description" className={labelCls}>
              Who do you sell to?
            </label>
            {canSuggest && (
              <button
                type="button"
                onClick={suggest}
                disabled={suggesting}
                className={cn(btn.ghost, btn.small, "-my-1")}
              >
                <Sparkles aria-hidden className="size-3.5" />
                {suggesting
                  ? "Reading your Knowledge…"
                  : "Suggest from what we sell"}
              </button>
            )}
          </div>
          <textarea
            id="ps-description"
            name="description"
            required
            rows={3}
            maxLength={2000}
            value={values.description}
            onChange={set("description")}
            placeholder="The kind of business, in your own words. For example: independent dental clinics that take private patients."
            className={cn(field, "mt-1.5")}
          />
          {note && (
            <p
              role={note.ok ? "status" : "alert"}
              className={cn("mt-1.5", hint, !note.ok && "text-[#B42318]")}
            >
              {note.text}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ps-location" className={labelCls}>
            Where{" "}
            <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          </label>
          <input
            id="ps-location"
            name="location"
            maxLength={200}
            value={values.location}
            onChange={set("location")}
            placeholder="A town, region or country"
            className={cn(field, "mt-1.5")}
          />
        </div>
        <div>
          <label htmlFor="ps-size" className={labelCls}>
            Size{" "}
            <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          </label>
          <input
            id="ps-size"
            name="company_size"
            maxLength={200}
            value={values.company_size}
            onChange={set("company_size")}
            placeholder="For example: 5 to 50 staff, single site"
            className={cn(field, "mt-1.5")}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ps-exclusions" className={labelCls}>
            Leave out{" "}
            <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          </label>
          <input
            id="ps-exclusions"
            name="exclusions"
            maxLength={1000}
            value={values.exclusions}
            onChange={set("exclusions")}
            placeholder="Who not to include. For example: national chains, NHS-only practices"
            className={cn(field, "mt-1.5")}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ps-name" className={labelCls}>
            Name this search{" "}
            <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
          </label>
          <input
            id="ps-name"
            name="name"
            maxLength={120}
            value={values.name}
            onChange={set("name")}
            placeholder="So you can find it again"
            className={cn(field, "mt-1.5")}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <SubmitButton variant={search ? "secondary" : "primary"}>
          {search ? "Save changes" : "Save"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
