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
import {
  addKnowledgePage,
  deleteKnowledge,
  refreshKnowledgePage,
  saveKnowledge,
} from "./actions";

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
            This page hasn&apos;t been read yet, so your agents can&apos;t use
            it. Press &quot;Read the page now&quot; below.
          </span>
        </label>
      )}
    </>
  );
}

function Item({ item }: { item: KnowledgeItem }) {
  const url = item.kind === "url";
  // A page whose text has been read is edited like any other text.
  const fetched = url && item.source_url !== null;
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
              <Fields item={item} kind={url && !fetched ? "url" : "text"} />
              <div className="mt-3 flex justify-end">
                <SubmitButton variant="secondary">Save changes</SubmitButton>
              </div>
            </ActionForm>
          )}
          {url && (
            <ActionForm
              action={refreshKnowledgePage}
              className="mt-3 border-t border-black/[0.06] pt-3"
            >
              <input type="hidden" name="item" value={item.id} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`${hint} min-w-0 flex-1 break-all`}>
                  {fetched
                    ? `Read from ${item.source_url}. Reading it again replaces the text above, including your edits.`
                    : "Dialvo fetches the page and keeps its readable text."}
                </p>
                <SubmitButton variant="secondary" small pendingText="Reading…">
                  {fetched ? "Read again" : "Read the page now"}
                </SubmitButton>
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
        note="What your agents know about your business. The inbound agent answers website chats from this and nothing else, and offers a person when the answer isn't here."
      />
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
            <h2 className={panelHead}>Add from a web page</h2>
            <ActionForm
              action={addKnowledgePage}
              resetOnSuccess
              className="p-4"
            >
              <label className={labelCls}>
                Web address
                <input
                  name="url"
                  required
                  maxLength={2000}
                  inputMode="url"
                  placeholder="https://yourcompany.com/pricing"
                  className={`${input} mt-1`}
                />
              </label>
              <label className={`${labelCls} mt-3`}>
                Title{" "}
                <span className="font-normal text-[#0B0B0C]/45">
                  (optional)
                </span>
                <input
                  name="title"
                  maxLength={200}
                  className={`${input} mt-1`}
                />
              </label>
              <p className={`${hint} mt-2`}>
                Dialvo reads the page once and keeps its text (up to about
                20,000 characters), which you can then edit. Public https pages
                only. Pages drawn by JavaScript may come back empty.
              </p>
              <div className="mt-3 flex justify-end">
                <SubmitButton
                  pendingText="Reading the page…"
                  variant="secondary"
                >
                  Add page
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
