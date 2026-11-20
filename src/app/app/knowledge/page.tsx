import type { Metadata } from "next";
import { Suspense } from "react";
import { BookOpen, FileText, Link2 } from "lucide-react";
import { getAppContext } from "@/lib/app/context";
import { ago } from "@/lib/app/time";
import type { KnowledgeItem } from "@/lib/app/types";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "../_ui/form";
import {
  Badge,
  ChannelTile,
  Empty,
  hint,
  input,
  labelCls,
  NotLive,
  PageHead,
  PageSkeleton,
  panel,
  panelHead,
} from "../_ui/kit";
import { deleteKnowledge, saveKnowledge } from "./actions";

export const metadata: Metadata = { title: "Knowledge" };

function Fields({
  item,
  kind,
}: {
  item?: KnowledgeItem;
  kind: "text" | "url";
}) {
  return (
    <>
      {item && <input type="hidden" name="item" value={item.id} />}
      <input type="hidden" name="kind" value={kind} />
      <label className={labelCls}>
        Title{" "}
        {kind === "url" && (
          <span className="font-normal text-[#0B0B0C]/45">(optional)</span>
        )}
        <input
          name="title"
          maxLength={200}
          required={kind === "text"}
          defaultValue={item?.title ?? ""}
          placeholder={kind === "text" ? "e.g. Pricing and plans" : ""}
          className={`${input} mt-1`}
        />
      </label>
      {kind === "text" ? (
        <label className={`${labelCls} mt-3`}>
          Text
          <textarea
            name="content"
            required
            rows={item ? 8 : 5}
            maxLength={100000}
            defaultValue={item?.content ?? ""}
            placeholder="Paste or write what your agents should know: prices, FAQs, how you qualify, how you handle objections."
            className={`${input} mt-1`}
          />
        </label>
      ) : (
        <label className={`${labelCls} mt-3`}>
          Web address
          <input
            name="content"
            required
            maxLength={2000}
            inputMode="url"
            defaultValue={item?.content ?? ""}
            placeholder="https://yourcompany.com/pricing"
            className={`${input} mt-1`}
          />
          <span className={`${hint} mt-1.5 block`}>
            The address is saved now. Dialvo doesn&apos;t read the page yet: it
            will be marked &quot;not fetched yet&quot; until that&apos;s built.
          </span>
        </label>
      )}
    </>
  );
}

function Item({ item }: { item: KnowledgeItem }) {
  const url = item.kind === "url";
  return (
    <li className="border-b border-black/[0.05] last:border-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-black/[0.02] [&::-webkit-details-marker]:hidden">
          <ChannelTile icon={url ? Link2 : FileText} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[13.5px] font-medium">
                {item.title}
              </span>
              {item.status === "not_fetched" && (
                <NotLive>Not fetched yet</NotLive>
              )}
              {item.kind === "file" && <Badge>File</Badge>}
            </span>
            <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.45] text-[#0B0B0C]/55">
              {item.content}
            </span>
          </span>
          <span className="shrink-0 pt-0.5 text-[11.5px] text-[#0B0B0C]/40">
            {ago(item.updated_at)}
            <span className="ml-2 text-[#0B0B0C]/60 group-open:hidden">
              Edit
            </span>
          </span>
        </summary>
        <div className="border-t border-black/[0.05] bg-black/[0.015] px-4 py-4">
          {item.kind === "file" ? (
            <p className={hint}>File items can&apos;t be edited here yet.</p>
          ) : (
            <ActionForm action={saveKnowledge}>
              <Fields item={item} kind={url ? "url" : "text"} />
              <div className="mt-3 flex justify-end">
                <SubmitButton variant="secondary">Save changes</SubmitButton>
              </div>
            </ActionForm>
          )}
          <ActionForm
            action={deleteKnowledge}
            confirm={`Delete "${item.title}"? Your agents will no longer be able to use it.`}
            className="mt-1"
          >
            <input type="hidden" name="item" value={item.id} />
            <SubmitButton
              variant="ghost"
              small
              pendingText="Deleting…"
              className="text-[#B42318]"
            >
              Delete
            </SubmitButton>
          </ActionForm>
        </div>
      </details>
    </li>
  );
}

async function Knowledge() {
  const { repo } = await getAppContext();
  const items = await repo.knowledge();
  return (
    <>
      <PageHead
        title="Knowledge"
        note="What your agents know about your business. They answer from this, and say they'll check when something isn't here."
      >
        <NotLive>Agents don&apos;t read this yet</NotLive>
      </PageHead>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className={cn(panel, "overflow-hidden")}>
          <h2 className={panelHead}>
            Items
            <span className="text-[11.5px] font-normal text-[#0B0B0C]/50 tabular-nums">
              {items.length}
            </span>
          </h2>
          {items.length === 0 ? (
            <Empty icon={BookOpen} title="Nothing here yet">
              Start with your prices and the five questions leads ask most.
              Short and specific beats long and vague.
            </Empty>
          ) : (
            <ul>
              {items.map((item) => (
                <Item key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-3">
          <section className={panel}>
            <h2 className={panelHead}>Add text</h2>
            <ActionForm action={saveKnowledge} resetOnSuccess className="p-4">
              <Fields kind="text" />
              <div className="mt-3 flex justify-end">
                <SubmitButton pendingText="Adding…">Add text</SubmitButton>
              </div>
            </ActionForm>
          </section>
          <section className={panel}>
            <h2 className={panelHead}>Add a web page</h2>
            <ActionForm action={saveKnowledge} resetOnSuccess className="p-4">
              <Fields kind="url" />
              <div className="mt-3 flex justify-end">
                <SubmitButton pendingText="Adding…" variant="secondary">
                  Add address
                </SubmitButton>
              </div>
            </ActionForm>
          </section>
          <p className={`${hint} px-1`}>
            File uploads (PDFs, documents, call transcripts) come in a later
            release.
          </p>
        </div>
      </div>
    </>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Knowledge />
    </Suspense>
  );
}
