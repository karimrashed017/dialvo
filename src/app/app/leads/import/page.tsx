import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "../../_ui/kit";
import { Importer } from "./importer";

export const metadata: Metadata = { title: "Import leads" };

export default function ImportPage() {
  return (
    <>
      <Link
        href="/app/leads"
        className="mb-3 inline-flex items-center gap-1.5 px-1 text-[12.5px] text-[#0B0B0C]/55 hover:text-[#0B0B0C]"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Leads
      </Link>
      <PageHead
        title="Import leads"
        note="Upload a CSV from your CRM or a spreadsheet, match its columns, and check the result before anything is saved."
      />
      <Importer />
    </>
  );
}
