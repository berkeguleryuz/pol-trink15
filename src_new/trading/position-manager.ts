/**
 * POSITION MANAGER
 * 
 * Multi-match position tracking ve yönetimi
 * - 3 pozisyon stratejisi
 * - PnL calculation
 * - Kademeli satış koordinasyonu
 */

import { Position, PositionType, EXIT_TARGETS } from './types';
import { MarketFetcher } from './market-fetcher';
import { ExitStrategy, ExitDecision } from './exit-strategy';
import { TradeExecutor } from './trade-executor';

export class PositionManager {
  private positions: Map<string, Position> = new Map(); // positionId → Position
  private matchPositions: Map<string, string[]> = new Map(); // matchId → positionIds
  private marketFetcher: MarketFetcher;
  private exitStrategy: ExitStrategy;
  private tradeExecutor: TradeExecutor;

  constructor(tradeExecutor: TradeExecutor) {
    this.tradeExecutor = tradeExecutor;
    this.marketFetcher = new MarketFetcher();
    this.exitStrategy = new ExitStrategy();
  }

  /**
   * Pozisyon ekle (trade executor'dan gelir)
   */
  addPosition(position: Position): void {
    this.positions.set(position.id, position);

    // Match'e bağla
    const matchPositions = this.matchPositions.get(position.matchId) || [];
    matchPositions.push(position.id);
    this.matchPositions.set(position.matchId, matchPositions);

    console.log(`\n📊 Pozisyon eklendi: ${position.type}`);
    console.log(`   💰 Amount: $${position.amount}`);
    console.log(`   📈 Entry: ${(position.avgEntryPrice * 100).toFixed(1)}%`);
  }

  /**
   * Tüm açık pozisyonların fiyatlarını güncelle
   */
  async updateAllPositions(): Promise<void> {
    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'OPEN');

    if (openPositions.length === 0) return;

    console.log(`\n💹 Pozisyon fiyatları güncelleniyor... (${openPositions.length} açık)`);

    // Her pozisyon için kendi token ID'siyle fiyat al
    for (const position of openPositions) {
      try {
        const currentPrice = await this.marketFetcher.getPriceForToken(position.tokenId);

        if (currentPrice === null) {
          console.log(`   ⚠️  ${position.type} @ ${position.market.slice(0, 30)} - Fiyat alınamadı`);
          continue;
        }

        const oldPrice = position.currentPrice;
        position.currentPrice = currentPrice;

        // PnL hesapla
        const priceDiff = currentPrice - position.avgEntryPrice;
        position.unrealizedPnL = priceDiff * position.shares;
        position.unrealizedPnLPercent = (priceDiff / position.avgEntryPrice) * 100;

        console.log(`   📊 ${position.type}: $${oldPrice.toFixed(3)} → $${currentPrice.toFixed(3)} (PnL: ${position.unrealizedPnLPercent >= 0 ? '+' : ''}${position.unrealizedPnLPercent.toFixed(1)}%)`);
      } catch (error) {
        console.error(`   ❌ Pozisyon güncellenirken hata: ${position.id}`, error);
      }
    }
  }

  /**
   * PnL hesapla
   */
  private calculatePnL(position: Position): void {
    const currentValue = position.shares * position.currentPrice;
    const invested = position.amount;
    
    position.unrealizedPnL = currentValue - invested;
    position.unrealizedPnLPercent = (position.unrealizedPnL / invested) * 100;
  }

  /**
   * Exit hedeflerini kontrol et (kademeli satış)
   */
  async checkExitTargets(): Promise<void> {
    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'OPEN');

    if (openPositions.length === 0) return;

    console.log(`\n🎯 Exit kontrol: ${openPositions.length} açık pozisyon`);

    for (const position of openPositions) {
      const decision = this.exitStrategy.shouldExit(position);

      console.log(`   📊 ${position.type} @ ${position.market.slice(0, 30)}`);
      console.log(`      Entry: ${(position.avgEntryPrice * 100).toFixed(1)}% | Current: ${(position.currentPrice * 100).toFixed(1)}%`);
      console.log(`      PnL: ${position.unrealizedPnLPercent.toFixed(1)}% | Action: ${decision.action}`);

      if (decision.action === 'HOLD') {
        continue;
      }

      console.log(`\n🎯 EXIT TETİKLENDİ: ${position.market}`);
      console.log(`   📊 Action: ${decision.action}`);
      console.log(`   💰 Sell: %${decision.sellPercent}`);
      console.log(`   📝 ${decision.reason}`);

      // Execute sell
      const result = await this.tradeExecutor.executeSell(position, decision.sellPercent);

      if (result.success) {
        // Update position
        if (decision.sellPercent === 100) {
          position.status = 'CLOSED';
          position.closeTime = new Date();
          this.exitStrategy.cleanupPosition(position.id);
          console.log(`   ✅ Pozisyon kapatıldı`);
        } else {
          // Partial sell - update shares
          position.shares = position.shares * (1 - decision.sellPercent / 100);
          position.amount = position.amount * (1 - decision.sellPercent / 100);
          console.log(`   ✅ Kısmi satış tamamlandı (${position.shares.toFixed(2)} shares kaldı)`);
        }
      }
    }
  }

  /**
   * Match için tüm pozisyonları kapat (maç bitince)
   */
  async closeMatchPositions(matchId: string): Promise<void> {
    const positionIds = this.matchPositions.get(matchId) || [];
    console.log(`\n🏁 Maç bitti - ${positionIds.length} pozisyon kapatılıyor...`);

    for (const positionId of positionIds) {
      const position = this.positions.get(positionId);
      if (position && position.status === 'OPEN') {
        // Full sell
        const result = await this.tradeExecutor.executeSell(position, 100);

        if (result.success) {
          position.status = 'CLOSED';
          position.closeTime = new Date();
          this.exitStrategy.cleanupPosition(position.id);
          console.log(`   ✅ ${position.type} kapatıldı (Kar: $${position.unrealizedPnL.toFixed(2)})`);
        }
      }
    }

    // Cleanup
    this.matchPositions.delete(matchId);
  }

  /**
   * Emergency sell (reverse goal)
   */
  async emergencySellMatch(matchId: string, reason: string): Promise<void> {
    const positionIds = this.matchPositions.get(matchId) || [];
    console.log(`\n⚠️  EMERGENCY SELL: ${reason}`);
    console.log(`   ${positionIds.length} pozisyon acilen satılıyor...`);

    for (const positionId of positionIds) {
      const position = this.positions.get(positionId);
      if (position && position.status === 'OPEN') {
        const result = await this.tradeExecutor.executeSell(position, 100);

        if (result.success) {
          position.status = 'CLOSED';
          position.closeTime = new Date();
          this.exitStrategy.cleanupPosition(position.id);
          console.log(`   ✅ ${position.type} satıldı (Zarar kesme: $${position.unrealizedPnL.toFixed(2)})`);
        }
      }
    }
  }

  /**
   * Match pozisyonlarını getir
   */
  getMatchPositions(matchId: string): Position[] {
    const positionIds = this.matchPositions.get(matchId) || [];
    return positionIds
      .map(id => this.positions.get(id))
      .filter(p => p !== undefined) as Position[];
  }

  /**
   * Tüm açık pozisyonlar
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'OPEN');
  }

  /**
   * Günlük PnL
   */
  getDailyPnL(): number {
    const today = new Date().toISOString().split('T')[0];
    
    return Array.from(this.positions.values())
      .filter(p => {
        const posDate = p.openTime.toISOString().split('T')[0];
        return posDate === today;
      })
      .reduce((sum, p) => sum + p.unrealizedPnL, 0);
  }

  /**
   * Toplam trade sayısı
   */
  getTotalTrades(): number {
    return this.positions.size;
  }

  /**
   * Özet istatistikler
   */
  getStatistics(): {
    totalPositions: number;
    openPositions: number;
    closedPositions: number;
    dailyPnL: number;
    totalPnL: number;
  } {
    const all = Array.from(this.positions.values());
    const open = all.filter(p => p.status === 'OPEN');
    const closed = all.filter(p => p.status === 'CLOSED');
    const totalPnL = all.reduce((sum, p) => sum + p.unrealizedPnL, 0);

    return {
      totalPositions: all.length,
      openPositions: open.length,
      closedPositions: closed.length,
      dailyPnL: this.getDailyPnL(),
      totalPnL
    };
  }

  /**
   * Pozisyon detaylarını yazdır
   */
  printPositions(matchId?: string): void {
    const positions = matchId 
      ? this.getMatchPositions(matchId)
      : this.getOpenPositions();

    if (positions.length === 0) {
      console.log('\n💤 Açık pozisyon yok');
      return;
    }

    console.log('\n' + '='.repeat(80));
    console.log('💼 AÇIK POZİSYONLAR');
    console.log('='.repeat(80));

    positions.forEach((p, i) => {
      const profit = p.unrealizedPnLPercent >= 0 ? '📈' : '📉';
      console.log(`\n${i + 1}. ${p.type}`);
      console.log(`   📍 ${p.market}`);
      console.log(`   💰 Investment: $${p.amount.toFixed(2)}`);
      console.log(`   📊 Entry: ${(p.avgEntryPrice * 100).toFixed(1)}%`);
      console.log(`   💹 Current: ${(p.currentPrice * 100).toFixed(1)}%`);
      console.log(`   ${profit} PnL: $${p.unrealizedPnL.toFixed(2)} (${p.unrealizedPnLPercent.toFixed(1)}%)`);
      
      // Next exit target
      const soldTargets = this.exitStrategy.getSoldTargets(p.id);
      const nextTarget = EXIT_TARGETS.find((_target, i: number) => !soldTargets.includes(i));
      if (nextTarget) {
        const remaining = nextTarget.targetProfitPercent - p.unrealizedPnLPercent;
        console.log(`   🎯 Next target: ${nextTarget.targetProfitPercent}% (+${remaining.toFixed(1)}% daha)`);
      }
    });

    console.log('='.repeat(80) + '\n');
  }
}
