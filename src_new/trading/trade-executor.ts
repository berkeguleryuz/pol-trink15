/**
 * TRADE EXECUTOR
 * 
 * Polymarket ClobClient ile trade execution
 * Buy/Sell orders, DRY RUN support
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { Trade, TradeOrder, TradeResult, Position, PositionType } from './types';
import { GoalEvent, FootballMatch } from '../core/types';
import { MarketFetcher, MarketSearchResult } from './market-fetcher';
import { TradeLogger } from '../utils/trade-logger';

// Forward declaration to avoid circular dependency
export interface IPositionManager {
  getMatchPositions(matchId: string): Position[];
  updateAllPositions(): Promise<void>;
}

export class TradeExecutor {
  private client: ClobClient;
  private dryRun: boolean;
  private marketFetcher: MarketFetcher;
  private positionSize: number; // Default buy amount per position
  private positionManager?: IPositionManager;
  private marketCache: Map<string, MarketSearchResult> = new Map(); // CACHE!
  private tradeLogger: TradeLogger; // ⚡ Trade logging

  constructor(client: ClobClient, dryRun: boolean = true, positionSize: number = 3) {
    this.client = client;
    this.dryRun = dryRun;
    this.positionSize = positionSize;
    this.marketFetcher = new MarketFetcher();
    this.tradeLogger = new TradeLogger(); // ⚡ Initialize logger
  }

  /**
   * Set position manager (called after construction to avoid circular dependency)
   */
  setPositionManager(manager: IPositionManager): void {
    this.positionManager = manager;
  }

  /**
   * Pre-cache market data for fast execution
   */
  async precacheMarketData(matchSlug: string): Promise<MarketSearchResult | null> {
    const marketData = await this.marketFetcher.fetchMarketBySlug(matchSlug);
    if (marketData) {
      this.marketCache.set(matchSlug, marketData);
      console.log(`   ✅ Market cached: ${matchSlug}`);
      return marketData;
    }
    return null;
  }

  /**
   * DİNAMİK POZİSYON YÖNETİMİ
   * 
   * Stratejisi:
   * 1. İLK GOL (0-0 → 1-0): Gol atan YES, Diğer NO, Berabere NO
   * 2. FARK AÇILIYOR (1-0 → 2-0): Mevcut pozisyonlardan KAR SAT + EKLE
   * 3. BERABERE YAKALANDI (1-0 → 1-1): Pozisyonu TAM DEĞİŞTİR
   * 
   * NOT: Stop-loss YOK! Sadece pozisyon değişiminde sat.
   */
  async openGoalPositions(match: any, event: any): Promise<TradeResult[]> {
    console.log(`\n🎯 GOL TRADİNG SENARYOSU: ${event.team} gol attı!`);
    
    const oldScore = event.previousScore || event.oldScore;
    const newScore = event.newScore;
    
    if (!oldScore || !newScore) {
      console.error(`❌ Geçersiz event formatı:`, event);
      return [];
    }
    
    console.log(`   Eski skor: ${oldScore.home}-${oldScore.away}`);
    console.log(`   Yeni skor: ${newScore.home}-${newScore.away}`);
    
    // ⚡ Market data (cache'den)
    let marketData: MarketSearchResult | undefined = this.marketCache.get(match.slug);
    
    if (!marketData) {
      console.log(`   ⚠️  Cache'de yok, fetch ediliyor: ${match.slug}`);
      const fetchedData = await this.marketFetcher.fetchMarketBySlug(match.slug);
      if (fetchedData) {
        marketData = fetchedData;
        this.marketCache.set(match.slug, fetchedData);
      }
    }
    
    if (!marketData) {
      console.log(`❌ Market bulunamadı: ${match.slug}`);
      return [];
    }

    // Likidite kontrolü
    if (!this.marketFetcher.hasEnoughLiquidity(marketData.market, 5000)) {
      console.warn(`   ⚠️  Yetersiz likidite: $${marketData.market.liquidity}`);
      return [];
    }

    const { home: prevHome, away: prevAway } = oldScore;
    const { home: newHome, away: newAway } = newScore;

    const wasDrawn = (prevHome === prevAway);
    const isDrawn = (newHome === newAway);
    const wasHomeLeading = prevHome > prevAway;
    const isHomeLeading = newHome > newAway;

    console.log(`\n📊 DURUM ANALİZİ:`);
    console.log(`   Önceki: ${wasDrawn ? 'BERABERE' : (wasHomeLeading ? 'HOME ÖNDE' : 'AWAY ÖNDE')}`);
    console.log(`   Şimdi: ${isDrawn ? 'BERABERE' : (isHomeLeading ? 'HOME ÖNDE' : 'AWAY ÖNDE')}`);

    const tradePromises: Promise<TradeResult>[] = [];

    // ═══════════════════════════════════════════════════════════════
    // SENARYO 1: İLK GOL (0-0 → 1-0 veya beraberliği bozan gol)
    // ═══════════════════════════════════════════════════════════════
    if (wasDrawn && !isDrawn) {
      console.log(`\n🎯 STRATEJİ: İLK GOL! Pozisyon aç`);
      
      const leadingTeam = event.team; // 'home' veya 'away'
      const leadingToken = leadingTeam === 'home' ? marketData.homeToken : marketData.awayToken;
      const losingToken = leadingTeam === 'home' ? marketData.awayToken : marketData.homeToken;
      
      // 1. Öne geçen takım KAZANIR (YES)
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: leadingToken.yesTokenId,
        side: 'BUY',
        outcome: 'YES',
        amount: this.positionSize,
        price: leadingToken.yesPrice,
        reason: `${leadingTeam === 'home' ? match.homeTeam : match.awayTeam} öne geçti!`
      }, match.id, PositionType.TEAM_WINS_YES, event));

      // 2. Geride olan takım KAZANIR (NO)
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: losingToken.noTokenId,
        side: 'BUY',
        outcome: 'NO',
        amount: this.positionSize,
        price: losingToken.noPrice,
        reason: `${leadingTeam === 'away' ? match.homeTeam : match.awayTeam} geride, kazanması zor`
      }, match.id, PositionType.OPPONENT_WINS_NO, event));

      // 3. BERABERE (NO)
      if (marketData.drawToken) {
        tradePromises.push(this.executeBuy({
          market: match.slug,
          conditionId: marketData.market.conditionId,
          tokenId: marketData.drawToken.noTokenId,
          side: 'BUY',
          outcome: 'NO',
          amount: this.positionSize,
          price: marketData.drawToken.noPrice,
          reason: 'Beraberlik bozuldu'
        }, match.id, PositionType.DRAW_NO, event));
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SENARYO 2: BERABERE YAKALANDI (1-0 → 1-1, 2-1 → 2-2)
    // ═══════════════════════════════════════════════════════════════
    else if (!wasDrawn && isDrawn) {
      console.log(`\n🎯 STRATEJİ: BERABERE! Pozisyon tamamen değiştir`);
      
      if (this.positionManager) {
        const existingPositions = this.positionManager.getMatchPositions(match.id);
        console.log(`   🔍 ${existingPositions.length} açık pozisyon bulundu`);
        
        // Fiyatları güncelle
        await this.positionManager.updateAllPositions();
        
        // TAMAMEN SAT: Eski pozisyonları kapat
        for (const position of existingPositions) {
          if (position.status === 'OPEN') {
            console.log(`   🔴 SATIŞ: ${position.type} (PnL: ${position.unrealizedPnLPercent.toFixed(1)}%)`);
            tradePromises.push(this.executeSellOrder({
              market: match.slug,
              conditionId: marketData.market.conditionId,
              tokenId: position.tokenId,
              side: 'SELL',
              outcome: position.outcome,
              amount: position.shares,
              price: 0,
              reason: `Beraberlik yakalandı - pozisyon değişimi`
            }, position.id));
          }
        }
      }
      
      // YENİ POZİSYONLAR: Beraberlik durumuna göre
      console.log(`\n   💡 YENİ POZİSYONLAR: Her iki takım NO + Berabere YES`);
      
      // 1. HOME KAZANIR (NO)
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: marketData.homeToken.noTokenId,
        side: 'BUY',
        outcome: 'NO',
        amount: this.positionSize,
        price: marketData.homeToken.noPrice,
        reason: `${match.homeTeam} kazanamayabilir (berabere)`
      }, match.id, PositionType.OPPONENT_WINS_NO, event));

      // 2. AWAY KAZANIR (NO)
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: marketData.awayToken.noTokenId,
        side: 'BUY',
        outcome: 'NO',
        amount: this.positionSize,
        price: marketData.awayToken.noPrice,
        reason: `${match.awayTeam} kazanamayabilir (berabere)`
      }, match.id, PositionType.OPPONENT_WINS_NO, event));

      // 3. BERABERE (YES)
      if (marketData.drawToken) {
        tradePromises.push(this.executeBuy({
          market: match.slug,
          conditionId: marketData.market.conditionId,
          tokenId: marketData.drawToken.yesTokenId,
          side: 'BUY',
          outcome: 'YES',
          amount: this.positionSize,
          price: marketData.drawToken.yesPrice,
          reason: 'Beraberlik yakalandı!'
        }, match.id, PositionType.DRAW_YES, event));
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SENARYO 3: FARK AÇILIYOR (1-0 → 2-0, 2-1 → 3-1)
    // ═══════════════════════════════════════════════════════════════
    else {
      console.log(`\n🎯 STRATEJİ: FARK AÇILIYOR! Kar sat + ekle`);
      
      const leadingTeam = isHomeLeading ? 'home' : 'away';
      const leadingToken = isHomeLeading ? marketData.homeToken : marketData.awayToken;
      const losingToken = isHomeLeading ? marketData.awayToken : marketData.homeToken;
      
      if (this.positionManager) {
        const existingPositions = this.positionManager.getMatchPositions(match.id);
        
        // Fiyatları güncelle
        await this.positionManager.updateAllPositions();
        
        // KAR SAT: %20+ karlı pozisyonlardan %30 sat
        for (const position of existingPositions) {
          if (position.status === 'OPEN' && position.unrealizedPnLPercent >= 20) {
            console.log(`   � KAR SATIŞ: ${position.type} (${position.unrealizedPnLPercent.toFixed(1)}% kar) → %30 sat`);
            const sellShares = position.shares * 0.3; // %30 sat
            tradePromises.push(this.executeSellOrder({
              market: match.slug,
              conditionId: marketData.market.conditionId,
              tokenId: position.tokenId,
              side: 'SELL',
              outcome: position.outcome,
              amount: sellShares,
              price: 0,
              reason: `Kar realizasyonu (%${position.unrealizedPnLPercent.toFixed(1)})`
            }, position.id));
          }
        }
      }
      
      // EKLE: Mevcut pozisyonları güçlendir
      console.log(`\n   📈 POZİSYON GÜÇLENDIR: Öne geçen takım + diğerleri NO`);
      
      // 1. Öne geçen takım KAZANIR (YES) - EKLE
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: leadingToken.yesTokenId,
        side: 'BUY',
        outcome: 'YES',
        amount: this.positionSize * 0.5, // Yarım pozisyon ekle
        price: leadingToken.yesPrice,
        reason: `${leadingTeam === 'home' ? match.homeTeam : match.awayTeam} fark açıyor - EKLE`
      }, match.id, PositionType.TEAM_WINS_YES, event));

      // 2. Geride olan takım KAZANIR (NO) - EKLE
      tradePromises.push(this.executeBuy({
        market: match.slug,
        conditionId: marketData.market.conditionId,
        tokenId: losingToken.noTokenId,
        side: 'BUY',
        outcome: 'NO',
        amount: this.positionSize * 0.5,
        price: losingToken.noPrice,
        reason: `${leadingTeam === 'away' ? match.homeTeam : match.awayTeam} fark açıldı - EKLE`
      }, match.id, PositionType.OPPONENT_WINS_NO, event));

      // 3. BERABERE (NO) - EKLE
      if (marketData.drawToken) {
        tradePromises.push(this.executeBuy({
          market: match.slug,
          conditionId: marketData.market.conditionId,
          tokenId: marketData.drawToken.noTokenId,
          side: 'BUY',
          outcome: 'NO',
          amount: this.positionSize * 0.5,
          price: marketData.drawToken.noPrice,
          reason: 'Fark var, beraberlik zor - EKLE'
        }, match.id, PositionType.DRAW_NO, event));
      }
    }

    // ⚡ TÜM TRADE'LERİ PARALEL ÇALIŞTIR!
    console.log(`\n⚡ ${tradePromises.length} emir gönderiliyor (PARALEL)...`);
    const results = await Promise.all(tradePromises);

    const successCount = results.filter((r: TradeResult) => r.success).length;
    console.log(`\n✅ ${successCount}/${results.length} pozisyon işlendi`);
    
    return results;
  }

  /**
   * Buy order çalıştır
   */
  private async executeBuy(
    order: TradeOrder,
    matchId: string,
    positionType: PositionType,
    goalEvent?: GoalEvent // ⚡ GOL event'i score ve minute bilgisi için
  ): Promise<TradeResult> {
    console.log(`\n📈 BUY: ${order.outcome} @ $${order.price.toFixed(3)}`);
    console.log(`   💵 Amount: $${order.amount}`);
    console.log(`   📝 ${order.reason}`);

    if (this.dryRun) {
      console.log(`   🔸 DRY RUN - Trade simüle ediliyor`);
      
      // Simulate trade
      const trade: Trade = {
        id: `DRY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        matchId,
        positionId: `POS_DRY_${Date.now()}`,
        market: order.market,
        tokenId: order.tokenId,
        side: order.side,
        outcome: order.outcome,
        shares: order.amount / order.price,
        amount: order.amount,
        price: order.price,
        timestamp: new Date(),
        success: true
      };

      const position: Position = {
        id: trade.positionId,
        matchId,
        market: order.market,
        conditionId: order.conditionId,
        tokenId: order.tokenId,
        type: positionType,
        outcome: order.outcome,
        side: 'BUY',
        shares: trade.shares,
        amount: order.amount,
        avgEntryPrice: order.price,
        currentPrice: order.price,
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        openTime: new Date(),
        status: 'OPEN'
      };

      return { success: true, trade, position };
    }

    // REAL TRADE
    try {
      console.log(`   🚀 Polymarket'e order gönderiliyor...`);

      // Create market buy order
      const orderObj = await this.client.createMarketOrder({
        tokenID: order.tokenId,
        amount: order.amount, // USDC
        side: Side.BUY
      });

      // Post order (Fill or Kill)
      const response = await this.client.postOrder(orderObj, OrderType.FOK);

      console.log(`   ✅ Order executed!`);
      console.log(`   📋 Order ID: ${response.orderID}`);

      const trade: Trade = {
        id: `TRADE_${Date.now()}`,
        matchId,
        positionId: `POS_${response.orderID}`,
        market: order.market,
        tokenId: order.tokenId,
        side: order.side,
        outcome: order.outcome,
        shares: order.amount / order.price,
        amount: order.amount,
        price: order.price,
        orderId: response.orderID,
        timestamp: new Date(),
        success: true
      };

      const position: Position = {
        id: trade.positionId,
        matchId,
        market: order.market,
        conditionId: order.conditionId,
        tokenId: order.tokenId,
        type: positionType,
        outcome: order.outcome,
        side: 'BUY',
        shares: trade.shares,
        amount: order.amount,
        avgEntryPrice: order.price,
        currentPrice: order.price,
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        openTime: new Date(),
        status: 'OPEN'
      };

      // ⚡ LOG TRADE
      await this.tradeLogger.log({
        timestamp: new Date().toISOString(),
        matchId,
        matchSlug: order.market,
        action: 'BUY',
        market: positionType,
        outcome: order.outcome,
        price: order.price,
        amount: order.amount,
        shares: trade.shares,
        reason: order.reason,
        score: goalEvent ? `${goalEvent.newScore.home}-${goalEvent.newScore.away}` : 'N/A',
        minute: goalEvent?.minute || 0,
        matchStatus: undefined,
        pnl: 0,
        pnlPercent: 0,
        success: true
      });

      return { success: true, trade, position };

    } catch (error: any) {
      console.error(`   ❌ Trade failed:`, error.message);
      
      const trade: Trade = {
        id: `FAILED_${Date.now()}`,
        matchId,
        positionId: '',
        market: order.market,
        tokenId: order.tokenId,
        side: order.side,
        outcome: order.outcome,
        shares: 0,
        amount: order.amount,
        price: order.price,
        timestamp: new Date(),
        success: false,
        error: error.message
      };

      // ⚡ LOG FAILED TRADE
      await this.tradeLogger.log({
        timestamp: new Date().toISOString(),
        matchId,
        matchSlug: order.market,
        action: 'BUY',
        market: positionType,
        outcome: order.outcome,
        price: order.price,
        amount: order.amount,
        shares: 0,
        reason: order.reason,
        score: goalEvent ? `${goalEvent.newScore.home}-${goalEvent.newScore.away}` : 'N/A',
        minute: goalEvent?.minute || 0,
        matchStatus: undefined,
        pnl: 0,
        pnlPercent: 0,
        success: false,
        error: error.message
      });

      return { success: false, trade, error: error.message };
    }
  }

  /**
   * Sell order çalıştır (kademeli satış için)
   */
  async executeSell(position: Position, sellPercent: number): Promise<TradeResult> {
    const sharesToSell = position.shares * (sellPercent / 100);
    const sellAmount = sharesToSell * position.currentPrice;

    console.log(`\n📉 SELL: ${position.type}`);
    console.log(`   📊 ${sellPercent}% satılıyor (${sharesToSell.toFixed(2)} shares)`);
    console.log(`   💵 Amount: $${sellAmount.toFixed(2)}`);
    console.log(`   💰 Kar: $${(sellAmount - position.amount * (sellPercent / 100)).toFixed(2)}`);

    if (this.dryRun) {
      console.log(`   🔸 DRY RUN - Sell simüle ediliyor`);

      const trade: Trade = {
        id: `DRY_SELL_${Date.now()}`,
        matchId: position.matchId,
        positionId: position.id,
        market: position.market,
        tokenId: position.tokenId,
        side: 'SELL',
        outcome: position.outcome,
        shares: sharesToSell,
        amount: sellAmount,
        price: position.currentPrice,
        timestamp: new Date(),
        success: true
      };

      return { success: true, trade };
    }

    // REAL SELL
    try {
      console.log(`   🚀 Polymarket'e sell order gönderiliyor...`);

      const orderObj = await this.client.createMarketOrder({
        tokenID: position.tokenId,
        amount: sharesToSell,
        side: Side.SELL
      });

      const response = await this.client.postOrder(orderObj, OrderType.FOK);

      console.log(`   ✅ Sell executed!`);
      console.log(`   📋 Order ID: ${response.orderID}`);

      const trade: Trade = {
        id: `SELL_${Date.now()}`,
        matchId: position.matchId,
        positionId: position.id,
        market: position.market,
        tokenId: position.tokenId,
        side: 'SELL',
        outcome: position.outcome,
        shares: sharesToSell,
        amount: sellAmount,
        price: position.currentPrice,
        orderId: response.orderID,
        timestamp: new Date(),
        success: true
      };

      return { success: true, trade };

    } catch (error: any) {
      console.error(`   ❌ Sell failed:`, error.message);

      const trade: Trade = {
        id: `SELL_FAILED_${Date.now()}`,
        matchId: position.matchId,
        positionId: position.id,
        market: position.market,
        tokenId: position.tokenId,
        side: 'SELL',
        outcome: position.outcome,
        shares: sharesToSell,
        amount: 0,
        price: position.currentPrice,
        timestamp: new Date(),
        success: false,
        error: error.message
      };

      return { success: false, trade, error: error.message };
    }
  }

  /**
   * Sell order çalıştır (pozisyon kapatmak için)
   */
  private async executeSellOrder(
    order: TradeOrder,
    positionId: string
  ): Promise<TradeResult> {
    console.log(`\n📉 SELL: ${order.outcome}`);
    console.log(`   💵 Shares: ${order.amount}`);
    console.log(`   📝 ${order.reason}`);

    if (this.dryRun) {
      console.log(`   🔸 DRY RUN - Sell simüle ediliyor`);

      const trade: Trade = {
        id: `DRY_SELL_${Date.now()}`,
        matchId: '', // will be filled
        positionId,
        market: order.market,
        tokenId: order.tokenId,
        side: 'SELL',
        outcome: order.outcome,
        shares: order.amount,
        amount: order.amount, // shares to sell
        price: 0, // will be market price
        timestamp: new Date(),
        success: true
      };

      return { success: true, trade };
    }

    // REAL SELL
    try {
      console.log(`   🚀 Polymarket'e SELL order gönderiliyor...`);

      // Create market sell order
      const orderObj = await this.client.createMarketOrder({
        tokenID: order.tokenId,
        amount: order.amount, // shares to sell
        side: Side.SELL
      });

      // Post order (Fill or Kill)
      const response = await this.client.postOrder(orderObj, OrderType.FOK);

      console.log(`   ✅ Sell executed!`);
      console.log(`   📋 Order ID: ${response.orderID}`);

      const trade: Trade = {
        id: `SELL_${Date.now()}`,
        matchId: '', // will be filled by caller
        positionId,
        market: order.market,
        tokenId: order.tokenId,
        side: 'SELL',
        outcome: order.outcome,
        shares: order.amount,
        amount: order.amount,
        price: 0, // market determined
        orderId: response.orderID,
        timestamp: new Date(),
        success: true
      };

      return { success: true, trade };

    } catch (error: any) {
      console.error(`   ❌ Sell failed:`, error.message);

      const trade: Trade = {
        id: `SELL_FAILED_${Date.now()}`,
        matchId: '',
        positionId,
        market: order.market,
        tokenId: order.tokenId,
        side: 'SELL',
        outcome: order.outcome,
        shares: 0,
        amount: 0,
        price: 0,
        timestamp: new Date(),
        success: false,
        error: error.message
      };

      return { success: false, trade, error: error.message };
    }
  }

  /**
   * DRY RUN modu değiştir
   */
  setDryRun(dryRun: boolean): void {
    this.dryRun = dryRun;
    console.log(`🔸 DRY RUN: ${dryRun ? 'ENABLED' : 'DISABLED'}`);
  }
}
