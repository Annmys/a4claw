import { randomBytes } from 'crypto';
import logger from '../utils/logger.js';

export interface KeyRotationConfig {
  rotateIntervalHours: number;
  enabled: boolean;
}

interface KeyEntry {
  key: string;
  createdAt: number;
  rotatedAt: number;
  version: number;
}

const keyStore: Map<string, KeyEntry> = new Map();
let rotationTimer: NodeJS.Timeout | null = null;
let rotationConfig: KeyRotationConfig = { rotateIntervalHours: 72, enabled: false };

/**
 * Generate a new cryptographically secure key
 */
function generateKey(length: number = 64): string {
  return randomBytes(length).toString('hex');
}

/**
 * Initialize key rotation with configuration
 */
export function initKeyRotation(config: KeyRotationConfig): void {
  rotationConfig = config;

  if (!config.enabled) {
    logger.info('Key rotation disabled');
    return;
  }

  // Start rotation timer
  const intervalMs = config.rotateIntervalHours * 60 * 60 * 1000;
  rotationTimer = setInterval(() => {
    rotateAllKeys();
  }, intervalMs);

  logger.info('Key rotation initialized', {
    intervalHours: config.rotateIntervalHours,
  });
}

/**
 * Register a key for rotation management
 */
export function registerKey(name: string, currentValue: string): void {
  keyStore.set(name, {
    key: currentValue,
    createdAt: Date.now(),
    rotatedAt: Date.now(),
    version: 1,
  });
}

/**
 * Rotate a specific key
 */
export function rotateKey(name: string): { oldKey: string; newKey: string } | null {
  const entry = keyStore.get(name);
  if (!entry) return null;

  const oldKey = entry.key;
  const newKey = generateKey();

  entry.key = newKey;
  entry.rotatedAt = Date.now();
  entry.version++;

  logger.info(`Key rotated: ${name}`, { version: entry.version });
  return { oldKey, newKey };
}

/**
 * Rotate all managed keys
 */
export function rotateAllKeys(): Map<string, { oldKey: string; newKey: string }> {
  const results = new Map<string, { oldKey: string; newKey: string }>();

  for (const name of keyStore.keys()) {
    const result = rotateKey(name);
    if (result) {
      results.set(name, result);
    }
  }

  logger.info(`Rotated ${results.size} keys`);
  return results;
}

/**
 * Get the current key value
 */
export function getKey(name: string): string | null {
  return keyStore.get(name)?.key ?? null;
}

/**
 * Get key metadata (without the actual key value)
 */
export function getKeyMeta(name: string): { version: number; rotatedAt: number; ageHours: number } | null {
  const entry = keyStore.get(name);
  if (!entry) return null;

  return {
    version: entry.version,
    rotatedAt: entry.rotatedAt,
    ageHours: Math.round((Date.now() - entry.rotatedAt) / (60 * 60 * 1000)),
  };
}

/**
 * Check if any keys need rotation (past their interval)
 */
export function getKeysNeedingRotation(): string[] {
  const threshold = rotationConfig.rotateIntervalHours * 60 * 60 * 1000;
  const staleKeys: string[] = [];

  for (const [name, entry] of keyStore) {
    if (Date.now() - entry.rotatedAt > threshold) {
      staleKeys.push(name);
    }
  }

  return staleKeys;
}

/**
 * Stop key rotation
 */
export function stopKeyRotation(): void {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

/**
 * Get rotation status summary
 */
export function getRotationStatus(): { enabled: boolean; managedKeys: number; intervalHours: number; keysNeedingRotation: number } {
  return {
    enabled: rotationConfig.enabled,
    managedKeys: keyStore.size,
    intervalHours: rotationConfig.rotateIntervalHours,
    keysNeedingRotation: getKeysNeedingRotation().length,
  };
}
