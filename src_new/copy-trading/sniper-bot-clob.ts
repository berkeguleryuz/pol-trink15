/**
 * SNIPER BOT v6 - CLOB MIDPOINT
 *
 * CLOB /midpoint API ile gerçek zamanlı fiyat takibi
 * Gamma API'den daha doğru ve hızlı!
 *
 * Strateji:
 * - Phase 1 (181-125s): 82¢+ al, <80¢ dur
 * - Phase 2 (125-60s):  85¢+ doldur ($30)
 * - Phase 3 (<60s):     90¢+ SPAM AL (unlimited)
 *
 * Usage:
 *   npx ts-node src_new/copy-trading/sniper-bot-clob.ts          # Dry run
 *   npx ts-node src_new/copy-trading/sniper-bot-clob.ts --live   # Live
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { RelayClient, RelayerTxType } from '@polymarket/builder-relayer-client';
import { BuilderConfig } from '@polymarket/builder-signing-sdk';
import { PolymarketClientWrapper } from '../trading/polymarket-client';
import dotenv from 'dotenv';

dotenv.config();

// Claim için sabitler
const CTF_ADDRESS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const USDCe_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const RELAYER_URL = 'https://relayer-v2.polymarket.com/';

const ctfInterface = new ethers.utils.Interface([
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] indexSets)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)'
]);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Timing (saniye)
  entryWindowStart: 181,      // 3 dk kala başla
  entryWindowEnd: 0,          // Son saniyeye kadar al

  // Phase boundaries
  phase2Start: 125,           // ~2 dk kala → Phase 2
  phase3Start: 60,            // 1 dk kala → Phase 3 (unlimited)

  // Price thresholds per phase
  phase1MinPrice: 0.85,       // Phase 1: 85¢+ al
  phase1StopPrice: 0.80,      // Phase 1: 80¢ altına düşerse DUR
  phase2MinPrice: 0.88,       // Phase 2: 88¢+ doldur
  phase3MinPrice: 0.90,       // Phase 3: 90¢+

  // RISK MANAGEMENT
  stopLossPrice: 0.50,        // Elimdeki 50¢ altına düşerse SAT
  flipMinPrice: 0.83,         // Stop-loss sonrası diğer taraf 83¢+ ise FLIP
  flipMaxSpend: 20,           // Flip için max $20

  // Trade sizing
  perTradeAmount: 2,          // Her alım $2
  maxTotalPerMarket: 20,      // Normal limit ($20)
  phase3MaxPerMarket: 20,     // Phase 3 max $20

  // Trade cooldown
  phase1CooldownMs: 5000,     // Phase 1: 5 saniye (yavaş)
  phase2CooldownMs: 2000,     // Phase 2: 2 saniye
  phase3CooldownMs: 500,      // Phase 3: 500ms (daha yavaş)

  // Polling interval
  pollIntervalMs: 500,        // Her 500ms'de fiyat kontrol

  // Target markets
  targetCryptos: ['btc', 'eth', 'sol'],

  // Mode
  dryRun: !process.argv.includes('--live'),

  // APIs
  clobApi: 'https://clob.polymarket.com',
  gammaApi: 'https://gamma-api.polymarket.com'
};

// ============================================================================
// COLORS
// ============================================================================

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

// ============================================================================
// TYPES
// ============================================================================

interface MarketState {
  slug: string;
  title: string;
  coin: string;
  upPrice: number;
  downPrice: number;
  upTokenId: string;
  downTokenId: string;
  conditionId: string;
  endTime: number;
  lastUpdate: number;
  lastTradeTime: number;
  totalSpent: number;
  currentSide: 'Up' | 'Down' | null;
  shares: number;
}

function getTime(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false, timeZone: 'Europe/Berlin' });
}

// CLOB client'ın verbose loglarını sustur
// Original console fonksiyonlarını bir kez kaydet (race condition önlemek için)
const _originalLog = console.log.bind(console);
const _originalError = console.error.bind(console);
let _silentDepth = 0;

async function silentExec<T>(fn: () => Promise<T>): Promise<T> {
  _silentDepth++;
  if (_silentDepth === 1) {
    console.log = () => {};
    console.error = () => {};
  }
  try {
    return await fn();
  } finally {
    _silentDepth--;
    if (_silentDepth === 0) {
      console.log = _originalLog;
      console.error = _originalError;
    }
  }
}

// ============================================================================
// SNIPER BOT
// ============================================================================

class SniperBotClob {
  private client: ClobClient | null = null;
  private wallet: ethers.Wallet | null = null;
  private provider: ethers.providers.JsonRpcProvider | null = null;
  private relayClient: RelayClient | null = null;
  private running = false;
  private markets: Map<string, MarketState> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private marketRefreshTimer: NodeJS.Timeout | null = null;
  private claimTimer: NodeJS.Timeout | null = null;
  private lastClaimMinute: number = -1; // Track last claim time to avoid duplicates

  private stats = {
    tradesExecuted: 0,
    totalSpent: 0,
    expectedProfit: 0,
    claimed: 0
  };

  private logsDir: string;

  constructor() {
    this.logsDir = path.join(__dirname, '../../data/period-logs');
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private getPeriodLogPath(title: string): string {
    const match = title.match(/(\w+)\s+(\d{1,2}),?\s+(\d{1,2}:\d{2}(?:AM|PM))-(\d{1,2}:\d{2}(?:AM|PM))/i);
    if (match) {
      const [, month, day, startTime, endTime] = match;
      const sanitizedTime = `${month}-${day}_${startTime}-${endTime}`.replace(/:/g, '-');
      return path.join(this.logsDir, `sniper_clob_${sanitizedTime}.log`);
    }
    return path.join(this.logsDir, 'sniper_clob_unknown.log');
  }

  private logToPeriod(market: MarketState, message: string): void {
    const logPath = this.getPeriodLogPath(market.title);
    const timestamp = getTime();
    const line = `[${timestamp}] ${market.coin} ${message}\n`;
    try {
      fs.appendFileSync(logPath, line);
    } catch { }
  }

  async start(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}🎯 SNIPER BOT v6${C.reset} - CLOB Midpoint API`);
    console.log('='.repeat(60));
    console.log(`   Mode: ${CONFIG.dryRun ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    console.log(`   Price Source: CLOB /midpoint (real-time)`);
    console.log(`   Poll Interval: ${CONFIG.pollIntervalMs}ms`);
    console.log('');
    console.log(`   1️⃣  Phase 1 (181-125s): ${CONFIG.phase1MinPrice * 100}¢+ al, <80¢ dur | 5s`);
    console.log(`   2️⃣  Phase 2 (125-60s): ${CONFIG.phase2MinPrice * 100}¢+ doldur $${CONFIG.maxTotalPerMarket} | 2s`);
    console.log(`   🚀 Phase 3 (<1 dk):  ${CONFIG.phase3MinPrice * 100}¢+ | $${CONFIG.phase3MaxPerMarket} max | ${CONFIG.phase3CooldownMs}ms`);
    console.log('');
    console.log(`   ${C.yellow}RISK MANAGEMENT:${C.reset}`);
    console.log(`   🛡️  Stop-Loss: <${CONFIG.stopLossPrice * 100}¢ → SAT`);
    console.log(`   🔄 Flip: Stop sonrası diğer taraf ${CONFIG.flipMinPrice * 100}¢+ → AL (max $${CONFIG.flipMaxSpend})`);
    console.log('='.repeat(60) + '\n');

    // Init client for live mode
    if (!CONFIG.dryRun) {
      console.log('📡 Initializing Polymarket client...');
      const wrapper = await PolymarketClientWrapper.create();
      this.client = wrapper.getClient();

      // Wallet for claim
      const privateKey = process.env.PRIVATE_KEY;
      if (privateKey) {
        this.provider = new ethers.providers.JsonRpcProvider(process.env.CHAINSTACK_HTTP_URL || process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
        this.wallet = new ethers.Wallet(privateKey, this.provider);

        // Initialize RelayClient for gasless claim
        const builderKey = process.env.POLY_BUILDER_API_KEY || process.env.POLYMARKET_BUILDER_API_KEY;
        const builderSecret = process.env.POLY_BUILDER_SECRET || process.env.POLYMARKET_BUILDER_SECRET;
        const builderPass = process.env.POLY_BUILDER_PASSPHRASE || process.env.POLYMARKET_BUILDER_PASSPHRASE;

        if (builderKey && builderSecret && builderPass) {
          const builderConfig = new BuilderConfig({
            localBuilderCreds: {
              key: builderKey,
              secret: builderSecret,
              passphrase: builderPass
            }
          });
          this.relayClient = new RelayClient(
            RELAYER_URL,
            137,
            this.wallet,
            builderConfig,
            RelayerTxType.SAFE
          );
          console.log('   ✅ Client + Gasless Claim ready\n');
        } else {
          console.log('   ✅ Client ready (no gasless claim - missing Builder keys)\n');
        }
      } else {
        console.log('   ✅ Client ready (no claim)\n');
      }
    }

    this.running = true;

    // Initial market discovery
    await this.discoverMarkets();

    // Periodic market refresh (every 30s)
    this.marketRefreshTimer = setInterval(() => {
      this.discoverMarkets();
    }, 30000);

    // Main polling loop
    this.pollTimer = setInterval(() => {
      this.pollPrices();
    }, CONFIG.pollIntervalMs);

    // Auto-claim timer - runs every 30 seconds, claims at XX:05, XX:20, XX:35, XX:50
    if (this.relayClient) {
      this.claimTimer = setInterval(() => {
        this.checkAndClaimGasless();
      }, 30000);
      console.log('   💰 Auto-claim enabled (XX:05/07, XX:20/22, XX:35/37, XX:50/52)');
    }

    console.log('🎯 Sniper active! Using CLOB /midpoint for real-time prices...\n');
  }

  /**
   * Discover active 15-min crypto markets from Gamma API
   */
  private async discoverMarkets(): Promise<void> {
    const now = Date.now();
    const currentInterval = Math.floor(now / (15 * 60 * 1000)) * (15 * 60 * 1000);
    const timestamps = [
      Math.floor(currentInterval / 1000),
      Math.floor((currentInterval + 15 * 60 * 1000) / 1000)
    ];

    for (const crypto of CONFIG.targetCryptos) {
      let foundMarket = false;

      for (const ts of timestamps) {
        if (foundMarket) break;

        const slug = `${crypto}-updown-15m-${ts}`;

        // Skip if already tracking
        if (this.markets.has(slug)) {
          foundMarket = true;
          continue;
        }

        try {
          const res = await axios.get(`${CONFIG.gammaApi}/markets?slug=${slug}`, { timeout: 5000 });

          if (!res.data || res.data.length === 0) continue;

          const market = res.data[0];
          if (market.closed) continue;

          const endTime = new Date(market.endDate || market.endDateIso).getTime();
          if (endTime < now || endTime > now + 20 * 60 * 1000) continue;

          const outcomes = JSON.parse(market.outcomes || '[]');
          const tokenIds = JSON.parse(market.clobTokenIds || '[]');

          let upTokenId = '', downTokenId = '';
          for (let i = 0; i < outcomes.length; i++) {
            if (outcomes[i].toLowerCase() === 'up') upTokenId = tokenIds[i];
            if (outcomes[i].toLowerCase() === 'down') downTokenId = tokenIds[i];
          }

          if (!upTokenId || !downTokenId) continue;

          this.markets.set(slug, {
            slug,
            title: market.question || market.groupItemTitle,
            coin: crypto.toUpperCase(),
            upPrice: 0.5,
            downPrice: 0.5,
            upTokenId,
            downTokenId,
            conditionId: market.conditionId,
            endTime,
            lastUpdate: 0,
            lastTradeTime: 0,
            totalSpent: 0,
            currentSide: null,
            shares: 0
          });

          const remainingSec = Math.floor((endTime - now) / 1000);
          const timeMatch = market.question?.match(/(\w+\s+\d+),?\s+(\d+:\d+[AP]M)-(\d+:\d+[AP]M)/i);
          const timeRange = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}-${timeMatch[3]}` : '';

          console.log(`[${getTime()}] ${C.green}✅ ${crypto.toUpperCase()}${C.reset}: ${timeRange} | ${remainingSec}s left`);

          foundMarket = true;
        } catch {
          continue;
        }
      }
    }

    // Clean expired markets
    for (const [slug, market] of this.markets) {
      if (market.endTime < now) {
        console.log(`[${getTime()}] ${C.dim}🗑️ Expired: ${market.coin}${C.reset}`);
        this.markets.delete(slug);
      }
    }
  }

  /**
   * Poll prices from CLOB /midpoint - TÜM MARKETLER PARALEL
   */
  private async pollPrices(): Promise<void> {
    const now = Date.now();
    const markets = Array.from(this.markets.values()).filter(m => m.endTime > now);

    // Tüm marketleri PARALEL işle
    await Promise.all(markets.map(market => this.processMarket(market, now)));
  }

  /**
   * Tek bir marketi işle
   */
  private async processMarket(market: MarketState, now: number): Promise<void> {
    const remainingSeconds = Math.floor((market.endTime - now) / 1000);
    if (remainingSeconds <= 0) return;

    try {
      // Fetch prices from CLOB /midpoint
      const [upRes, downRes] = await Promise.all([
        axios.get(`${CONFIG.clobApi}/midpoint?token_id=${market.upTokenId}`, { timeout: 2000 }),
        axios.get(`${CONFIG.clobApi}/midpoint?token_id=${market.downTokenId}`, { timeout: 2000 })
      ]);

      const upPrice = parseFloat(upRes.data.mid || '0.5');
      const downPrice = parseFloat(downRes.data.mid || '0.5');

      if (upRes.data.error || downRes.data.error) return;

      const oldUp = market.upPrice;
      market.upPrice = upPrice;
      market.downPrice = downPrice;
      market.lastUpdate = now;

      const winner = upPrice > downPrice ? 'UP' : 'DOWN';
      const winnerPrice = Math.max(upPrice, downPrice);
      const color = winner === 'UP' ? C.green : C.red;
      const inWindow = remainingSeconds <= CONFIG.entryWindowStart;

      // Log frequency
      const timeSinceLastLog = now - (market as any).lastLogTime || 0;
      let logInterval = 10000;
      if (remainingSeconds <= 60) logInterval = 1000;
      else if (remainingSeconds <= 180) logInterval = 2000;
      else if (remainingSeconds <= 240) logInterval = 3000;

      const priceChanged = Math.abs(upPrice - oldUp) > 0.02;
      if (timeSinceLastLog >= logInterval || priceChanged) {
        (market as any).lastLogTime = now;
        const phase = remainingSeconds > CONFIG.phase2Start ? '1️⃣' :
          remainingSeconds > CONFIG.phase3Start ? '2️⃣' : '🚀';
        console.log(`[${getTime()}] ${color}${market.coin}${C.reset} ${phase} UP:${(upPrice * 100).toFixed(0)}¢ DOWN:${(downPrice * 100).toFixed(0)}¢ → ${color}${winner} ${(winnerPrice * 100).toFixed(0)}¢${C.reset} | ${remainingSeconds}s`);
        this.logToPeriod(market, `UP:${(upPrice * 100).toFixed(0)}¢ DOWN:${(downPrice * 100).toFixed(0)}¢ → ${winner} ${(winnerPrice * 100).toFixed(0)}¢ | ${remainingSeconds}s`);
      }

      // STOP-LOSS - fire and forget değil, bekle (önemli!)
      if (market.currentSide && market.shares > 0) {
        await this.checkStopLoss(market, remainingSeconds).catch(() => {});
      }

      // TRADE - bekle (sıralı olmalı aynı market için)
      if (inWindow) {
        await this.evaluateAndTrade(market, remainingSeconds).catch(() => {});
      }

    } catch {
      // Fetch error - silently continue
    }
  }

  /**
   * STOP-LOSS CHECK - Runs independently from entry window
   * Sells immediately if our position drops to stopLossPrice or below
   * Also handles FLIP if in Phase 3
   */
  private async checkStopLoss(market: MarketState, remainingSeconds: number): Promise<void> {
    if (CONFIG.dryRun || !this.client) return;

    const { upPrice, downPrice, currentSide, shares, totalSpent, coin } = market;
    const myPrice = currentSide === 'Up' ? upPrice : downPrice;
    const myTokenId = currentSide === 'Up' ? market.upTokenId : market.downTokenId;
    const time = getTime();

    // Diğer tarafın fiyatı
    const otherPrice = currentSide === 'Up' ? downPrice : upPrice;

    // Biz lider miyiz?
    const weAreLeading = myPrice > otherPrice;

    // Stop-loss koşulları:
    // 1. Kaybediyorsak ve fiyat <= 50¢
    // 2. Son 2 dakika kaldı ve fiyat 45-55¢ arası (çok riskli)
    const isLosingBadly = !weAreLeading && myPrice <= CONFIG.stopLossPrice;
    const isRiskyEndgame = remainingSeconds < 120 && myPrice >= 0.45 && myPrice <= 0.55;

    const shouldStopLoss = isLosingBadly || isRiskyEndgame;

    if (shouldStopLoss) {
      const reason = isRiskyEndgame
        ? `${(myPrice * 100).toFixed(0)}¢ (<2dk, riskli)`
        : `${(myPrice * 100).toFixed(0)}¢ (kaybediyoruz)`;

      // GERÇEK BAKİYEYİ BLOCKCHAIN'DEN AL (max 1 saniye timeout)
      let realBalance = shares;
      const funderAddress = process.env.FUNDER_ADDRESS;
      if (this.provider && funderAddress) {
        try {
          const ctfRead = new ethers.Contract(CTF_ADDRESS, ctfInterface, this.provider);
          const balancePromise = ctfRead.balanceOf(funderAddress, myTokenId);
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject('timeout'), 1000));
          const balance = await Promise.race([balancePromise, timeoutPromise]) as any;
          realBalance = parseFloat(ethers.utils.formatUnits(balance, 6));
        } catch {
          // Timeout veya hata olursa in-memory değeri kullan
        }
      }

      const sellAmount = realBalance > 0.01 ? realBalance : shares;
      const recoveredValue = sellAmount * myPrice;
      const loss = totalSpent - recoveredValue;

      console.log(`[${time}] ${C.yellow}🛡️ ${coin} STOP-LOSS ${currentSide} @ ${reason} | ${remainingSeconds}s${C.reset}`);
      console.log(`         Sell ${sellAmount.toFixed(2)} sh (real) → ~$${recoveredValue.toFixed(2)} | -$${loss.toFixed(2)}`);
      this.logToPeriod(market, `🛡️ STOP-LOSS ${currentSide} @ ${reason}`);

      // 5 kez dene satmayı - her seferinde farklı miktar
      let sold = false;
      let soldAmount = 0;
      const amounts = [sellAmount, sellAmount * 0.9, sellAmount * 0.8, sellAmount * 0.5, sellAmount * 0.25];

      for (let attempt = 0; attempt < 5 && !sold; attempt++) {
        const tryAmount = amounts[attempt];
        try {
          const sellOrder = await silentExec(() => this.client!.createMarketOrder({
            tokenID: myTokenId,
            amount: tryAmount,
            side: Side.SELL
          }));

          const response = await silentExec(() => this.client!.postOrder(sellOrder, OrderType.FOK));

          if (response.orderID) {
            console.log(`         ${C.green}✅ SOLD ${tryAmount.toFixed(2)} sh${C.reset}`);
            this.logToPeriod(market, `✅ STOP-LOSS SOLD ${tryAmount.toFixed(2)} sh`);
            soldAmount = tryAmount;
            sold = true;
            break;
          } else {
            console.log(`         ${C.yellow}⚠️ No fill ${tryAmount.toFixed(1)} sh (${attempt + 1}/5)${C.reset}`);
          }
        } catch (err: any) {
          const errMsg = err?.response?.data?.error || 'failed';
          console.log(`         ${C.red}❌ ${errMsg} (${attempt + 1}/5)${C.reset}`);
        }

        await new Promise(r => setTimeout(r, 300));
      }

      if (!sold) {
        console.log(`         ${C.red}🚨 SATILAMADI! ${sellAmount.toFixed(2)} sh hala elimizde!${C.reset}`);
        this.logToPeriod(market, `🚨 STOP-LOSS BAŞARISIZ - ${sellAmount.toFixed(2)} sh elimizde!`);
        // Position'ı sıfırlama - bir sonraki poll'da tekrar deneyecek
        return;
      }

      // Reset position - sadece başarılı satışta
      const oldSide = currentSide;
      market.currentSide = null;
      market.shares = 0;
      market.totalSpent = 0;

      // FLIP: If in Phase 3 and other side is strong, buy that side
      const isPhase3 = remainingSeconds <= CONFIG.phase3Start;
      const otherSide = oldSide === 'Up' ? 'Down' : 'Up';
      const otherPrice = oldSide === 'Up' ? downPrice : upPrice;
      const otherTokenId = oldSide === 'Up' ? market.downTokenId : market.upTokenId;

      if (isPhase3 && otherPrice >= CONFIG.flipMinPrice) {
        console.log(`[${time}] ${C.cyan}🔄 ${coin} FLIP to ${otherSide} @ ${(otherPrice * 100).toFixed(0)}¢${C.reset}`);
        this.logToPeriod(market, `🔄 FLIP to ${otherSide} @ ${(otherPrice * 100).toFixed(0)}¢`);

        let flipSpent = 0;
        while (flipSpent < CONFIG.flipMaxSpend) {
          const tradeAmount = Math.min(CONFIG.perTradeAmount, CONFIG.flipMaxSpend - flipSpent);
          const flipShares = tradeAmount / otherPrice;

          try {
            const order = await silentExec(() => this.client!.createMarketOrder({
              tokenID: otherTokenId,
              amount: tradeAmount,
              side: Side.BUY
            }));

            const response = await silentExec(() => this.client!.postOrder(order, OrderType.FOK));
            if (response.orderID) {
              console.log(`         ${C.green}✅ FLIP +$${tradeAmount}${C.reset}`);
              flipSpent += tradeAmount;
              market.totalSpent += tradeAmount;
              market.currentSide = otherSide as 'Up' | 'Down';
              market.shares += flipShares;
              this.stats.tradesExecuted++;
              this.stats.totalSpent += tradeAmount;
            } else {
              break;
            }
          } catch {
            break;
          }

          await new Promise(r => setTimeout(r, CONFIG.phase3CooldownMs));
        }

        if (flipSpent > 0) {
          console.log(`         ${C.cyan}FLIP done: $${flipSpent} on ${otherSide}${C.reset}`);
          this.logToPeriod(market, `FLIP done: $${flipSpent} on ${otherSide}`);
        }
      }
    }
  }

  /**
   * Evaluate market and trade if conditions met
   * BUY LOGIC ONLY - Stop-loss is handled separately by checkStopLoss()
   */
  private async evaluateAndTrade(market: MarketState, remainingSeconds: number): Promise<void> {
    const now = Date.now();
    const { upPrice, downPrice, totalSpent, coin, currentSide } = market;
    const time = getTime();

    // Timing check
    if (remainingSeconds > CONFIG.entryWindowStart || remainingSeconds < CONFIG.entryWindowEnd) {
      return;
    }

    // Determine which side is winning
    const upIsWinner = upPrice > downPrice;
    const winnerSide: 'Up' | 'Down' = upIsWinner ? 'Up' : 'Down';
    const winnerPrice = upIsWinner ? upPrice : downPrice;
    const winnerTokenId = upIsWinner ? market.upTokenId : market.downTokenId;

    // Determine phase
    let phase: 1 | 2 | 3;
    if (remainingSeconds > CONFIG.phase2Start) {
      phase = 1;
    } else if (remainingSeconds > CONFIG.phase3Start) {
      phase = 2;
    } else {
      phase = 3;
    }

    // =========================================================================
    // BUY LOGIC
    // =========================================================================
    let minPrice: number;
    let maxSpend: number;

    if (phase === 1) {
      minPrice = CONFIG.phase1MinPrice;
      maxSpend = CONFIG.maxTotalPerMarket;
      if (winnerPrice < CONFIG.phase1StopPrice) return;
    } else if (phase === 2) {
      minPrice = CONFIG.phase2MinPrice;
      maxSpend = CONFIG.maxTotalPerMarket;
    } else {
      minPrice = CONFIG.phase3MinPrice;
      maxSpend = CONFIG.phase3MaxPerMarket;
    }

    // Price check
    if (winnerPrice < minPrice) return;

    // Cooldown check (phase'e göre)
    const cooldown = phase === 1 ? CONFIG.phase1CooldownMs :
                     phase === 2 ? CONFIG.phase2CooldownMs :
                     CONFIG.phase3CooldownMs;
    if (market.lastTradeTime > 0 && (now - market.lastTradeTime) < cooldown) return;

    // Don't buy the other side if we have a position - checkStopLoss handles FLIP
    if (currentSide && currentSide !== winnerSide) {
      return;
    }

    // Limit check
    if (totalSpent >= maxSpend) return;

    // Execute trade
    const tradeAmount = Math.min(CONFIG.perTradeAmount, maxSpend - totalSpent);
    const newShares = tradeAmount / winnerPrice;
    const profit = (1 - winnerPrice) * tradeAmount;
    const roi = ((1 - winnerPrice) / winnerPrice) * 100;
    const phaseEmoji = phase === 1 ? '1️⃣' : phase === 2 ? '2️⃣' : '🚀';

    const color = winnerSide === 'Up' ? C.green : C.red;
    const limitStr = phase === 3 ? '∞' : `$${maxSpend}`;
    const tradeLog = `${phaseEmoji} ${winnerSide} @ ${(winnerPrice * 100).toFixed(0)}¢ | $${tradeAmount} → ${newShares.toFixed(2)} sh | +$${profit.toFixed(2)} (${roi.toFixed(0)}%) | ${remainingSeconds}s | $${(totalSpent + tradeAmount).toFixed(0)}/${limitStr}`;

    console.log(`[${time}] ${color}${coin} ${tradeLog}${C.reset}`);
    this.logToPeriod(market, tradeLog);

    market.lastTradeTime = now;

    if (CONFIG.dryRun) {
      market.totalSpent += tradeAmount;
      market.currentSide = winnerSide;
      market.shares += newShares;
      this.stats.tradesExecuted++;
      this.stats.totalSpent += tradeAmount;
      this.stats.expectedProfit += profit;
    } else {
      try {
        const order = await silentExec(() => this.client!.createMarketOrder({
          tokenID: winnerTokenId,
          amount: tradeAmount,
          side: Side.BUY
        }));

        const response = await silentExec(() => this.client!.postOrder(order, OrderType.FOK));
        if (response.orderID) {
          console.log(`         ${C.green}✅ OK${C.reset}`);
          market.totalSpent += tradeAmount;
          market.currentSide = winnerSide;
          market.shares += newShares;
          this.stats.tradesExecuted++;
          this.stats.totalSpent += tradeAmount;
          this.stats.expectedProfit += profit;
        } else {
          console.log(`         ${C.yellow}⚠️ No fill${C.reset}`);
        }
      } catch (err: any) {
        const errMsg = err?.response?.data?.error || 'failed';
        console.log(`         ${C.red}❌ ${errMsg}${C.reset}`);
      }
    }
  }

  /**
   * Check and claim winning positions (GASLESS via RelayClient)
   * Runs at XX:05, XX:20, XX:35, XX:50 (5 minutes after each 15-min period ends)
   */
  private async checkAndClaimGasless(): Promise<void> {
    if (CONFIG.dryRun || !this.relayClient || !this.provider) return;

    const funderAddress = process.env.FUNDER_ADDRESS;
    if (!funderAddress) return;

    // Run at: 5, 7, 20, 22, 35, 37, 50, 52 (ilk kontrol + 2dk sonra tekrar)
    const now = new Date();
    const currentMinute = now.getMinutes();
    const claimMinutes = [5, 7, 20, 22, 35, 37, 50, 52];

    if (!claimMinutes.includes(currentMinute)) return;
    if (this.lastClaimMinute === currentMinute) return; // Already claimed this minute

    this.lastClaimMinute = currentMinute;
    const isRetry = [7, 22, 37, 52].includes(currentMinute);
    console.log(`\n[${getTime()}] ${C.cyan}💰 AUTO-CLAIM ${isRetry ? '(RETRY)' : 'CHECK'}${C.reset}`);

    const ctfRead = new ethers.Contract(CTF_ADDRESS, ctfInterface, this.provider);
    const claimableTxs: any[] = [];
    let totalShares = 0;

    // Check last 2 hours of markets (8 intervals)
    for (let i = 1; i <= 8; i++) {
      const interval = Math.floor(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000) - (i * 15 * 60 * 1000);
      const ts = Math.floor(interval / 1000);

      for (const crypto of CONFIG.targetCryptos) {
        const slug = `${crypto}-updown-15m-${ts}`;

        try {
          const gammaRes = await axios.get(`${CONFIG.gammaApi}/markets?slug=${slug}`, { timeout: 5000 });
          if (!gammaRes.data?.[0]) continue;

          const market = gammaRes.data[0];
          if (!market.closed) continue;

          const conditionId = market.conditionId;
          const tokenIds = JSON.parse(market.clobTokenIds || '[]');
          const outcomes = JSON.parse(market.outcomes || '[]');
          const prices = JSON.parse(market.outcomePrices || '[]');

          // Find winner
          let winnerIndex = -1;
          for (let j = 0; j < prices.length; j++) {
            if (parseFloat(prices[j]) >= 0.99) {
              winnerIndex = j;
              break;
            }
          }
          if (winnerIndex === -1) continue;

          // Check balance
          const balance = await ctfRead.balanceOf(funderAddress, tokenIds[winnerIndex]);
          const balanceNum = parseFloat(ethers.utils.formatUnits(balance, 6));

          if (balanceNum < 0.1) continue;

          console.log(`   ${C.green}✅ ${crypto.toUpperCase()} ${outcomes[winnerIndex]}: ${balanceNum.toFixed(2)} shares${C.reset}`);
          totalShares += balanceNum;

          // Add redeem transaction
          claimableTxs.push({
            to: CTF_ADDRESS,
            data: ctfInterface.encodeFunctionData('redeemPositions', [
              USDCe_ADDRESS,
              ethers.constants.HashZero,
              conditionId,
              [1, 2]
            ]),
            value: '0'
          });
        } catch {
          continue;
        }
      }
    }

    if (claimableTxs.length === 0) {
      console.log(`   ${C.dim}No claimable positions${C.reset}`);
      return;
    }

    console.log(`   ${C.cyan}📦 Found ${claimableTxs.length} positions (${totalShares.toFixed(2)} shares)${C.reset}`);

    // Execute gasless claim via RelayClient
    try {
      console.log(`   ${C.dim}Submitting to relayer...${C.reset}`);
      const response = await this.relayClient!.execute(claimableTxs, 'Auto-claim winning positions');

      if (response.wait) {
        const result = await response.wait();
        console.log(`   ${C.green}✅ CLAIMED! TX: ${result?.transactionHash?.slice(0, 20)}...${C.reset}`);
        this.stats.claimed += totalShares;
      } else {
        console.log(`   ${C.green}✅ Submitted to relayer${C.reset}`);
        this.stats.claimed += totalShares;
      }
    } catch {
      console.log(`   ${C.red}❌ Claim failed${C.reset}`);
    }
  }

  stop(): void {
    this.running = false;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.marketRefreshTimer) clearInterval(this.marketRefreshTimer);
    if (this.claimTimer) clearInterval(this.claimTimer);

    console.log('\n' + '='.repeat(60));
    console.log(`   ${C.bold}📊 SESSION STATS${C.reset}`);
    console.log('='.repeat(60));
    console.log(`   Markets: ${this.markets.size}`);
    console.log(`   Trades: ${this.stats.tradesExecuted}`);
    console.log(`   Spent: $${this.stats.totalSpent.toFixed(2)}`);
    console.log(`   Expected Profit: $${this.stats.expectedProfit.toFixed(2)}`);
    console.log(`   Claimed: $${this.stats.claimed.toFixed(2)}`);

    if (this.stats.totalSpent > 0) {
      console.log(`   ROI: ${((this.stats.expectedProfit / this.stats.totalSpent) * 100).toFixed(1)}%`);
    }

    if (this.markets.size > 0) {
      console.log('\n   Positions:');
      for (const m of this.markets.values()) {
        if (m.totalSpent > 0) {
          console.log(`   - ${m.coin} ${m.currentSide}: ${m.shares.toFixed(2)} sh ($${m.totalSpent.toFixed(2)})`);
        }
      }
    }

    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// MAIN
// ============================================================================

const bot = new SniperBotClob();

process.on('SIGINT', () => {
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  bot.stop();
  process.exit(0);
});

bot.start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
