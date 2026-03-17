/**
 * Skill Scanner — Comprehensive Skill Security Validation
 *
 * Deep inspection of skill content before installation.
 * Replaces the basic evaluateSafety() in skill-fetcher.ts with:
 * - 25+ static analysis patterns (expanded from 6)
 * - Severity-weighted scoring system
 * - Source reputation tracking
 * - Obfuscation detection
 *
 * Scoring: BLOCKED (>15), FLAGGED (5-15), PASSED (<5)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { scanForInjection } from './content-guard.js';
import logger from '../utils/logger.js';

// ── Pattern Definitions ───────────────────────────────────────────────────

interface SecurityPattern {
  pattern: RegExp;
  category: string;
  severity: number;  // 1-10
  description: string;
}

const STATIC_PATTERNS: SecurityPattern[] = [
  // Code execution (severity 8-10)
  { pattern: /\beval\s*\(/, category: 'code_exec', severity: 10, description: 'eval() call' },
  { pattern: /\bFunction\s*\(/, category: 'code_exec', severity: 10, description: 'Function() constructor' },
  { pattern: /\bchild_process\b/, category: 'code_exec', severity: 9, description: 'child_process module' },
  { pattern: /\bexec\s*\(/, category: 'code_exec', severity: 9, description: 'exec() call' },
  { pattern: /\bspawn\s*\(/, category: 'code_exec', severity: 8, description: 'spawn() call' },
  { pattern: /\bexecSync\s*\(/, category: 'code_exec', severity: 9, description: 'execSync() call' },
  { pattern: /\brequire\s*\(\s*['"]child_process/, category: 'code_exec', severity: 10, description: 'require child_process' },
  { pattern: /\bimport\s*\(\s*['"]child_process/, category: 'code_exec', severity: 10, description: 'dynamic import child_process' },

  // File system (severity 6-8)
  { pattern: /\bfs\.write/, category: 'filesystem', severity: 7, description: 'fs.write operation' },
  { pattern: /\bfs\.unlink/, category: 'filesystem', severity: 8, description: 'fs.unlink (delete file)' },
  { pattern: /\bfs\.rmdir/, category: 'filesystem', severity: 8, description: 'fs.rmdir (delete directory)' },
  { pattern: /\brm\s+-rf\b/, category: 'filesystem', severity: 10, description: 'rm -rf command' },
  { pattern: /\bprocess\.cwd\s*\(/, category: 'filesystem', severity: 4, description: 'process.cwd() access' },
  { pattern: /\b__dirname\b/, category: 'filesystem', severity: 3, description: '__dirname access' },

  // Network exfiltration (severity 5-8)
  { pattern: /\bfetch\s*\(\s*['"`]http/, category: 'network', severity: 6, description: 'HTTP fetch call' },
  { pattern: /\bhttp\.request\b/, category: 'network', severity: 7, description: 'http.request' },
  { pattern: /\bXMLHttpRequest\b/, category: 'network', severity: 6, description: 'XMLHttpRequest' },
  { pattern: /\bnew\s+WebSocket\b/, category: 'network', severity: 7, description: 'WebSocket connection' },
  { pattern: /\baxios\b/, category: 'network', severity: 5, description: 'axios HTTP client' },

  // Environment access (severity 6-9)
  { pattern: /\bprocess\.env\b/, category: 'env_access', severity: 7, description: 'process.env access' },
  { pattern: /\bdotenv\b/, category: 'env_access', severity: 6, description: 'dotenv module' },
  { pattern: /\brequire\s*\(\s*['"]os['"]/, category: 'env_access', severity: 6, description: 'require os module' },

  // Obfuscation (severity 5-8)
  { pattern: /\batob\s*\(/, category: 'obfuscation', severity: 6, description: 'atob() base64 decode' },
  { pattern: /\bBuffer\.from\s*\(/, category: 'obfuscation', severity: 5, description: 'Buffer.from()' },
  { pattern: /\bString\.fromCharCode\b/, category: 'obfuscation', severity: 7, description: 'String.fromCharCode' },
  { pattern: /\\x[0-9a-f]{2}/i, category: 'obfuscation', severity: 6, description: 'Hex escape sequence' },

  // Crypto mining (severity 10)
  { pattern: /stratum\+tcp/i, category: 'crypto_mining', severity: 10, description: 'Mining pool protocol' },
  { pattern: /\bcoinminer\b/i, category: 'crypto_mining', severity: 10, description: 'Coin miner reference' },

  // SQL injection (severity 7-9)
  { pattern: /\bDROP\s+TABLE\b/i, category: 'sql_injection', severity: 9, description: 'DROP TABLE' },
  { pattern: /\bDELETE\s+FROM\b/i, category: 'sql_injection', severity: 8, description: 'DELETE FROM' },
  { pattern: /\bUNION\s+SELECT\b/i, category: 'sql_injection', severity: 7, description: 'UNION SELECT' },

  // Secret extraction (severity 8-9)
  { pattern: /\bAPI_KEY\b/, category: 'secret_access', severity: 8, description: 'API_KEY reference' },
  { pattern: /\bJWT_SECRET\b/, category: 'secret_access', severity: 9, description: 'JWT_SECRET reference' },
  { pattern: /\bENCRYPTION_KEY\b/, category: 'secret_access', severity: 9, description: 'ENCRYPTION_KEY reference' },
  { pattern: /\bPRIVATE_KEY\b/, category: 'secret_access', severity: 9, description: 'PRIVATE_KEY reference' },
];

// ── Scoring Thresholds ────────────────────────────────────────────────────

const BLOCK_THRESHOLD = 15;
const FLAG_THRESHOLD = 5;

// ── Source Reputation ─────────────────────────────────────────────────────

interface ReputationEntry {
  source: string;
  score: number;        // 0-100 (100 = fully trusted)
  totalScanned: number;
  blocked: number;
  lastSeen: number;
}

const REPUTATION_FILE = join(process.cwd(), 'data', 'skill-reputation.json');

function loadReputation(): Map<string, ReputationEntry> {
  try {
    const data = readFileSync(REPUTATION_FILE, 'utf-8');
    const entries = JSON.parse(data) as ReputationEntry[];
    return new Map(entries.map(e => [e.source, e]));
  } catch {
    return new Map();
  }
}

function saveReputation(rep: Map<string, ReputationEntry>): void {
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(REPUTATION_FILE, JSON.stringify(Array.from(rep.values()), null, 2), 'utf-8');
  } catch {
    // Non-critical
  }
}

const reputationMap = loadReputation();

// ── Scan Result ───────────────────────────────────────────────────────────

export interface SkillScanResult {
  safe: boolean;
  decision: 'PASSED' | 'FLAGGED' | 'BLOCKED';
  score: number;
  findings: Array<{
    category: string;
    severity: number;
    description: string;
    pattern: string;
  }>;
  injectionDetected: boolean;
}

// ── Main Scanner ──────────────────────────────────────────────────────────

/**
 * Comprehensive scan of a skill's content.
 *
 * @param content - The full skill prompt/content to scan
 * @param source - Source identifier (e.g., GitHub repo path) for reputation
 * @returns Scan result with findings and decision
 */
export function scanSkill(content: string, source?: string): SkillScanResult {
  const findings: SkillScanResult['findings'] = [];
  let totalScore = 0;

  // 1. Static pattern analysis
  for (const sp of STATIC_PATTERNS) {
    if (sp.pattern.test(content)) {
      findings.push({
        category: sp.category,
        severity: sp.severity,
        description: sp.description,
        pattern: sp.pattern.source.slice(0, 50),
      });
      totalScore += sp.severity;
    }
  }

  // 2. Prompt injection scan (reuses content-guard patterns)
  const injectionResult = scanForInjection(content);
  if (injectionResult.detected) {
    for (const p of injectionResult.patterns) {
      findings.push({
        category: 'prompt_injection',
        severity: 8,
        description: `Injection pattern: ${p}`,
        pattern: p,
      });
    }
    totalScore += injectionResult.score;
  }

  // 3. Source reputation adjustment
  if (source) {
    const rep = reputationMap.get(source);
    if (rep && rep.score >= 80) {
      // Trusted source — reduce score by 30%
      totalScore = Math.round(totalScore * 0.7);
    } else if (!rep || rep.score < 30) {
      // Unknown/untrusted source — increase score by 20%
      totalScore = Math.round(totalScore * 1.2);
    }
  }

  // 4. Decision
  let decision: SkillScanResult['decision'];
  if (totalScore >= BLOCK_THRESHOLD) {
    decision = 'BLOCKED';
  } else if (totalScore >= FLAG_THRESHOLD) {
    decision = 'FLAGGED';
  } else {
    decision = 'PASSED';
  }

  // 5. Update reputation
  if (source) {
    const rep = reputationMap.get(source) ?? {
      source,
      score: 50,
      totalScanned: 0,
      blocked: 0,
      lastSeen: Date.now(),
    };
    rep.totalScanned++;
    rep.lastSeen = Date.now();
    if (decision === 'BLOCKED') {
      rep.blocked++;
      rep.score = Math.max(0, rep.score - 10);
    } else if (decision === 'PASSED') {
      rep.score = Math.min(100, rep.score + 1);
    }
    reputationMap.set(source, rep);
    saveReputation(reputationMap);
  }

  if (findings.length > 0) {
    logger.info('Skill scan complete', {
      source,
      decision,
      score: totalScore,
      findingCount: findings.length,
      categories: [...new Set(findings.map(f => f.category))],
    });
  }

  return {
    safe: decision === 'PASSED',
    decision,
    score: totalScore,
    findings,
    injectionDetected: injectionResult.detected,
  };
}

/**
 * Get the current reputation score for a source.
 */
export function getReputation(source: string): ReputationEntry | undefined {
  return reputationMap.get(source);
}

/**
 * Get all reputation entries.
 */
export function getAllReputations(): ReputationEntry[] {
  return Array.from(reputationMap.values());
}
