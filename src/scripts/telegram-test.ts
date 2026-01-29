/**
 * Telegram Bot Test
 * Bot'ların doğru çalıştığını test et
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { TelegramNotifier } from '../notifications/telegram-notifier';
import { MarketRegistry } from '../database/market-registry';

async function testTelegram() {
  console.log('🧪 Testing Telegram Bot System...\n');

  // Check environment variables
  console.log('📋 Environment Check:');
  console.log(`   NEW_MARKETS_BOT_TOKEN: ${process.env.TELEGRAM_NEW_MARKETS_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`   NEW_MARKETS_CHAT_ID: ${process.env.TELEGRAM_NEW_MARKETS_CHAT_ID || '❌'}`);
  console.log(`   TRADES_BOT_TOKEN: ${process.env.TELEGRAM_TRADES_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`   TRADES_CHAT_ID: ${process.env.TELEGRAM_TRADES_CHAT_ID || '❌'}`);
  console.log(`   TRACKED_BOT_TOKEN: ${process.env.TELEGRAM_TRACKED_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`   TRACKED_CHAT_ID: ${process.env.TELEGRAM_TRACKED_CHAT_ID || '❌'}\n`);

  // Check if any bot is configured
  const hasAnyBot =
    process.env.TELEGRAM_NEW_MARKETS_BOT_TOKEN ||
    process.env.TELEGRAM_TRADES_BOT_TOKEN ||
    process.env.TELEGRAM_TRACKED_BOT_TOKEN;

  if (!hasAnyBot) {
    console.log('⚠️  No Telegram bot configured');
    console.log('📖 Follow TELEGRAM_SETUP.ts to create and configure bots\n');
    console.log('To test, set at least one bot:');
    console.log('   TELEGRAM_NEW_MARKETS_BOT_TOKEN=your_token_here');
    console.log('   TELEGRAM_NEW_MARKETS_CHAT_ID=your_chat_id_here\n');
    return;
  }

  // Initialize notifier (this will start polling)
  console.log('🚀 Initializing Telegram bots...\n');
  const notifier = new TelegramNotifier();

  console.log('\n✅ Bots initialized successfully!');
  console.log('\n📱 Bot Commands:');
  console.log('\nBot 1 (New Markets):');
  console.log('   /stats - Market statistics');
  console.log('   /new24h - Markets added in last 24h');
  console.log('   /categories - Market categories');
  console.log('\nBot 2 (Trades):');
  console.log('   /start - Welcome message');
  console.log('   /balance - Account balance');
  console.log('   /positions - Open positions');
  console.log('\nBot 3 (Tracked):');
  console.log('   /start - Welcome message');
  console.log('   /tracked - Tracked markets');
  console.log('   /untracked - Untracked markets');

  console.log('\n🔔 Bots are now listening for commands...');
  console.log('📱 Open Telegram and try the commands above');
  console.log('Press Ctrl+C to stop\n');

  // Test notification (if chat IDs are set)
  if (process.env.TELEGRAM_NEW_MARKETS_CHAT_ID) {
    console.log('📤 Sending test notification to New Markets bot...');
    const registry = new MarketRegistry();
    const markets = registry.getAllMarkets();
    if (markets.length > 0) {
      await notifier.notifyNewMarket(markets[0]);
      console.log('✅ Test notification sent!\n');
    }
  }

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping bots...');
    notifier.stop();
    process.exit(0);
  });
}

// Run
testTelegram().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
