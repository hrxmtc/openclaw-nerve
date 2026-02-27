/**
 * WebSocket proxy — bridges browser clients to the OpenClaw gateway.
 *
 * Clients connect to `ws(s)://host:port/ws?target=<gateway-ws-url>` and this
 * module opens a corresponding connection to the gateway, relaying messages
 * bidirectionally. During the connect handshake, injects Nerve's Ed25519-signed
 * device identity so the gateway grants operator.read/write scopes.
 *
 * On the first ever connection the gateway creates a pending pairing request.
 * The user must approve it once via `openclaw devices approve <requestId>`.
 * If the device is rejected for any reason, the proxy retries without device
 * identity — the browser still connects but with reduced (token-only) scopes.
 * @module
 */

import type { Server as HttpsServer } from 'node:https';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, WS_ALLOWED_HOSTS, SESSION_COOKIE_NAME } from './config.js';
import { verifySession, parseSessionCookie } from './session.js';
import { createDeviceBlock, getDeviceIdentity } from './device-identity.js';
import { resolveOpenclawBin } from './openclaw-bin.js';

/**
 * Methods the gateway restricts for webchat clients.
 * We intercept these and proxy via `openclaw gateway call` (full CLI scopes).
 */
const RESTRICTED_METHODS = new Set([
  'sessions.patch',
  'sessions.delete',
  'sessions.reset',
  'sessions.compact',
]);

/**
 * Execute a gateway RPC call via the CLI, bypassing webchat restrictions.
 */
function gatewayCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bin = resolveOpenclawBin();
    const args = ['gateway', 'call', method, '--params', JSON.stringify(params)];
    // Ensure nvm/fnm/volta node is in PATH for #!/usr/bin/env node shebangs
    const nodeBinDir = dirname(process.execPath);
    const existingPath = process.env.PATH;
    const env = { ...process.env, PATH: existingPath ? `${nodeBinDir}:${existingPath}` : nodeBinDir };
    execFile(bin, args, { timeout: 10_000, maxBuffer: 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: true, raw: stdout.trim() });
      }
    });
  });
}

/** Active WSS instances — used for graceful shutdown */
const activeWssInstances: WebSocketServer[] = [];

/** Close all active WebSocket connections */
export function closeAllWebSockets(): void {
  for (const wss of activeWssInstances) {
    for (const client of wss.clients) client.close(1001, 'Server shutting down');
    wss.close();
  }
  activeWssInstances.length = 0;
}

/**
 * Set up the WS/WSS proxy on an HTTP or HTTPS server.
 * Proxies ws(s)://host:port/ws?target=ws://gateway/ws to the OpenClaw gateway.
 */
export function setupWebSocketProxy(server: HttpServer | HttpsServer): void {
  const wss = new WebSocketServer({ noServer: true });
  activeWssInstances.push(wss);

  // Eagerly load device identity at startup
  getDeviceIdentity();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.startsWith('/ws')) {
      // Auth check for WebSocket connections
      if (config.auth) {
        const token = parseSessionCookie(req.headers.cookie, SESSION_COOKIE_NAME);
        if (!token || !verifySession(token, config.sessionSecret)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\n\r\nAuthentication required');
          socket.destroy();
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    const connId = randomUUID().slice(0, 8);
    const tag = `[ws-proxy:${connId}]`;
    const url = new URL(req.url || '/', 'https://localhost');
    const target = url.searchParams.get('target');

    console.log(`${tag} New connection: target=${target}`);

    if (!target) {
      clientWs.close(1008, 'Missing ?target= param');
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(target);
    } catch {
      clientWs.close(1008, 'Invalid target URL');
      return;
    }

    if (!['ws:', 'wss:'].includes(targetUrl.protocol) || !WS_ALLOWED_HOSTS.has(targetUrl.hostname)) {
      console.warn(`${tag} Rejected: target not allowed: ${target}`);
      clientWs.close(1008, 'Target not allowed');
      return;
    }

    const targetPort = Number(targetUrl.port) || (targetUrl.protocol === 'wss:' ? 443 : 80);
    if (targetPort < 1 || targetPort > 65535) {
      console.warn(`${tag} Rejected: invalid port ${targetPort}`);
      clientWs.close(1008, 'Invalid target port');
      return;
    }

    // Forward origin header for gateway auth
    const isEncrypted = !!(req.socket as unknown as { encrypted?: boolean }).encrypted;
    const scheme = isEncrypted ? 'https' : 'http';
    const clientOrigin = req.headers.origin || `${scheme}://${req.headers.host}`;

    createGatewayRelay(clientWs, targetUrl, clientOrigin, connId);
  });
}

/**
 * Create a relay between a browser WebSocket and the gateway.
 *
 * Injects Nerve's device identity into the connect handshake for full
 * operator scopes. If the gateway rejects the device (pairing required,
 * token mismatch), transparently retries without device identity.
 */
function createGatewayRelay(
  clientWs: WebSocket,
  targetUrl: URL,
  clientOrigin: string,
  connId: string,
): void {
  const tag = `[ws-proxy:${connId}]`;
  const connStartTime = Date.now();
  let clientToGatewayCount = 0;
  let gatewayToClientCount = 0;

  // ─── Keepalive: ping both sides every 30s, kill dead connections ────────
  const PING_INTERVAL = 30_000;
  const PONG_TIMEOUT = 10_000;
  let clientAlive = true;
  let gatewayAlive = true;

  clientWs.on('pong', () => { clientAlive = true; });

  const pingTimer = setInterval(() => {
    // Check client
    if (!clientAlive) {
      console.log(`${tag} Client pong timeout — terminating`);
      clientWs.terminate();
      return;
    }
    clientAlive = false;
    if (clientWs.readyState === WebSocket.OPEN) clientWs.ping();

    // Check gateway
    if (gwWs && !gatewayAlive) {
      console.log(`${tag} Gateway pong timeout — terminating`);
      gwWs.terminate();
      return;
    }
    gatewayAlive = false;
    if (gwWs?.readyState === WebSocket.OPEN) gwWs.ping();
  }, PING_INTERVAL);

  let gwWs: WebSocket;
  let challengeNonce: string | null = null;
  let handshakeComplete = false;
  let useDeviceIdentity = true;
  let hasRetried = false;
  /** Saved connect message for replay on retry */
  let savedConnectMsg: Record<string, unknown> | null = null;

  // Buffer client messages until gateway connection is open (with cap)
  const MAX_PENDING = 100;
  const MAX_BYTES = 1024 * 1024; // 1 MB
  let pending: { data: Buffer | string; isBinary: boolean }[] = [];
  let pendingBytes = 0;

  function openGateway(): void {
    challengeNonce = null;
    handshakeComplete = false;

    gwWs = new WebSocket(targetUrl.toString(), {
      headers: { Origin: clientOrigin },
    });

    gwWs.on('pong', () => { gatewayAlive = true; });

    // Gateway → Client
    gwWs.on('message', (data: Buffer | string, isBinary: boolean) => {
      // Capture challenge nonce before handshake completes
      if (!handshakeComplete && !isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event' && msg.event === 'connect.challenge' && msg.payload?.nonce) {
            challengeNonce = msg.payload.nonce;
          }
        } catch { /* ignore */ }
      }

      if (clientWs.readyState === WebSocket.OPEN) {
        gatewayToClientCount++;
        clientWs.send(isBinary ? data : data.toString());
      }
    });

    gwWs.on('open', () => {
      // Flush buffered messages
      for (const msg of pending) {
        if (!handshakeComplete && !msg.isBinary && challengeNonce) {
          try {
            const parsed = JSON.parse(msg.data.toString());
            if (parsed.type === 'req' && parsed.method === 'connect' && parsed.params) {
              savedConnectMsg = parsed;
              const modified = useDeviceIdentity ? injectDeviceIdentity(parsed, challengeNonce, tag) : parsed;
              gwWs.send(JSON.stringify(modified));
              handshakeComplete = true;
              continue;
            }
          } catch { /* pass through */ }
        }
        gwWs.send(msg.isBinary ? msg.data : msg.data.toString());
      }
      pending = [];
      pendingBytes = 0;

      // On retry, replay the saved connect message without device identity
      if (hasRetried && savedConnectMsg && challengeNonce) {
        gwWs.send(JSON.stringify(savedConnectMsg));
        handshakeComplete = true;
      }
    });

    gwWs.on('error', (err) => {
      console.error(`${tag} Gateway error:`, err.message);
      if (!hasRetried || handshakeComplete) clientWs.close();
    });

    gwWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      console.log(`${tag} Gateway closed: code=${code}, reason=${reasonStr}`);

      // Device auth rejected — retry without device identity
      const isDeviceRejection = code === 1008 && (
        reasonStr.includes('device token mismatch') ||
        reasonStr.includes('device signature invalid') ||
        reasonStr.includes('unknown device') ||
        reasonStr.includes('pairing required')
      );

      if (useDeviceIdentity && !hasRetried && isDeviceRejection && clientWs.readyState === WebSocket.OPEN) {
        console.log(`${tag} Device rejected (${reasonStr}) — retrying without device identity`);
        useDeviceIdentity = false;
        hasRetried = true;
        openGateway();
        return;
      }

      clientWs.close();
    });
  }

  // Client → Gateway (attached once, references mutable gwWs)
  clientWs.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN) {
      const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
      if (pending.length >= MAX_PENDING || pendingBytes + size > MAX_BYTES) {
        clientWs.close(1008, 'Too many pending messages');
        return;
      }
      pendingBytes += size;
      pending.push({ data, isBinary });
      return;
    }

    // Parse message for interception (connect handshake + restricted methods)
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());

        // Intercept connect request to inject device identity
        if (!handshakeComplete && challengeNonce && msg.type === 'req' && msg.method === 'connect' && msg.params) {
          savedConnectMsg = msg;
          const modified = useDeviceIdentity ? injectDeviceIdentity(msg, challengeNonce, tag) : msg;
          gwWs.send(JSON.stringify(modified));
          handshakeComplete = true;
          return;
        }

        // Intercept restricted RPC methods — proxy via CLI (full scopes)
        if (msg.type === 'req' && RESTRICTED_METHODS.has(msg.method)) {
          const reqId = msg.id;
          gatewayCall(msg.method, msg.params || {})
            .then((result) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'res', id: reqId, ok: true, payload: result }));
              }
            })
            .catch((err) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({
                  type: 'res',
                  id: reqId,
                  ok: false,
                  error: { code: -32000, message: (err as Error).message },
                }));
              }
            });
          return;
        }
      } catch { /* pass through */ }
    }

    clientToGatewayCount++;
    gwWs.send(isBinary ? data : data.toString());
  });

  clientWs.on('close', (code, reason) => {
    clearInterval(pingTimer);
    const duration = Date.now() - connStartTime;
    console.log(`${tag} Client closed: code=${code}, reason=${reason?.toString()}`);
    console.log(`${tag} Summary: duration=${duration}ms, client->gw=${clientToGatewayCount}, gw->client=${gatewayToClientCount}`);
    if (gwWs) gwWs.close();
  });
  clientWs.on('error', (err) => {
    clearInterval(pingTimer);
    console.error(`${tag} Client error:`, err.message);
    if (gwWs) gwWs.close();
  });

  openGateway();
}

/**
 * Inject Nerve's device identity into a connect request.
 */
interface ConnectParams {
  client?: { id?: string; mode?: string; instanceId?: string; [key: string]: unknown };
  role?: string;
  scopes?: string[];
  auth?: { token?: string };
}

function injectDeviceIdentity(msg: Record<string, unknown>, nonce: string, logTag = '[ws-proxy]'): Record<string, unknown> {
  const params = (msg.params || {}) as ConnectParams;
  const clientId = params.client?.id || 'nerve-ui';
  const clientMode = params.client?.mode || 'webchat';
  const role = params.role || 'operator';
  const scopes = params.scopes || ['operator.admin', 'operator.read', 'operator.write'];
  const token = params.auth?.token || '';

  const scopeSet = new Set(scopes);
  scopeSet.add('operator.read');
  scopeSet.add('operator.write');
  const finalScopes = [...scopeSet] as string[];

  const device = createDeviceBlock({
    clientId,
    clientMode,
    role,
    scopes: finalScopes,
    token,
    nonce,
  });

  console.log(`${logTag} Injected device identity: ${device.id.substring(0, 12)}...`);

  return {
    ...msg,
    params: {
      ...params,
      scopes: finalScopes,
      device,
    },
  };
}
