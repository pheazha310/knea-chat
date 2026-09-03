/**
 * Redis client (optional) with an in-memory fallback.
 *
 * Redis is used for:
 *   - dashboard / attendance cache (short TTL)
 *   - WebSocket pub/sub fan-out across server instances
 *   - temporary attendance state (e.g. "currently on break")
 *
 * MySQL remains the permanent source of truth. If Redis is unreachable
 * (REDIS_HOST not set, connection refused, …) every call transparently falls
 * back to process-local storage, so the feature keeps working on a single
 * instance without Redis. When Redis IS running, multi-instance deployments
 * get pub/sub fan-out and shared caching for free.
 *
 * Never expose credentials to the frontend — this module only ever runs on
 * the server.
 */
import { EventEmitter } from 'events';

const ATTENDANCE_CHANNEL = 'attendance:events';

interface PubSubMessage {
  channel: string;
  message: string;
}

class RedisClient {
  private client: import('redis').RedisClientType | null = null;
  private subscriber: import('redis').RedisClientType | null = null;
  private available = false;
  private connecting: Promise<void> | null = null;
  private readonly instanceId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  /** In-memory fallback pub/sub bus (used when Redis is unavailable). */
  private memoryBus = new EventEmitter();
  private memoryCache = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    void this.connect();
  }

  /** Unique id of this server instance — used to ignore our own pub/sub echo. */
  getInstanceId(): string {
    return this.instanceId;
  }

  private get url(): string {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    const password = process.env.REDIS_PASSWORD;
    const auth = password ? `:${encodeURIComponent(password)}@` : '';
    return `redis://${auth}${host}:${port}`;
  }

  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        const redis = await import('redis');
        const options = {
          url: this.url,
          socket: { connectTimeout: 1500, reconnectStrategy: () => 5000 },
        };
        const client = redis.createClient(options) as import('redis').RedisClientType;
        const subscriber = client.duplicate();

        await Promise.all([
          client.connect(),
          subscriber.connect(),
        ]);
        this.client = client;
        this.subscriber = subscriber;
        this.available = true;

        // Fan attendance events out to the local WebSocket connections when
        // they arrive from another server instance via Redis.
        await subscriber.subscribe(ATTENDANCE_CHANNEL, (message: string) => {
          this.memoryBus.emit(ATTENDANCE_CHANNEL, { channel: ATTENDANCE_CHANNEL, message });
        });

        console.log('✅ Redis connected — attendance cache & pub/sub active');
      } catch (error) {
        this.available = false;
        this.client = null;
        this.subscriber = null;
        console.warn(`⚠️  Redis unavailable (${(error as Error).message}) — using in-memory fallback`);
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  isAvailable(): boolean {
    return this.available;
  }

  // -------------------------------------------------------------------------
  // Cache (string values with TTL)
  // -------------------------------------------------------------------------
  async get(key: string): Promise<string | null> {
    if (this.available && this.client) {
      try {
        return await this.client.get(key);
      } catch {
        // fall through to memory
      }
    }
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.available && this.client) {
      try {
        await this.client.set(key, value, { EX: ttlSeconds });
        return;
      } catch {
        // fall through to memory
      }
    }
    this.memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    if (this.available && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch {
        // fall through to memory
      }
    }
    this.memoryCache.delete(key);
  }

  // -------------------------------------------------------------------------
  // Pub / Sub
  // -------------------------------------------------------------------------
  async publish(channel: string, message: string): Promise<void> {
    if (this.available && this.client) {
      try {
        await this.client.publish(channel, message);
        return;
      } catch {
        // fall through to memory
      }
    }
    this.memoryBus.emit(channel, { channel, message });
  }

  /** Subscribe to a channel. Returns an unsubscribe function. */
  async subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    // When Redis is available the subscriber already routes ATTENDANCE_CHANNEL
    // into the memory bus (see connect()), so one code path serves both.
    const listener = (payload: PubSubMessage) => {
      if (payload.channel === channel) handler(payload.message);
    };
    this.memoryBus.on(channel, listener);
    if (this.available && this.subscriber && channel !== ATTENDANCE_CHANNEL) {
      try {
        await this.subscriber.subscribe(channel, (message: string) => {
          handler(message);
        });
      } catch {
        // memory fallback already registered
      }
    }
    return () => {
      this.memoryBus.off(channel, listener);
    };
  }
}

export const redisClient = new RedisClient();
export { ATTENDANCE_CHANNEL };