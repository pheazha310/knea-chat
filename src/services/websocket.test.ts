/// <reference types="jest" />
import { wsService } from './websocket';
import type { ConnectionStatus } from './websocket';

/**
 * A minimal in-memory stand-in for the browser WebSocket API so the service's
 * connect / disconnect / reconnect lifecycle can be driven deterministically
 * (real sockets can't be scripted from unit tests).
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket the service has constructed (for test assertions). */
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSING;
  }

  // ---- test helpers (not part of the real WebSocket API) ----

  /** Simulate the server accepting the handshake (fires onopen). */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Simulate the connection dropping, as the browser would fire it. */
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1006 });
  }

  /** Simulate the server echoing a heartbeat pong. */
  pong() {
    this.onmessage?.({ data: JSON.stringify({ type: 'pong' }) });
  }

  /** Simulate an arbitrary server push event. */
  serverEvent(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const OriginalWebSocket = globalThis.WebSocket;

type ConnEvent = {
  status: ConnectionStatus;
  attempt?: number;
  maxAttempts?: number;
};

const connEvents: ConnEvent[] = [];
let lastConnEvent: ConnEvent | null = null;
let logSpy: ReturnType<typeof jest.spyOn>;

/** Attach the connection-event recorder. */
const subscribe = () => {
  wsService.on('connection', (p) => {
    const e = { status: p.status, attempt: p.attempt, maxAttempts: p.maxAttempts };
    connEvents.push(e);
    lastConnEvent = e;
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
  connEvents.length = 0;
  lastConnEvent = null;
  // Reset the singleton between tests. Note: disconnect() clears ALL listeners
  // (that is its job) — so subscribe afterwards.
  wsService.disconnect();
  subscribe();
});

afterEach(() => {
  wsService.disconnect();
  jest.clearAllTimers();
  jest.useRealTimers();
  logSpy.mockRestore();
  (globalThis as any).WebSocket = OriginalWebSocket;
});

describe('connect()', () => {
  test('opens a socket with the token in the URL and emits "connecting"', () => {
    wsService.connect('token-123');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://localhost:8080?token=token-123');
    expect(lastConnEvent).toMatchObject({ status: 'connecting' });
  });

  test('while CONNECTING reuses the in-flight socket instead of duplicating', () => {
    wsService.connect('token-a');
    wsService.connect('token-b');

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test('while OPEN reuses the live socket', () => {
    wsService.connect('token-a');
    FakeWebSocket.instances[0].open();

    wsService.connect('token-b');

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastConnEvent).toMatchObject({ status: 'connected' });
  });

  test('a completed handshake emits "connected" and starts the heartbeat', () => {
    wsService.connect('token-a');
    FakeWebSocket.instances[0].open();

    expect(lastConnEvent).toMatchObject({ status: 'connected', attempt: 0 });

    // The heartbeat pings ~15s after opening.
    jest.advanceTimersByTime(15000);
    const pings = FakeWebSocket.instances[0].sent.filter(
      (s) => JSON.parse(s).type === 'ping',
    );
    expect(pings).toHaveLength(1);
  });
});

describe('disconnect() races', () => {
  test('while CONNECTING defers the close until the handshake completes', () => {
    wsService.connect('token-a');
    const sock = FakeWebSocket.instances[0];

    wsService.disconnect();
    // disconnect() clears listeners — re-subscribe before the close events.
    subscribe();
    connEvents.length = 0;
    // Not closed yet — the close is deferred until the socket opens. (This is
    // the case that used to log "WebSocket is closed before the connection is
    // established".)
    expect(sock.readyState).toBe(FakeWebSocket.CONNECTING);

    // The handshake completes late → the service closes it immediately…
    sock.open();
    expect(sock.readyState).toBe(FakeWebSocket.CLOSING);
    expect(connEvents).toHaveLength(0); // …without emitting "connected".

    // …and when the browser fires onclose, no reconnect loop is started.
    sock.drop();
    expect(lastConnEvent).toMatchObject({ status: 'disconnected' });
    expect(connEvents.filter((e) => e.status === 'reconnecting')).toHaveLength(0);
  });

  test('while OPEN closes immediately and suppresses reconnect', () => {
    wsService.connect('token-a');
    const sock = FakeWebSocket.instances[0];
    sock.open();
    connEvents.length = 0;

    wsService.disconnect();
    // disconnect() clears listeners — re-subscribe before the close events.
    subscribe();
    expect(sock.readyState).toBe(FakeWebSocket.CLOSING);

    sock.drop();
    expect(connEvents[connEvents.length - 1]).toMatchObject({ status: 'disconnected' });
    expect(connEvents.filter((e) => e.status === 'reconnecting')).toHaveLength(0);
  });

  test('a stale socket closing late must not overwrite a healthy socket (StrictMode race)', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];

    // StrictMode: the effect cleanup disconnects while the socket is CONNECTING.
    wsService.disconnect();
    // disconnect() clears listeners — re-subscribe for the re-mounted effect.
    subscribe();
    expect(a.readyState).toBe(FakeWebSocket.CONNECTING);

    // The effect re-runs and connects again → a fresh socket B is created.
    wsService.connect('token-b');
    const b = FakeWebSocket.instances[1];
    expect(FakeWebSocket.instances).toHaveLength(2);

    // B completes the handshake and is healthy.
    b.open();
    connEvents.length = 0;

    // A's handshake completes late → the service closes it without connecting…
    a.open();
    expect(a.readyState).toBe(FakeWebSocket.CLOSING);
    expect(connEvents).toHaveLength(0);

    // …and its close event must not emit "disconnected" over B (regression
    // guard) nor stop B's heartbeat (second regression guard).
    a.drop();
    expect(connEvents).toHaveLength(0);
    expect(b.readyState).toBe(FakeWebSocket.OPEN);

    // B's heartbeat still runs after A's late close.
    jest.advanceTimersByTime(15000);
    const pings = b.sent.filter((s) => JSON.parse(s).type === 'ping');
    expect(pings).toHaveLength(1);
  });

  test('a stale socket closing with no active socket reports "disconnected"', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];
    wsService.disconnect(); // this.socket → null, a queued for a deferred close
    subscribe(); // disconnect() cleared listeners — re-subscribe
    connEvents.length = 0;

    a.open();
    a.drop();
    expect(lastConnEvent).toMatchObject({ status: 'disconnected' });
  });
});

describe('reconnect loop', () => {
  test('an unexpected drop emits "reconnecting" with a 1-based counter, capped at 8', () => {
    wsService.connect('token-a');
    FakeWebSocket.instances[0].open();
    connEvents.length = 0;

    FakeWebSocket.instances[0].drop();
    expect(connEvents[connEvents.length - 1]).toMatchObject({
      status: 'reconnecting',
      attempt: 1,
      maxAttempts: 8,
    });

    // Attempts 2..8 — each retry waits 2^(n-1) seconds before reconnecting.
    for (let i = 2; i <= 8; i++) {
      jest.advanceTimersByTime(2 ** (i - 1) * 1000);
      expect(FakeWebSocket.instances).toHaveLength(i);
      FakeWebSocket.instances[i - 1].drop();
      expect(connEvents[connEvents.length - 1]).toMatchObject({
        status: 'reconnecting',
        attempt: i,
      });
    }

    // One more failure after the 8th retry → permanently "disconnected".
    jest.advanceTimersByTime(2 ** 8 * 1000);
    expect(FakeWebSocket.instances).toHaveLength(9);
    FakeWebSocket.instances[8].drop();
    expect(connEvents[connEvents.length - 1]).toMatchObject({ status: 'disconnected' });

    // No runaway timers after the cap — nothing else ever reconnects.
    jest.advanceTimersByTime(1000000);
    expect(FakeWebSocket.instances).toHaveLength(9);
  });

  test('the retry counter resets after a successful reconnect', () => {
    wsService.connect('token-a');
    FakeWebSocket.instances[0].open();
    connEvents.length = 0;

    // First outage → attempt 1 → the "server" is back and it recovers.
    FakeWebSocket.instances[0].drop();
    jest.advanceTimersByTime(1000);
    const b = FakeWebSocket.instances[1];
    b.open();
    expect(lastConnEvent).toMatchObject({ status: 'connected', attempt: 0 });

    // Second outage starts fresh at attempt 1 (not 2).
    connEvents.length = 0;
    b.drop();
    expect(lastConnEvent).toMatchObject({ status: 'reconnecting', attempt: 1 });
  });
});

describe('errors', () => {
  test('a socket error emits "error" status', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];
    a.open();
    connEvents.length = 0;

    a.onerror?.({});
    expect(lastConnEvent).toMatchObject({ status: 'error' });
  });
});

describe('heartbeat', () => {
  test('a pong keeps the connection alive; a missing pong closes it and reconnects', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];
    a.open();

    // First heartbeat tick sends a ping; the pong clears the close timer.
    jest.advanceTimersByTime(15000);
    expect(a.sent.filter((s) => JSON.parse(s).type === 'ping')).toHaveLength(1);
    a.pong();
    jest.advanceTimersByTime(5000);
    expect(a.readyState).toBe(FakeWebSocket.OPEN);

    // Second tick pings again, but no pong → the socket is closed after 5s.
    jest.advanceTimersByTime(15000);
    expect(a.sent.filter((s) => JSON.parse(s).type === 'ping')).toHaveLength(2);
    jest.advanceTimersByTime(5000);
    expect(a.readyState).toBe(FakeWebSocket.CLOSING);

    // The browser fires onclose → the reconnect flow takes over…
    a.drop();
    expect(lastConnEvent).toMatchObject({ status: 'reconnecting', attempt: 1 });

    // …and recovers once the "server" is reachable again.
    jest.advanceTimersByTime(1000);
    FakeWebSocket.instances[1].open();
    expect(lastConnEvent).toMatchObject({ status: 'connected', attempt: 0 });
  });
});

describe('send()', () => {
  test('queues while CONNECTING and flushes on the first open', () => {
    wsService.connect('token-a');
    wsService.send('send_message', { conversationId: 3, content: 'early' });
    expect(FakeWebSocket.instances[0].sent).toHaveLength(0);

    FakeWebSocket.instances[0].open();
    expect(FakeWebSocket.instances[0].sent).toHaveLength(1);
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: 'send_message',
      conversationId: 3,
      content: 'early',
    });
  });

  test('queues while offline and flushes after reconnect', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];
    a.open();
    wsService.send('send_message', { conversationId: 5, content: 'hi' });
    expect(a.sent).toHaveLength(1);

    // Drop → a message sent while reconnecting is queued, not lost.
    a.drop();
    wsService.send('typing_start', { conversationId: 5 });

    jest.advanceTimersByTime(1000);
    const b = FakeWebSocket.instances[1];
    expect(b.sent).toHaveLength(0);

    b.open(); // flush on reconnect
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0])).toEqual({ type: 'typing_start', conversationId: 5 });
  });
});

describe('message routing', () => {
  test('server events route to listeners; heartbeat pongs are swallowed', () => {
    wsService.connect('token-a');
    const a = FakeWebSocket.instances[0];

    const received: unknown[] = [];
    const pongReceived: unknown[] = [];
    wsService.on('receive_message', (p) => received.push(p));
    wsService.on('pong' as any, (p) => pongReceived.push(p));

    a.serverEvent({ type: 'receive_message', message: { id: 1, conversationId: 5 } });
    a.pong();

    expect(received).toHaveLength(1);
    expect(pongReceived).toHaveLength(0);
  });
});

describe('isConnected()', () => {
  test('reflects the live socket state', () => {
    expect(wsService.isConnected()).toBe(false);
    wsService.connect('token-a');
    expect(wsService.isConnected()).toBe(false); // still CONNECTING
    FakeWebSocket.instances[0].open();
    expect(wsService.isConnected()).toBe(true);
    FakeWebSocket.instances[0].drop();
    expect(wsService.isConnected()).toBe(false);
  });
});
