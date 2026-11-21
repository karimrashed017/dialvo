import { cn } from "@/lib/utils";
import { hint, input, labelCls } from "../_ui/kit";

// Where a list's rows come from: a CSV, a Find leads search, the leads, a
// saved audience or the CRM-linked leads. Used to make a list and to add
// more rows to one.

export function NewListFields({
  searches,
  audiences,
}: {
  searches: { id: string; name: string }[];
  audiences: { id: string; name: string }[];
}) {
  const radio = "size-4 accent-[#0B0B0C]";
  return (
    <fieldset className="space-y-2">
      <legend className={labelCls}>Rows from</legend>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="radio"
          name="source"
          value="csv"
          defaultChecked
          className={cn(radio, "mt-0.5")}
        />
        <span className="min-w-0 flex-1">
          A CSV file
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full text-[12.5px]"
          />
          <span className={cn(hint, "block")}>
            Columns such as name, title, company, website, email, LinkedIn,
            country and size are recognised; others are kept as they are.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="radio"
          name="source"
          value="find_leads"
          className={cn(radio, "mt-0.5")}
        />
        <span className="min-w-0 flex-1">
          A Find leads search&apos;s results
          <select
            name="search_id"
            defaultValue=""
            className={cn(input, "mt-1")}
          >
            <option value="">Choose a search</option>
            {searches.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name="source" value="leads" className={radio} />
        All your leads
      </label>
      {audiences.length > 0 && (
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="radio"
            name="source"
            value="audience"
            className={cn(radio, "mt-0.5")}
          />
          <span className="min-w-0 flex-1">
            A saved audience
            <select
              name="audience_id"
              defaultValue=""
              className={cn(input, "mt-1")}
            >
              <option value="">Choose an audience</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name="source" value="crm" className={radio} />
        Leads linked to your CRM
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="radio" name="source" value="manual" className={radio} />
        Nothing yet
      </label>
    </fieldset>
  );
}
