/**
 * KneaChat Backend Server
 * Express.js + WebSocket + MySQL (TypeScript).
 *
 * Composition: app.ts builds the Express app; this module creates the HTTP
 * server, attaches the WebSocket server (with injected handlers), and listens.
 */
import 'dotenv/config';
import http from 'http';
import WebSocket from 'ws';
import { app } from './app';
import { container } from './container';
import { ChatWebSocketServer } from './websocket/websocket.server';
import { startAttendanceEventRelay } from './websocket/attendance.events';

// Attendance real-time relay: subscribes to the Redis attendance channel so
// clock-in/out events from other server instances fan out to local sockets.
void startAttendanceEventRelay();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Wire the WebSocket server with the handler instances from the container.
const wsServer = new ChatWebSocketServer({
  messageHandler: container.messageHandler,
  typingHandler: container.typingHandler,
  presenceHandler: container.presenceHandler,
  callHandler: container.callHandler,
});
wsServer.attach(wss, server);

const REMINDER_POLL_INTERVAL_MS = 30_000;

setInterval(async () => {
  try {
    await container.reminderService.processDueReminders(new Date());
  } catch {
    // Scheduler failures are non-fatal; the next tick will retry.
  }
}, REMINDER_POLL_INTERVAL_MS).unref();

setInterval(async () => {
  try {
    await container.meetingService.processDueMeetingReminders(new Date());
  } catch {
    // Scheduler failures are non-fatal; the next tick will retry.
  }
}, REMINDER_POLL_INTERVAL_MS).unref();

// Task deadline alerts (assignments + due-date reminders are notifications).
setInterval(async () => {
  try {
    await container.taskService.processDueTaskDeadlines(new Date());
  } catch {
    // Scheduler failures are non-fatal; the next tick will retry.
  }
}, REMINDER_POLL_INTERVAL_MS).unref();

// ============ SERVER START ============
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║         🎯 KneaChat Server Started Successfully        ║
╠════════════════════════════════════════════════════════╣
║ 🌐 HTTP Server:       http://${HOST}:${PORT}
║ 📡 WebSocket Server:  ws://${HOST}:${PORT}
║ 🔧 Environment:       ${process.env.NODE_ENV || 'development'}
║ 🗄️  Database:          ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}
╚════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown.
// Terminate live WebSocket connections first — server.close() otherwise waits
// for every connection (including open sockets) and never finishes.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully...');
  // close(1001) sends a close frame so queued frames flush (terminate() would
  // drop a persisted-but-not-yet-broadcast message — SRS NFR-08).
  for (const client of wss.clients) {
    client.close(1001, 'server shutting down');
  }
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Backstop: never leave the process hanging on lingering connections.
  setTimeout(() => {
    console.log('Forced exit after shutdown timeout');
    process.exit(1);
  }, 5000).unref();
});

export { app, server, wss };
