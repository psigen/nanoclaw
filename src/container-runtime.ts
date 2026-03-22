/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** Hostname containers use to reach the host machine. */
export const CONTAINER_HOST_GATEWAY = 'host.docker.internal';

/** Docker network used when running in rootless mode. */
const NANOCLAW_NETWORK = 'nanoclaw-net';

/** Name of the credential proxy sidecar container. */
const PROXY_SIDECAR_NAME = 'nanoclaw-credential-proxy';

/** Detect whether Docker is running in rootless mode. */
let _isRootless: boolean | undefined;
export function isRootlessDocker(): boolean {
  if (_isRootless !== undefined) return _isRootless;
  try {
    const info = execSync(
      `${CONTAINER_RUNTIME_BIN} info --format '{{.SecurityOptions}}'`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 10000,
      },
    );
    _isRootless = info.includes('rootless');
  } catch {
    _isRootless = false;
  }
  return _isRootless;
}

/**
 * Address the credential proxy binds to.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') return '127.0.0.1';

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/**
 * Returns the hostname:port that containers should use to reach the credential proxy.
 * In rootless Docker, containers can't reach the host, so we use a sidecar container
 * on a shared Docker network instead.
 */
export function proxyHostForContainers(port: number): string {
  if (isRootlessDocker()) {
    return `${PROXY_SIDECAR_NAME}:${port}`;
  }
  return `${CONTAINER_HOST_GATEWAY}:${port}`;
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // Rootless Docker: use shared network instead of host gateway
  if (isRootlessDocker()) {
    return [`--network=${NANOCLAW_NETWORK}`];
  }
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

/**
 * Ensure the Docker network exists for rootless mode.
 * In rootless Docker, containers can't reach the host, so we create a shared
 * network and run a credential proxy sidecar that agent containers connect to.
 */
export function ensureDockerNetwork(): void {
  if (!isRootlessDocker()) return;
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} network inspect ${NANOCLAW_NETWORK}`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    logger.info(
      { network: NANOCLAW_NETWORK },
      'Creating Docker network for rootless mode',
    );
    execSync(`${CONTAINER_RUNTIME_BIN} network create ${NANOCLAW_NETWORK}`, {
      stdio: 'pipe',
      timeout: 10000,
    });
  }
}

/**
 * Start a credential proxy sidecar container for rootless Docker.
 * This runs a minimal Node.js HTTP proxy inside a container on the shared network,
 * reading secrets from the mounted .env file and forwarding API requests to Anthropic.
 */
export function startProxySidecar(port: number): void {
  if (!isRootlessDocker()) return;

  // Check if sidecar is already running
  try {
    const running = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=${PROXY_SIDECAR_NAME} --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (running === PROXY_SIDECAR_NAME) {
      logger.debug('Credential proxy sidecar already running');
      return;
    }
  } catch {
    /* not running */
  }

  // Remove any stopped sidecar
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} rm -f ${PROXY_SIDECAR_NAME}`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    /* didn't exist */
  }

  ensureDockerNetwork();

  const envFile = path.resolve(process.cwd(), '.env');

  // Write proxy script to a temp file and mount it into the container.
  // This avoids shell quoting issues with inline scripts.
  const proxyScriptDir = path.resolve(process.cwd(), 'data', 'proxy-sidecar');
  fs.mkdirSync(proxyScriptDir, { recursive: true });
  const proxyScriptPath = path.join(proxyScriptDir, 'proxy.js');
  fs.writeFileSync(proxyScriptPath, generateProxyScript(port));

  const args = [
    'run',
    '-d',
    '--name',
    PROXY_SIDECAR_NAME,
    '--network',
    NANOCLAW_NETWORK,
    '--restart',
    'unless-stopped',
    '-v',
    `${envFile}:/secrets/.env:ro`,
    '-v',
    `${proxyScriptPath}:/app/proxy.js:ro`,
    'node:22-slim',
    'node',
    '/app/proxy.js',
  ];

  execSync(`${CONTAINER_RUNTIME_BIN} ${args.join(' ')}`, {
    stdio: 'pipe',
    timeout: 30000,
  });

  logger.info(
    { port, network: NANOCLAW_NETWORK },
    'Credential proxy sidecar started (rootless Docker)',
  );
}

/**
 * Stop the credential proxy sidecar container.
 */
export function stopProxySidecar(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} rm -f ${PROXY_SIDECAR_NAME}`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    /* already stopped */
  }
}

function generateProxyScript(port: number): string {
  return `const http = require('http');
const https = require('https');
const fs = require('fs');

function readEnv(filePath) {
  const result = {};
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        value = value.slice(1, -1);
      if (value) result[key] = value;
    }
  } catch {}
  return result;
}

const secrets = readEnv('/secrets/.env');
const apiKey = secrets.ANTHROPIC_API_KEY;
const oauthToken = secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;
const upstreamUrl = new URL(secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
const isHttps = upstreamUrl.protocol === 'https:';
const makeRequest = isHttps ? https.request : http.request;

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers, host: upstreamUrl.host, 'content-length': body.length };
    delete headers.connection;
    delete headers['keep-alive'];
    delete headers['transfer-encoding'];
    if (apiKey) {
      delete headers['x-api-key'];
      headers['x-api-key'] = apiKey;
    } else if (headers.authorization && oauthToken) {
      headers.authorization = 'Bearer ' + oauthToken;
    }
    const upstream = makeRequest({
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || (isHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      headers
    }, (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(502); res.end('Bad Gateway'); }
    });
    upstream.write(body);
    upstream.end();
  });
}).listen(${port}, '0.0.0.0', () => console.log('Proxy sidecar listening on port ${port}'));
`;
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        execSync(stopContainer(name), { stdio: 'pipe' });
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
