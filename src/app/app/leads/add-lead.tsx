"use client";

import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { ActionForm, SubmitButton } from "../_ui/form";
import { btn, hint, input, labelCls } from "../_ui/kit";
import { addLead } from "./actions";

/** "Add lead": a button that opens a small dialog with the form. */
export function AddLead() {
  const dialog = useRef<HTMLDialogElement>(null);
  // Close on a click on the backdrop, and when the page is left.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const click = (event: MouseEvent) => {
      if (event.target === el) el.close();
    };
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("click", click);
      // Next.js keeps the page it navigated away from, hidden. A modal left
      // open there would keep the whole document inert, so close it.
      el.close();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className={btn.primary}
        onClick={() => dialog.current?.showModal()}
      >
        <Plus aria-hidden className="size-3.5" />
        Add lead
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="add-lead-title"
        className="m-auto w-[min(92vw,460px)] rounded-3xl border border-black/10 bg-white p-0 text-[#0B0B0C] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)] backdrop:bg-black/30"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 id="add-lead-title" className="text-[16px] font-medium">
              Add a lead
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialog.current?.close()}
              className="grid size-8 place-items-center rounded-full hover:bg-black/[0.06]"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <ActionForm action={addLead} className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                Name
                <input
                  name="name"
                  maxLength={200}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Company
                <input
                  name="company"
                  maxLength={200}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Email
                <input
                  name="email"
                  type="email"
                  maxLength={254}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={labelCls}>
                Phone
                <input
                  name="phone"
                  type="tel"
                  maxLength={40}
                  className={`${input} mt-1`}
                />
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                Website
                <input
                  name="website"
                  maxLength={300}
                  className={`${input} mt-1`}
                />
              </label>
            </div>
            <p className={`${hint} mt-3`}>
              An email or a phone number is needed. No consent is recorded: add
              it on the lead&apos;s page if they&apos;ve agreed to be contacted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={btn.ghost}
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <SubmitButton pendingText="Adding…">Add lead</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
