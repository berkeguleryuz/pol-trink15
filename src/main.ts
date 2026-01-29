#!/usr/bin/env ts-node

/**
 * Polymarket Trading Bot - Main Entry Point
 * 
 * Usage:
 *   npm start              - Run normal bot (news-driven trading)
 *   npm run bot:sport      - Run sports betting bot
 *   npm run bot:test       - Test run (dry run, no actual trades)
 */

import { PerplexityAI } from './integrations/perplexity-ai';
import { SportsAPI } from './integrations/sports-api';
import { MarketScanner } from './strategies/market-scanner';
import { CoreTradingStrategy } from './strategies/core-strategy';
import { DynamicPricingStrategy } from './strategies/dynamic-pricing';
import { RiskManager } from './risk/risk-manager';
import { PolymarketClient } from './client';
import { config } from './config';
import { TimezoneUtils } from './utils/timezone';

// Parse command line arguments
const args = process.argv.slice(2);
const MODE = args.includes('--sport') ? 'SPORT' : 'NORMAL';
const DRY_RUN = !args.includes('--live'); // Default to dry run for safety
const SCAN_INTERVAL = MODE === 'SPORT' ? 2 : 5; // minutes

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`🤖 POLYMARKET TRADING BOT`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📍 Location: Europe/Berlin (${TimezoneUtils.formatBerlinTime()})`);
console.log(`🎯 Mode: ${MODE}`);
console.log(`⚡ Trading: ${DRY_RUN ? 'DRY RUN (No actual trades) ⚠️' : 'LIVE MODE ✅'}`);
console.log(`⏱️  Scan Interval: ${SCAN_INTERVAL} minutes`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// Initialize systems (async)
let client: PolymarketClient;
let scanner: MarketScanner;
let tradingStrategy: CoreTradingStrategy;
let pricingStrategy: DynamicPricingStrategy;
let riskManager: RiskManager;
let perplexityAI: PerplexityAI;
let sportsAPI: SportsAPI;

async function initializeSystems() {
  console.log(`🔄 Initializing systems...`);
  client = await PolymarketClient.create();
  scanner = new MarketScanner(client);
  tradingStrategy = new CoreTradingStrategy(client.getClient());
  pricingStrategy = new DynamicPricingStrategy();
  riskManager = new RiskManager(19.96); // Starting balance
  perplexityAI = new PerplexityAI();
  sportsAPI = new SportsAPI();
  console.log(`✅ Systems initialized\n`);
  
  // Show initial setup
  riskManager.logRiskSummary();
  pricingStrategy.logExitLevels();
}

let running = true;

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n🛑 Shutting down gracefully...`);
  running = false;
  process.exit(0);
});

async function runNormalMode() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📰 NORMAL MODE - News-Driven Trading`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Fetch news
  console.log(`🔍 Fetching latest news from Perplexity AI...`);
  const [financeNews, techNews] = await Promise.all([
    perplexityAI.getFinanceNews(),
    perplexityAI.getTechNews(),
  ]);
  console.log(`✅ Collected: ${financeNews.length} finance, ${techNews.length} tech news\n`);

  // Scan markets
  console.log(`🔍 Scanning Polymarket...`);
  const opportunities = await scanner.scan();
  console.log(`✅ Found ${opportunities.length} potential opportunities\n`);

  if (opportunities.length > 0) {
    console.log(`🎯 Top Opportunities:`);
    opportunities.slice(0, 5).forEach((opp, i) => {
      console.log(`  ${i + 1}. ${opp.marketQuestion}`);
      console.log(`     Price: ${(opp.currentPrice * 100).toFixed(1)}% | Score: ${opp.entryScore}/100`);
    });
  } else {
    console.log(`ℹ️  No strong opportunities at this time.`);
  }

  riskManager.logRiskSummary();
}

async function runSportMode() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⚽ SPORT MODE - Live Match Betting`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Get live matches
  console.log(`🔍 Fetching live matches...`);
  const matches = await sportsAPI.getLiveMatches();
  console.log(`✅ Found ${matches.length} live matches\n`);

  let totalSignals = 0;
  for (const match of matches) {
    const signals = sportsAPI.detectTradingSignals(match);
    if (signals.length > 0) {
      console.log(`⚽ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
      signals.forEach(signal => {
        console.log(`  🎯 ${signal.signal}: ${signal.suggestedMarket} - ${signal.confidence} confidence`);
        console.log(`     Reason: ${signal.reason}`);
      });
      totalSignals += signals.length;
    }
  }

  if (totalSignals === 0) {
    console.log(`ℹ️  No trading signals detected.`);
  }

  riskManager.logRiskSummary();
}

async function mainLoop() {
  console.log(`\n🚀 Starting main loop...\n`);

  await scanner.initialize();
  console.log(`✅ Systems initialized\n`);

  while (running) {
    try {
      console.log(`\n⏰ [${TimezoneUtils.formatBerlinTime()}] Running scan cycle...`);

      // Check if we can still trade
      const balance = 19.96; // TODO: Get actual balance from client
      riskManager.updateBalance(balance);

      if (riskManager.isEmergencyStop()) {
        console.log(`\n🚨 EMERGENCY STOP ACTIVE - Monitoring only\n`);
      } else {
        // Run appropriate mode
        if (MODE === 'NORMAL') {
          await runNormalMode();
        } else {
          await runSportMode();
        }
      }

      // Wait for next scan
      console.log(`\n⏱️  Next scan in ${SCAN_INTERVAL} minutes...\n`);
      await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL * 60 * 1000));

    } catch (error) {
      console.error(`❌ Error in main loop:`, error);
      console.log(`⏱️  Retrying in 1 minute...`);
      await new Promise(resolve => setTimeout(resolve, 60 * 1000));
    }
  }
}

// Start the bot
(async () => {
  await initializeSystems();
  await mainLoop();
})().catch(error => {
  console.error(`💥 Fatal error:`, error);
  process.exit(1);
});
