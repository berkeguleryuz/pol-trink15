/**
 * Test Market Scanner
 * Tests the market scanning and opportunity detection system
 */

import { PolymarketClient } from '../src/client';
import { MarketScanner } from '../src/strategies/market-scanner';
import { TimezoneUtils } from '../src/utils/timezone';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  MARKET SCANNER TEST');
  console.log('='.repeat(70) + '\n');

  TimezoneUtils.log(`Current time: ${TimezoneUtils.formatBerlinTime()}`, 'INFO');
  TimezoneUtils.log(`Trading hours: ${TimezoneUtils.isWithinTradingHours() ? 'YES' : 'NO'}`, 'INFO');
  TimezoneUtils.log(`Prime hours: ${TimezoneUtils.isPrimeTradingHours() ? 'YES' : 'NO'}`, 'INFO');

  console.log('\n' + '='.repeat(70));
  console.log('📊 Initializing Scanner...');
  console.log('='.repeat(70) + '\n');

  // Initialize client
  const client = await PolymarketClient.create();

  // Create scanner with config
  const scanner = new MarketScanner(client, {
    scanIntervalMinutes: 5,
    minLiquidity: 5000, // $5K minimum
    minVolume24h: 1000, // $1K minimum
    priceChangeThreshold: 5, // 5% change detection
    maxMarketsToScan: 200,
  });

  // Initialize scanner (fetch baseline)
  await scanner.initialize();

  console.log('\n' + '='.repeat(70));
  console.log('🔍 Running First Scan...');
  console.log('='.repeat(70) + '\n');

  // Run scan
  const opportunities = await scanner.scan();

  // Display results
  console.log('\n' + '='.repeat(70));
  console.log('📈 SCAN RESULTS');
  console.log('='.repeat(70) + '\n');

  if (opportunities.length === 0) {
    console.log('No opportunities found in this scan.\n');
    console.log('💡 Tip: Run multiple scans to detect price changes\n');
  } else {
    console.log(`Found ${opportunities.length} opportunities:\n`);

    // Sort by entry score (highest first)
    opportunities.sort((a, b) => b.entryScore - a.entryScore);

    // Display top 10 opportunities
    const topOpportunities = opportunities.slice(0, 10);

    for (let i = 0; i < topOpportunities.length; i++) {
      const opp = topOpportunities[i];
      
      console.log(`\n[${i + 1}] ${opp.marketQuestion}`);
      console.log(`   Side: ${opp.side}`);
      console.log(`   Price: $${opp.currentPrice.toFixed(4)} (${(opp.currentPrice * 100).toFixed(1)}%)`);
      console.log(`   Entry Score: ${opp.entryScore}/100`);
      console.log(`   Liquidity: $${opp.liquidity.toFixed(0)}`);
      console.log(`   Volume 24h: $${opp.volume24h.toFixed(0)}`);
      console.log(`   Reasons:`);
      
      for (const reason of opp.reason) {
        console.log(`      • ${reason}`);
      }
      
      if (opp.endDate) {
        const endDate = new Date(opp.endDate);
        console.log(`   End Date: ${endDate.toLocaleDateString('de-DE')}`);
      }
    }

    if (opportunities.length > 10) {
      console.log(`\n... and ${opportunities.length - 10} more opportunities\n`);
    }
  }

  // Display scanner status
  console.log('\n' + '='.repeat(70));
  console.log('📊 SCANNER STATUS');
  console.log('='.repeat(70) + '\n');

  const status = scanner.getStatus();
  console.log(`Scanning: ${status.scanning ? 'YES' : 'NO'}`);
  console.log(`Known Markets: ${status.knownMarkets}`);
  console.log(`Last Scan: ${status.lastScan ? TimezoneUtils.formatBerlinTime(status.lastScan) : 'Never'}`);
  console.log(`Within Trading Hours: ${status.isWithinTradingHours ? 'YES' : 'NO'}`);
  console.log(`Prime Trading Hours: ${status.isPrimeTradingHours ? 'YES' : 'NO'}\n`);

  console.log('='.repeat(70));
  console.log('✅ SCANNER TEST COMPLETED');
  console.log('='.repeat(70) + '\n');

  console.log('💡 Next steps:');
  console.log('   1. Run scanner continuously with: npm run bot:scanner');
  console.log('   2. Scanner will detect price changes over time');
  console.log('   3. New markets will be logged automatically');
  console.log('   4. Opportunities scored 70+ are good entry points\n');

  console.log('📁 Logs saved to:');
  console.log('   - logs/new_markets.jsonl (new markets)');
  console.log('   - logs/markets_*.jsonl (all market data)');
  console.log('   - logs/readable/markets_summary_*.txt (top opportunities)\n');
}

// Run the test
main().catch(error => {
  console.error('❌ Scanner test failed:', error.message);
  process.exit(1);
});
