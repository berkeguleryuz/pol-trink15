/**
 * EXIT STRATEGY
 * 
 * Kademeli satış logic (.clinerules'dan)
 * - 50% kar → %25 sat
 * - 100% kar → %35 sat
 * - 200% kar → %40 sat
 * - Stop-loss: -20%
 */

import { Position, EXIT_TARGETS } from './types';

export interface ExitDecision {
  action: 'HOLD' | 'PARTIAL_SELL' | 'FULL_SELL' | 'STOP_LOSS';
  sellPercent: number;
  reason: string;
  targetIndex?: number; // Hangi hedef tetiklendi (0, 1, 2)
}

export class ExitStrategy {
  private soldTargets: Map<string, Set<number>> = new Map(); // positionId → sold target indexes

  /**
   * Pozisyon için exit kararı ver
   * 
   * NOT: Stop-loss YOK! Sadece pozisyon değişiminde sat.
   * Kar hedeflerine ulaşıldığında kademeli sat ama pozisyonu koru.
   */
  shouldExit(position: Position): ExitDecision {
    // Kar hedefleri kontrolü (%20+ kar → kademeli sat)
    for (let i = 0; i < EXIT_TARGETS.length; i++) {
      const target = EXIT_TARGETS[i];
      
      // Bu hedef zaten satıldı mı?
      const soldTargets = this.soldTargets.get(position.id) || new Set();
      if (soldTargets.has(i)) {
        continue; // Skip, already sold
      }

      // Kar hedefine ulaşıldı mı?
      if (position.unrealizedPnLPercent >= target.targetProfitPercent) {
        // Bu hedefi işaretle
        soldTargets.add(i);
        this.soldTargets.set(position.id, soldTargets);

        return {
          action: 'PARTIAL_SELL',
          sellPercent: target.sellPercent,
          reason: `${target.targetProfitPercent}% kar hedefi → %${target.sellPercent} sat`,
          targetIndex: i
        };
      }
    }

    // Maç bitme yakın + karlı → tam sat
    if (position.unrealizedPnLPercent > 95) {
      return {
        action: 'FULL_SELL',
        sellPercent: 100,
        reason: 'Market price %95+ → Tüm pozisyon kapat'
      };
    }

    // Henüz hedef yok
    return {
      action: 'HOLD',
      sellPercent: 0,
      reason: `Bekle (Kar: ${position.unrealizedPnLPercent.toFixed(1)}%)`
    };
  }

  /**
   * Emergency sell (reverse goal durumunda)
   */
  emergencySell(position: Position): ExitDecision {
    return {
      action: 'FULL_SELL',
      sellPercent: 100,
      reason: 'ACIL SATIŞ - Karşı takım gol attı!'
    };
  }

  /**
   * Pozisyon kapandığında temizle
   */
  cleanupPosition(positionId: string): void {
    this.soldTargets.delete(positionId);
  }

  /**
   * Tüm state'i temizle
   */
  reset(): void {
    this.soldTargets.clear();
  }

  /**
   * Position için hangi hedefler satıldı?
   */
  getSoldTargets(positionId: string): number[] {
    const sold = this.soldTargets.get(positionId);
    return sold ? Array.from(sold) : [];
  }

  /**
   * Kar hedefi özeti
   */
  getTargetSummary(): string {
    return EXIT_TARGETS.map((t, i) => 
      `${i + 1}. ${t.targetProfitPercent}% kar → %${t.sellPercent} sat`
    ).join('\n');
  }
}
