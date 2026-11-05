export type PubSubRuntime = { publish: (topic: string, data: unknown, attributes?: Record<string,string>) => Promise<string>; subscribe: (subscription: string, handler: (data: unknown, attributes: Record<string,string>) => Promise<void>) => Promise<() => void> };

export async function createPubSubRuntime(): Promise<PubSubRuntime | null> {
  if (!process.env.GOOGLE_CLOUD_PROJECT && !process.env.GCP_PROJECT) return null;
  const { PubSub } = await import("@google-cloud/pubsub");
  const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT });
  return {
    async publish(topic, data, attributes = {}) {
      const messageId = await pubsub.topic(topic).publishMessage({ data: Buffer.from(JSON.stringify(data)), attributes });
      return messageId;
    },
    async subscribe(subscriptionName, handler) {
      const sub = pubsub.subscription(subscriptionName);
      const onMessage = async (message: any) => { try { await handler(JSON.parse(message.data.toString()), message.attributes ?? {}); message.ack(); } catch (e) { console.error("[PubSub] handler failed", e); message.nack(); } };
      sub.on("message", onMessage);
      return () => sub.removeListener("message", onMessage);
    },
  };
}
