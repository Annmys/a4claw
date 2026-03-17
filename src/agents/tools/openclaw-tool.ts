import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseTool, ToolResult } from './base-tool.js';
import config from '../../config.js';

const execAsync = promisify(exec);

const BRIDGE_PATH = '/home/openclaw/clawdagent-bridge-v7.js';
const BRIDGE_VER = '7';

// ClawdAgent device credentials (Ed25519, paired with OpenClaw gateway)
// Set these in .env: OPENCLAW_DEVICE_ID, OPENCLAW_DEVICE_PUBLIC_KEY, OPENCLAW_DEVICE_PRIVATE_KEY, OPENCLAW_DEVICE_TOKEN
const DEVICE_ID = process.env.OPENCLAW_DEVICE_ID || '';
const DEVICE_PUBLIC_KEY = process.env.OPENCLAW_DEVICE_PUBLIC_KEY || '';
const DEVICE_PRIVATE_KEY_DER = process.env.OPENCLAW_DEVICE_PRIVATE_KEY || '';
const DEVICE_TOKEN = process.env.OPENCLAW_DEVICE_TOKEN || '';

// ─── Embedded bridge script (deployed to server on first use) ────────────────
const BRIDGE_SCRIPT = `#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const { randomUUID } = crypto;

const PORT = process.env.OPENCLAW_GATEWAY_PORT || 18789;
const TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT || '30000', 10);
const AGENT_TIMEOUT = parseInt(process.env.BRIDGE_AGENT_TIMEOUT || '120000', 10);

// Device auth credentials (Ed25519)
const DEV_ID = process.env.OPENCLAW_DEVICE_ID || '';
const DEV_PUB = process.env.OPENCLAW_DEVICE_PUBLIC_KEY || '';
const DEV_PRIV = process.env.OPENCLAW_DEVICE_PRIVATE_KEY || '';
const DEV_TOKEN = process.env.OPENCLAW_DEVICE_TOKEN || '';
const FALLBACK_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const method = process.argv[2];
const paramsB64 = process.argv[3] || '';

if (!method) {
  out({ ok: false, error: 'Usage: node bridge.js <method> [base64-params]' });
  process.exit(1);
}

let params = {};
if (paramsB64) {
  try { params = JSON.parse(Buffer.from(paramsB64, 'base64').toString('utf-8')); }
  catch (e) { out({ ok: false, error: 'Bad params: ' + e.message }); process.exit(1); }
}

function out(obj) { console.log(JSON.stringify(obj)); }

function signDevice() {
  if (!DEV_ID || !DEV_PUB || !DEV_PRIV || !DEV_TOKEN) return null;
  try {
    const signedAt = Date.now();
    const scopes = 'operator.admin,operator.write,operator.read,operator.approvals';
    const payload = ['v1', DEV_ID, 'gateway-client', 'backend', 'operator', scopes, String(signedAt), DEV_TOKEN].join('|');
    const privKey = crypto.createPrivateKey({ key: Buffer.from(DEV_PRIV, 'base64'), type: 'pkcs8', format: 'der' });
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privKey);
    return { id: DEV_ID, publicKey: DEV_PUB, signature: sig.toString('base64url'), signedAt };
  } catch (e) { return null; }
}

// Find ws module
let WS;
const tryPaths = [
  'ws',
  '/home/openclaw/openclaw-project/node_modules/ws',
  '/home/openclaw/openclaw-project/openclaw/node_modules/ws',
  '/usr/local/lib/node_modules/ws',
];
for (const p of tryPaths) { try { WS = require(p); break; } catch {} }
if (!WS) { out({ ok: false, error: 'ws module not found' }); process.exit(1); }

const ws = new WS('ws://127.0.0.1:' + PORT);
const cid = randomUUID();
const mid = randomUUID();
let phase = 'init';
const isAgent = method === 'agent';
const tms = isAgent ? AGENT_TIMEOUT : TIMEOUT;
let agentAcked = false;

const timer = setTimeout(() => {
  if (isAgent && agentAcked) {
    out({ ok: true, payload: { status: 'timeout_waiting', message: 'Agent still running. Use agent_wait with runId to check later.', runId: params.idempotencyKey || mid } });
    fin(0);
  } else {
    out({ ok: false, error: 'Timeout ' + tms + 'ms (phase: ' + phase + ')' });
    fin(1);
  }
}, tms);

ws.on('open', () => { phase = 'challenge'; });

ws.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    phase = 'auth';
    const device = signDevice();
    const token = device ? DEV_TOKEN : FALLBACK_TOKEN;
    const connectParams = {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'gateway-client', displayName: 'ClawdAgent', version: '2.0.0', platform: 'linux', mode: 'backend', instanceId: randomUUID() },
      caps: [], role: 'operator', scopes: ['operator.admin', 'operator.write', 'operator.read', 'operator.approvals'],
      auth: { token }
    };
    if (device) connectParams.device = device;
    ws.send(JSON.stringify({ type: 'req', id: cid, method: 'connect', params: connectParams }));
    return;
  }

  if (msg.type === 'res' && msg.id === cid) {
    if (!msg.ok) { out({ ok: false, error: msg.error || 'Auth rejected' }); fin(1); return; }
    phase = 'calling';
    if ((method === 'send' || method === 'agent') && !params.idempotencyKey) {
      params.idempotencyKey = randomUUID();
    }
    ws.send(JSON.stringify({ type: 'req', id: mid, method, params }));
    return;
  }

  if (msg.type === 'res' && msg.id === mid) {
    if (isAgent && msg.ok && msg.payload && msg.payload.status === 'accepted' && !agentAcked) {
      agentAcked = true;
      phase = 'agent_running';
      return;
    }
    out({ ok: msg.ok, payload: msg.payload, error: msg.error || null });
    fin(msg.ok ? 0 : 1);
  }
});

ws.on('error', (e) => { out({ ok: false, error: 'WS error: ' + e.message }); fin(1); });
ws.on('close', (code) => {
  if (phase !== 'done') { out({ ok: false, error: 'Closed (code ' + code + ', phase: ' + phase + ')' }); fin(1); }
});

function fin(code) { phase = 'done'; clearTimeout(timer); try { ws.close(); } catch {} process.exit(code); }
`;

// ─── OpenClaw Tool ───────────────────────────────────────────────────────────

export class OpenClawTool extends BaseTool {
  name = 'openclaw';
  description = 'Bridge to OpenClaw gateway — send messages, run agents, manage cron and sessions';

  private deployed = false;
  private gatewayToken: string;

  constructor() {
    super();
    this.gatewayToken = (config as any).OPENCLAW_GATEWAY_TOKEN || '';
  }

  private async ssh(command: string, timeoutMs = 35000): Promise<string> {
    const server = config.DEFAULT_SSH_SERVER;
    if (!server) throw new Error('SSH not configured');
    const keyFlag = config.DEFAULT_SSH_KEY_PATH ? `-i "${config.DEFAULT_SSH_KEY_PATH}" ` : '';
    const escaped = command.replace(/"/g, '\\"');
    const sshCmd = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ${keyFlag}${server} "${escaped}"`;
    try {
      const { stdout } = await execAsync(sshCmd, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
      return stdout.trim();
    } catch (err: any) {
      if (err.stdout && err.stdout.trim()) {
        return err.stdout.trim();
      }
      throw err;
    }
  }

  private async ensureDeployed(): Promise<void> {
    if (this.deployed) return;

    try {
      const ver = await this.ssh(`cat ${BRIDGE_PATH}.version 2>/dev/null || echo NONE`);
      if (ver === BRIDGE_VER) { this.deployed = true; return; }
    } catch { /* redeploy */ }

    this.log('Deploying bridge script to server');
    const b64 = Buffer.from(BRIDGE_SCRIPT).toString('base64');
    await this.ssh(`echo ${b64} | base64 -d > ${BRIDGE_PATH} && chmod +x ${BRIDGE_PATH} && echo ${BRIDGE_VER} > ${BRIDGE_PATH}.version`);
    this.deployed = true;
    this.log('Bridge script deployed');
  }

  private async callGateway(method: string, params: Record<string, unknown> = {}, timeoutMs = 35000): Promise<{ ok: boolean; payload?: any; error?: any }> {
    await this.ensureDeployed();

    const paramsB64 = Buffer.from(JSON.stringify(params)).toString('base64');
    const envVars = [
      `OPENCLAW_DEVICE_ID=${DEVICE_ID}`,
      `OPENCLAW_DEVICE_PUBLIC_KEY=${DEVICE_PUBLIC_KEY}`,
      `OPENCLAW_DEVICE_PRIVATE_KEY=${DEVICE_PRIVATE_KEY_DER}`,
      `OPENCLAW_DEVICE_TOKEN=${DEVICE_TOKEN}`,
      `OPENCLAW_GATEWAY_TOKEN=${this.gatewayToken}`,
    ].join(' ');
    const cmd = `${envVars} node ${BRIDGE_PATH} ${method} ${paramsB64}`;

    const raw = await this.ssh(cmd, timeoutMs);
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return JSON.parse(trimmed);
      }
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error('No valid JSON in bridge output: ' + raw.slice(0, 300));
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    if (!action) return { success: false, output: '', error: 'No action provided' };

    if (!config.DEFAULT_SSH_SERVER) {
      return { success: false, output: '', error: 'SSH not configured — cannot reach OpenClaw' };
    }
    if (!this.gatewayToken) {
      return { success: false, output: '', error: 'OPENCLAW_GATEWAY_TOKEN not set' };
    }

    try {
      const { method, params, timeout } = this.resolveAction(action, input);

      this.log('Calling OpenClaw', { method, params: JSON.stringify(params).slice(0, 200) });
      const result = await this.callGateway(method, params, timeout);

      if (result.ok) {
        const out = typeof result.payload === 'string'
          ? result.payload
          : JSON.stringify(result.payload, null, 2);
        return { success: true, output: out };
      } else {
        const errMsg = typeof result.error === 'string'
          ? result.error
          : result.error?.message || JSON.stringify(result.error);
        return { success: false, output: JSON.stringify(result.error, null, 2), error: errMsg };
      }
    } catch (err: any) {
      this.error('Bridge error', { error: err.message });
      return { success: false, output: '', error: `OpenClaw bridge: ${err.message}` };
    }
  }

  private resolveAction(action: string, input: Record<string, unknown>): { method: string; params: Record<string, unknown>; timeout: number } {
    const p: Record<string, unknown> = { ...(input.params as Record<string, unknown> || {}) };

    for (const key of ['to', 'message', 'channel', 'mediaUrl', 'mediaUrls', 'sessionKey', 'runId', 'agentId', 'cronExpression', 'cronId', 'jobId', 'cronLabel', 'thinking', 'deliver', 'limit', 'offset']) {
      if (input[key] !== undefined) p[key] = input[key];
    }

    const methodMap: Record<string, { method: string; timeout?: number }> = {
      health:            { method: 'health' },
      status:            { method: 'status' },
      send:              { method: 'send' },
      agent:             { method: 'agent', timeout: 135000 },
      agent_wait:        { method: 'agent.wait', timeout: 135000 },
      sessions_list:     { method: 'sessions.list' },
      sessions_preview:  { method: 'sessions.preview' },
      cron_list:         { method: 'cron.list' },
      cron_status:       { method: 'cron.status' },
      cron_add:          { method: 'cron.add' },
      cron_remove:       { method: 'cron.remove' },
      cron_run:          { method: 'cron.run' },
      cron_runs:         { method: 'cron.runs' },
      chat_send:         { method: 'chat.send' },
      chat_history:      { method: 'chat.history' },
      channels_status:   { method: 'channels.status' },
      models_list:       { method: 'models.list' },
      agents_list:       { method: 'agents.list' },
      config_get:        { method: 'config.get' },
      browser_request:   { method: 'browser.request' },
      raw:               { method: (input.method as string) || 'health' },
    };

    const entry = methodMap[action];
    if (!entry) {
      return { method: action, params: p, timeout: 15000 };
    }

    return { method: entry.method, params: p, timeout: entry.timeout || 15000 };
  }
}
