/**
 * WHALE TRADING STRATEGIES - Main Export
 */

// Types
export * from './types';

// Base
export { BaseStrategy } from './base-strategy';

// Strategies
export { MirrorStrategy, MIRROR_DEFAULT_CONFIG } from './mirror-strategy';
export { SmartStrategy, SMART_DEFAULT_CONFIG } from './smart-strategy';
export { SafeStrategy, SAFE_DEFAULT_CONFIG } from './safe-strategy';
