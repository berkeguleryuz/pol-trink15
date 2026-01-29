/**
 * Debug Market Data Structure
 * Shows raw market data structure
 */

import { getActiveMarkets } from '../src/markets';
import { logger } from '../src/utils/logger';

async function main() {
  logger.section('DEBUG MARKET DATA');
  
  const markets = await getActiveMarkets({ limit: 20, closed: false });
  
  console.log(`\nFound ${markets.length} markets\n`);
  
  // Find a market with tokens
  const marketWithTokens = markets.find(m => m.tokens && m.tokens.length > 0);
  
  if (marketWithTokens) {
    console.log('\n📊 Market WITH Tokens:\n');
    console.log(JSON.stringify(marketWithTokens, null, 2));
  } else {
    console.log('\n⚠️ No markets with tokens found. Showing first market:\n');
    if (markets.length > 0) {
      console.log(JSON.stringify(markets[0], null, 2));
    }
  }
}

main();
