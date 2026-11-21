import type { JobNotification, JobPublisher } from "../../src/services/job-publication.service.js";
import { jobRequestSchema } from "../../src/services/job-request.js";

type Delivery = { notification: JobNotification; availableAt: number };
// Test-only transport with a logical clock. No endpoint, provider or background
// loop. Receiving/acknowledging a notification does NOT imply job completion.
export class LocalNotifications implements JobPublisher {
  now = 0;
  published: JobNotification[] = [];
  received: JobNotification[] = [];
  acknowledged: string[] = [];
  lostDeliveries = 0;
  pending: Delivery[] = [];
  mode: "accept" | "reject" | "accept-response-lost" = "accept";
  copies = 1;
  delay = 0;
  async publish(notification: JobNotification) {
    if (this.mode === "reject") throw Error("SIMULATED_PUBLICATION_FAILURE");
    this.published.push(structuredClone(notification));
    for (let n = 0; n < this.copies; n++) this.pending.push({ notification: structuredClone(notification), availableAt: this.now + this.delay });
    if (this.mode === "accept-response-lost") throw Error("SIMULATED_PUBLICATION_RESPONSE_LOST");
  }
  advance(ms: number) { this.now += ms; }
  reverse() { this.pending.reverse(); }
  // A lost delivery remains in the durable simulated transport until retried.
  loseNextDelivery() { const item = this.pending.shift(); if (item) { this.lostDeliveries++; this.pending.push({ ...item, availableAt: this.now + 1000 }); } }
  async drain(process: (request: unknown) => Promise<void>, workers = 1, loseAck = false) {
    const due = this.pending.filter(v => v.availableAt <= this.now); this.pending = this.pending.filter(v => v.availableAt > this.now);
    let index = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      for (;;) {
        const item = due[index++]; if (!item) return;
        this.received.push(structuredClone(item.notification));
        const { kind, jobId, phase } = item.notification;
        try {
          await process(jobRequestSchema.parse({ kind, jobId, phase }));
          if (loseAck) this.pending.push({ ...item, availableAt: this.now + 1000 });
          else this.acknowledged.push(item.notification.notificationId);
        } catch { this.pending.push({ ...item, availableAt: this.now + 1000 }); }
      }
    }));
  }
}
