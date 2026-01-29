/**
 * Sports Trading Bot Test
 * Test all components with simulated data
 */

import { PolymarketClient } from '../src/client';
import { MainSportsBot } from '../src/bot/sports-bot';
import { TimezoneUtils } from '../src/utils/timezone';

async function main() {
  console.log('\n⚽ ===== SPORTS TRADING BOT TEST ===== ⚽\n');
  console.log(`Time: ${TimezoneUtils.formatBerlinTime()}`);
  console.log(`Mode: DRY RUN (Safe testing)\n`);

  try {
    // Initialize client
    console.log('🔧 Initializing Polymarket client...');
    const client = await PolymarketClient.create();
    console.log('✅ Client initialized\n');

    // Create bot
    console.log('🤖 Creating Sports Bot...');
    const bot = new MainSportsBot(client, {
      dryRun: true, // ALWAYS dry run for tests
      scanIntervalSeconds: 60, // Scan every minute
      profitCheckIntervalSeconds: 120, // Check profits every 2 min
      minLiquidity: 5000,
      maxPositionSize: 2.0,
    });
    console.log('✅ Bot created\n');

    // Start bot
    console.log('🚀 Starting bot...\n');
    await bot.start();

    // Run for 5 minutes then stop
    console.log('⏱️  Test will run for 5 minutes...\n');
    console.log('Press Ctrl+C to stop early\n');

    // Print status every 30 seconds
    const statusInterval = setInterval(() => {
      bot.printStatus();
    }, 30 * 1000);

    // Stop after 5 minutes
    setTimeout(() => {
      console.log('\n⏰ Test duration complete');
      clearInterval(statusInterval);
      bot.stop();
      
      // Final status
      bot.printStatus();
      
      console.log('\n✅ Test completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Review the output above');
      console.log('   2. Check if markets are being scanned');
      console.log('   3. Verify Telegram signals (simulated)');
      console.log('   4. When ready, set dryRun: false for live trading');
      console.log('\n⚠️  IMPORTANT: Always start with small amounts in live mode!\n');
      
      process.exit(0);
    }, 5 * 60 * 1000); // 5 minutes

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Test interrupted by user');
  process.exit(0);
});

main();
