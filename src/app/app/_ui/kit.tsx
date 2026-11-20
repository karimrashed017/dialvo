import {
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  Share2,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  type Channel,
  type LeadStatus,
} from "@/lib/app/types";
import { cn } from "@/lib/utils";

// The app's few building blocks, in the look of the example dashboard on the
// home page: white panels with a hairline on paper, ink text, 12-13px type,
// and the logo's blue only for what is live or needs attention.

export const panel =
  "flex min-w-0 flex-col rounded-2xl border border-black/[0.07] bg-white";
export const panelHead =
  "flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-2 text-[13px] font-medium";

const focus =
  "focus-visible:ring-2 focus-visible:ring-black/40 focus-visible:outline-none";

const btnBase = cn(
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-55",
  focus,
);
export const btn = {
  primary: cn(btnBase, "bg-[#0B0B0C] text-white hover:bg-black/85"),
  secondary: cn(
    btnBase,
    "border border-black/15 bg-white text-[#0B0B0C] hover:bg-black/[0.04]",
  ),
  ghost: cn(btnBase, "text-[#0B0B0C]/70 hover:bg-black/[0.05]"),
  danger: cn(
    btnBase,
    "border border-[#B42318]/30 bg-white text-[#B42318] hover:bg-[#B42318]/[0.06]",
  ),
  small: "h-8 px-3 text-[12.5px]",
};

export const input =
  "w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] text-[#0B0B0C] outline-none placeholder:text-[#0B0B0C]/35 focus:border-[#1F3BFF] focus:ring-2 focus:ring-[#1F3BFF]/20 disabled:bg-black/[0.03] disabled:text-[#0B0B0C]/50";
export const labelCls = "block text-[12.5px] font-medium text-[#0B0B0C]/75";
export const hint = "text-[12px] leading-[1.45] text-[#0B0B0C]/50";
export const mutedText = "text-[#0B0B0C]/55";

export function PageHead({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1">
      <div className="min-w-0">
        <h1 className="text-[19px] font-medium tracking-[-0.01em]">{title}</h1>
        {note && (
          <p className="mt-0.5 max-w-[640px] text-[13px] leading-[1.5] text-[#0B0B0C]/55">
            {note}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="grid size-10 place-items-center rounded-xl border border-black/[0.08] bg-white">
          <Icon aria-hidden className="size-[18px] text-[#0B0B0C]/60" />
        </span>
      )}
      <p className="mt-3 text-[14px] font-medium">{title}</p>
      {children && (
        <p className="mt-1 max-w-[380px] text-[13px] leading-[1.5] text-[#0B0B0C]/55">
          {children}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "plain",
  className,
}: {
  children: React.ReactNode;
  tone?: "plain" | "ink" | "blue" | "warn" | "outline";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap",
        tone === "plain" && "bg-black/[0.055] text-[#0B0B0C]/75",
        tone === "ink" && "bg-[#0B0B0C] text-white",
        tone === "blue" && "bg-[#1F3BFF]/[0.09] text-[#1F3BFF]",
        tone === "warn" && "bg-[#B42318]/[0.08] text-[#B42318]",
        tone === "outline" && "border border-black/15 text-[#0B0B0C]/60",
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<LeadStatus, "plain" | "ink" | "blue" | "outline"> = {
  new: "blue",
  engaged: "plain",
  qualified: "plain",
  meeting_booked: "ink",
  won: "ink",
  lost: "outline",
  unsubscribed: "outline",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  voice: Phone,
  email: Mail,
  chat: MessageCircle,
  social: Share2,
  sms: Smartphone,
  whatsapp: MessageSquareText,
};

/** The channel's icon in a small tile, as in the activity feed. */
export function ChannelTile({
  channel,
  icon,
}: {
  channel?: Channel | null;
  icon?: LucideIcon;
}) {
  const Icon = icon ?? (channel ? CHANNEL_ICON[channel] : MessageCircle);
  return (
    <span
      title={channel ? CHANNEL_LABEL[channel] : undefined}
      className="grid size-7 shrink-0 place-items-center rounded-lg border border-black/[0.08] bg-white"
    >
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** Says plainly that something is saved but doesn't act yet. */
export function NotLive({ children = "Not live yet" }: { children?: string }) {
  return <Badge tone="outline">{children}</Badge>;
}

/** A loading placeholder the size of a page's content. */
export function PageSkeleton() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="mb-4 h-7 w-40 rounded-lg bg-black/[0.06]" />
      <div className="grid gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] rounded-2xl bg-black/[0.045]" />
        ))}
      </div>
      <div className="mt-3 h-[320px] rounded-2xl bg-black/[0.045]" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** A person's or a lead's initial in a circle. */
export function Initial({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-[#0B0B0C] text-[11.5px] font-medium text-white uppercase",
        className,
      )}
    >
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

/** What to call a lead with no name. */
export function leadLabel(lead: {
  name: string;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
}): string {
  return (
    lead.name || lead.company || lead.email || lead.phone || "Unnamed lead"
  );
}
