import { Engine } from './engine.js';

let engineInstance: Engine | null = null;

export function getEngine(): Engine {
  if (!engineInstance) {
    engineInstance = new Engine();
  }
  return engineInstance;
}

export function resetEngine(): void {
  engineInstance = null;
}
