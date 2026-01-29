import { LiveScore6TradingBot } from './src/bot/livescore-trading-bot';

/**
 * 🤖 LIVE BOT - Production Run
 * 
 * São Paulo vs Flamengo maçını izliyor
 * Gol olursa otomatik trade yapıyor
 */

async function runLiveBot() {
  console.log('🤖 STARTING LIVE SPORTS TRADING BOT\n');
  console.log('='.repeat(70));
  console.log('');
  console.log('⚽ Monitoring: São Paulo vs Flamengo (HT: 1-1)');
  console.log('📡 SLUG Method: bra-sao-fla-2025-11-05');
  console.log('🎯 Strategy: Goal-based trading');
  console.log('⏱️  Check interval: 15 seconds');
  console.log('');
  console.log('='.repeat(70));
  console.log('');
  
  const bot = new LiveScore6TradingBot();
  
  try {
    await bot.start();
    
    console.log('\n✅ Bot started successfully!');
    console.log('🔴 Monitoring live matches...\n');
    
    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down bot...\n');
      await bot.stop();
      process.exit(0);
    });
    
  } catch (error: any) {
    console.error('\n❌ BOT ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runLiveBot().catch(console.error);
