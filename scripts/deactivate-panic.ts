
import { deactivatePanic } from '../src/core/kill-switch.js';
import logger from '../src/utils/logger.js';

async function run() {
  logger.info('Attempting to deactivate PANIC MODE...');
  await deactivatePanic('manual-script');
  logger.info('PANIC MODE deactivation command sent.');
}

run().catch((err) => {
  logger.error('Failed to deactivate PANIC MODE', { error: err.message });
  process.exit(1);
});
