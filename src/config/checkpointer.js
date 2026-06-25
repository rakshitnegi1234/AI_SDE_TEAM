import { MemorySaver } from "@langchain/langgraph";

let redisPackagePromise = null;

export async function createCheckpointer(options = {}) {
  const explicitCheckpointer = options.checkpointer;
  if (explicitCheckpointer) {
    return explicitCheckpointer;
  }

  const redisUrl = options.redisUrl || process.env.REDIS_URL;
  if (!redisUrl) {
    return new MemorySaver();
  }

  const { RedisSaver } = await loadRedisSaver();
  return RedisSaver.fromUrl(redisUrl);
}

async function loadRedisSaver() {
  if (!redisPackagePromise) {
    redisPackagePromise = import("@langchain/langgraph-checkpoint-redis");
  }

  return redisPackagePromise;
}
