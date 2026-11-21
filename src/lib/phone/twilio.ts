import "server-only";

// Twilio's REST API, as Dialvo uses it: find, price, buy and release
// numbers; place a call; start a recording; send a text; fetch a recording.
// One account (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN) holds every
// workspace's numbers. Requests are plain fetch with basic auth; the token
// never appears in an error, a log or a message. Twilio's own error text is
// cut short and stripped before anyone sees it.

const API = "https://api.twilio.com/2010-04-01";
const PRICING = "https://pricing.twilio.com/v1";
const TIMEOUT_MS = 10_000;

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message);
  }
}

export type TwilioCredentials = { accountSid: string; authToken: string };

export function twilioCredentials(
  env: Record<string, string | undefined> = process.env,
): TwilioCredentials | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  if (!/^AC[0-9a-f]{32}$/.test(accountSid) || !authToken) return null;
  return { accountSid, authToken };
}

export type AvailableNumber = {
  e164: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
  sms: boolean;
  voice: boolean;
};

export type NumberPrice = { monthly: number; currency: string };

export interface Twilio {
  searchNumbers(
    country: string,
    areaCode: string | null,
  ): Promise<AvailableNumber[]>;
  localNumberPrice(country: string): Promise<NumberPrice | null>;
  buyNumber(
    e164: string,
    hooks: { voiceUrl: string; statusUrl: string; smsUrl: string },
    label: string,
  ): Promise<{ sid: string }>;
  releaseNumber(sid: string): Promise<void>;
  createCall(o: {
    to: string;
    from: string;
    url: string;
    statusUrl: string;
    record: boolean;
    timeLimitSeconds: number;
  }): Promise<{ sid: string }>;
  startRecording(callSid: string, statusUrl: string): Promise<void>;
  sendSms(o: {
    to: string;
    from: string;
    messagingServiceSid: string | null;
    body: string;
    statusUrl: string;
  }): Promise<{ sid: string }>;
  recordingAudio(recordingSid: string): Promise<Response>;
}

const clean = (raw: unknown, token: string) => {
  let text = typeof raw === "string" ? raw : "";
  if (token) text = text.split(token).join("[token]");
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
};

export function createTwilio(
  credentials: TwilioCredentials,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Twilio {
  const { accountSid, authToken } = credentials;
  const auth =
    "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const account = `${API}/Accounts/${accountSid}`;

  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    url: string,
    form?: Record<string, string | undefined>,
  ): Promise<T> {
    const body = form
      ? new URLSearchParams(
          Object.entries(form).filter(
            (e): e is [string, string] => e[1] !== undefined,
          ),
        )
      : undefined;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new TwilioError("Twilio didn't answer in time.", 0, null);
    }
    if (response.status === 204) return undefined as T;
    let json: Record<string, unknown> = {};
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      // Not JSON: keep the status alone.
    }
    if (!response.ok) {
      const code = typeof json.code === "number" ? json.code : null;
      const message =
        response.status === 401
          ? "Twilio refused Dialvo's credentials."
          : clean(json.message, authToken) ||
            `Twilio answered ${response.status}.`;
      throw new TwilioError(message, response.status, code);
    }
    return json as T;
  }

  return {
    async searchNumbers(country, areaCode) {
      const q = new URLSearchParams({
        VoiceEnabled: "true",
        SmsEnabled: "true",
        PageSize: "10",
      });
      if (areaCode) q.set("AreaCode", areaCode);
      const data = await request<{
        available_phone_numbers?: Record<string, unknown>[];
      }>(
        "GET",
        `${account}/AvailablePhoneNumbers/${encodeURIComponent(country)}/Local.json?${q}`,
      );
      return (data.available_phone_numbers ?? [])
        .map((n) => ({
          e164: String(n.phone_number ?? ""),
          friendlyName: String(n.friendly_name ?? n.phone_number ?? ""),
          locality:
            typeof n.locality === "string" && n.locality ? n.locality : null,
          region: typeof n.region === "string" && n.region ? n.region : null,
          sms: Boolean(
            (n.capabilities as Record<string, unknown> | undefined)?.SMS ??
            (n.capabilities as Record<string, unknown> | undefined)?.sms,
          ),
          voice: Boolean(
            (n.capabilities as Record<string, unknown> | undefined)?.voice,
          ),
        }))
        .filter((n) => /^\+[1-9]\d{6,14}$/.test(n.e164));
    },

    async localNumberPrice(country) {
      const data = await request<{
        price_unit?: string;
        phone_number_prices?: {
          number_type?: string;
          current_price?: string;
          base_price?: string;
        }[];
      }>(
        "GET",
        `${PRICING}/PhoneNumbers/Countries/${encodeURIComponent(country)}`,
      );
      const local = data.phone_number_prices?.find(
        (p) => p.number_type === "local",
      );
      const monthly = Number(local?.current_price ?? local?.base_price);
      if (!local || !Number.isFinite(monthly)) return null;
      return { monthly, currency: (data.price_unit ?? "USD").toUpperCase() };
    },

    async buyNumber(e164, hooks, label) {
      const data = await request<{ sid?: string }>(
        "POST",
        `${account}/IncomingPhoneNumbers.json`,
        {
          PhoneNumber: e164,
          FriendlyName: label.slice(0, 64),
          VoiceUrl: hooks.voiceUrl,
          VoiceMethod: "POST",
          StatusCallback: hooks.statusUrl,
          StatusCallbackMethod: "POST",
          SmsUrl: hooks.smsUrl,
          SmsMethod: "POST",
        },
      );
      if (!data.sid || !/^PN[0-9a-f]{32}$/.test(data.sid))
        throw new TwilioError("Twilio didn't return the number.", 502, null);
      return { sid: data.sid };
    },

    async releaseNumber(sid) {
      await request(
        "DELETE",
        `${account}/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`,
      );
    },

    async createCall(o) {
      const data = await request<{ sid?: string }>(
        "POST",
        `${account}/Calls.json`,
        {
          To: o.to,
          From: o.from,
          Url: o.url,
          Method: "POST",
          StatusCallback: o.statusUrl,
          StatusCallbackMethod: "POST",
          StatusCallbackEvent: "completed",
          // An answering machine is hung up on, not spoken to.
          MachineDetection: "Enable",
          Timeout: "25",
          TimeLimit: String(o.timeLimitSeconds),
          Record: o.record ? "true" : undefined,
          RecordingStatusCallback: o.record ? o.statusUrl : undefined,
        },
      );
      if (!data.sid || !/^CA[0-9a-f]{32}$/.test(data.sid))
        throw new TwilioError("Twilio didn't return the call.", 502, null);
      return { sid: data.sid };
    },

    async startRecording(callSid, statusUrl) {
      await request(
        "POST",
        `${account}/Calls/${encodeURIComponent(callSid)}/Recordings.json`,
        {
          RecordingStatusCallback: statusUrl,
          RecordingStatusCallbackMethod: "POST",
        },
      );
    },

    async sendSms(o) {
      const data = await request<{ sid?: string }>(
        "POST",
        `${account}/Messages.json`,
        {
          To: o.to,
          From: o.messagingServiceSid ? undefined : o.from,
          MessagingServiceSid: o.messagingServiceSid ?? undefined,
          Body: o.body,
          StatusCallback: o.statusUrl,
        },
      );
      if (!data.sid || !/^(SM|MM)[0-9a-f]{32}$/.test(data.sid))
        throw new TwilioError("Twilio didn't return the message.", 502, null);
      return { sid: data.sid };
    },

    async recordingAudio(recordingSid) {
      return fetchImpl(
        `${account}/Recordings/${encodeURIComponent(recordingSid)}.mp3`,
        {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
    },
  };
}
