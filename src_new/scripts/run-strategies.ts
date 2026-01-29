#!/usr/bin/env npx ts-node
/**
 * RUN STRATEGIES CLI
 *
 * Run whale trading strategies from command line.
 *
 * Usage:
 *   npx ts-node src_new/scripts/run-strategies.ts [options]
 *
 * Options:
 *   --live        Run in live mode (default: dry run)
 *   --mirror      Enable only mirror strategy
 *   --smart       Enable only smart strategy
 *   --safe        Enable only safe strategy
 *   --all         Enable all strategies (default)
 */

import MultiStrategyBot from '../bot/multi-strategy-bot';

const args = process.argv.slice(2);

// Parse arguments
const isLive = args.includes('--live');
const enableAll = args.includes('--all') || (!args.includes('--mirror') && !args.includes('--smart') && !args.includes('--safe'));
const enableMirror = enableAll || args.includes('--mirror');
const enableSmart = enableAll || args.includes('--smart');
const enableSafe = enableAll || args.includes('--safe');

console.log('\n🐋 Whale Trading Strategies\n');
console.log(`Mode: ${isLive ? '🔴 LIVE' : '🟢 DRY RUN'}`);
console.log(`Mirror: ${enableMirror ? '✅' : '❌'}`);
console.log(`Smart: ${enableSmart ? '✅' : '❌'}`);
console.log(`Safe: ${enableSafe ? '✅' : '❌'}`);
console.log('');

if (isLive) {
  console.log('⚠️  WARNING: Running in LIVE mode!');
  console.log('   Real trades will be executed.');
  console.log('   Press Ctrl+C within 5 seconds to cancel...\n');

  // Give user time to cancel
  setTimeout(async () => {
    await startBot();
  }, 5000);
} else {
  startBot();
}

async function startBot() {
  const bot = new MultiStrategyBot({
    dryRun: !isLive,
    enableMirror,
    enableSmart,
    enableSafe
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    bot.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    bot.stop();
    process.exit(1);
  });

  // Start
  try {
    await bot.start();
    console.log('\n✅ Bot running. Press Ctrl+C to stop.\n');
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
}
