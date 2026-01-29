#!/usr/bin/env node
/**
 * BOT ENTRY POINT
 * 
 * Usage:
 *   npm run new:bot:dry           - DRY RUN mode
 *   npm run new:bot:live          - LIVE mode
 *   npm run new:bot:live telegram - LIVE + Telegram
 */

import dotenv from 'dotenv';
import { ProductionBot } from './production-bot';

// ⚡ Load .env file FIRST!
dotenv.config();

// Parse arguments
const args = process.argv.slice(2);
const isLive = args.includes('--live');
const enableTelegram = args.includes('telegram') || args.includes('--telegram');

console.log('\n🤖 POLYSPORT PRODUCTION BOT');
console.log('━'.repeat(42));
console.log(`📊 Mode: ${isLive ? '⚠️  LIVE (gerçek trade)' : '⚠️  DRY RUN (test modu)'}`);
console.log(`⏱️  Update: Her 2 saatte bir`);
console.log(`📈 Max Concurrent: 50 maç`);
console.log(`📱 Telegram: ${enableTelegram ? 'AKTIF ✅' : 'KAPALI'}`);
console.log('━'.repeat(42));
console.log('');

// Create and start bot
const bot = new ProductionBot({
  dryRun: !isLive,
  updateInterval: 2,
  maxConcurrentMatches: 50,
  cleanupInterval: 1,
  enableTelegram
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  SIGINT signal alındı...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  SIGTERM signal alındı...');
  await bot.stop();
  process.exit(0);
});

// Start bot
(async () => {
  try {
    await bot.start();
  } catch (error) {
    console.error('❌ Bot başlatılamadı:', error);
    process.exit(1);
  }
})();
