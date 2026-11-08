import { STATUS_LABELS, type Status } from "../shared/types.ts";

export interface Notifier {
  enabled: boolean;
  ticketStatus(key: string, title: string, status: Status): Promise<void>;
}

/** ntfy push with the ticket title and status only, never ticket content. */
export function ntfyNotifier(topic: string | undefined, server = "https://ntfy.sh"): Notifier {
  return {
    enabled: !!topic,
    async ticketStatus(key, title, status) {
      if (!topic) return;
      const url = `${server.replace(/\/$/, "")}/${encodeURIComponent(topic)}`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            body: `${key} ${title}`.slice(0, 200),
            headers: { Title: `Relay: ${STATUS_LABELS[status]}`, Tags: status === "blocked" ? "warning" : "white_check_mark" },
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) return;
          console.error(`[relay] ntfy push failed: HTTP ${res.status}`);
        } catch (err) {
          console.error(`[relay] ntfy push failed: ${(err as Error).message}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
  };
}
