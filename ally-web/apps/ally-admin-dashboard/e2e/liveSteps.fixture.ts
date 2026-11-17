import type { Page } from "@playwright/test";

/** The slowed message stream for the live-steps tests (chunk 6b). */
export type Frame = { event: string; data: unknown; after?: number };

export const BOOKED = {
  reply: "Done: you're booked for Thursday 19 Nov at 11:00 with Dr Rao.",
  citations: [{ title: "Appointments · Thu 19 Nov 2026, 11:00", url: null }],
  messageId: "m2",
  conversationId: "c1",
  rateable: true,
  steps: [
    { kind: "find", label: "Slots" },
    { kind: "create", label: "Thu 19 Nov 2026, 11:00" },
  ],
  confirmation: {
    action: "create",
    list: "Appointments",
    title: "Thu 19 Nov 2026, 11:00",
    details: [
      { label: "Service", value: "Individual therapy" },
      { label: "Status", value: "booked" },
    ],
  },
};

export const CRISIS = {
  reply:
    "If this is an emergency, call 112 or an ambulance (108) now. If you're thinking of harming yourself, call Tele-MANAS 14416.",
  citations: [],
  messageId: "m3",
  conversationId: "c1",
  rateable: false,
};

/** Replace the stream with a slowed one; `window.__release()` lets the reply through. */
export async function slowStream(page: Page, frames: Frame[], final: unknown) {
  await page.addInitScript(
    ({ frames, final }) => {
      const realFetch = window.fetch.bind(window);
      let release: () => void = () => undefined;
      const released = new Promise<void>(r => (release = r));
      (window as unknown as { __release: () => void }).__release = () => release();
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (!url.includes("/messages/stream")) return realFetch(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          async start(controller) {
            for (const frame of frames) {
              await new Promise(r => setTimeout(r, frame.after ?? 0));
              controller.enqueue(
                encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`),
              );
            }
            await released;
            controller.enqueue(encoder.encode(`event: final\ndata: ${JSON.stringify(final)}\n\n`));
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      };
    },
    { frames, final },
  );
}

export const release = (page: Page) =>
  page.evaluate(() => (window as unknown as { __release: () => void }).__release());
