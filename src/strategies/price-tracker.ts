/**
 * Price Tracker - Monitor price movements and changes
 */

import { TimezoneUtils } from '../utils/timezone';

export interface PriceSnapshot {
  tokenId: string;
  marketSlug: string;
  side: 'YES' | 'NO';
  price: number;
  timestamp: string;
}

export interface PriceChange {
  tokenId: string;
  marketSlug: string;
  marketQuestion: string;
  side: 'YES' | 'NO';
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  changeAmount: number;
  liquidity: number;
  volume24h: number;
  timestamp: string;
}

export class PriceTracker {
  private priceHistory: Map<string, PriceSnapshot[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 100; // Keep last 100 snapshots per token

  /**
   * Track a price snapshot
   */
  trackPrice(snapshot: PriceSnapshot): void {
    const key = `${snapshot.tokenId}_${snapshot.side}`;
    
    if (!this.priceHistory.has(key)) {
      this.priceHistory.set(key, []);
    }

    const history = this.priceHistory.get(key)!;
    history.push(snapshot);

    // Keep only last MAX_HISTORY_SIZE snapshots
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }
  }

  /**
   * Detect price changes
   */
  detectPriceChange(
    newSnapshot: PriceSnapshot,
    thresholdPercent: number = 5
  ): PriceChange | null {
    const key = `${newSnapshot.tokenId}_${newSnapshot.side}`;
    const history = this.priceHistory.get(key);

    if (!history || history.length === 0) {
      // First snapshot, no change to detect
      return null;
    }

    const lastSnapshot = history[history.length - 1];
    const oldPrice = lastSnapshot.price;
    const newPrice = newSnapshot.price;

    // Calculate change
    const changeAmount = newPrice - oldPrice;
    const changePercent = oldPrice > 0 ? (changeAmount / oldPrice) * 100 : 0;

    // Check if change exceeds threshold
    if (Math.abs(changePercent) >= thresholdPercent) {
      return {
        tokenId: newSnapshot.tokenId,
        marketSlug: newSnapshot.marketSlug,
        marketQuestion: '', // Will be filled by caller
        side: newSnapshot.side,
        oldPrice,
        newPrice,
        changePercent,
        changeAmount,
        liquidity: 0, // Will be filled by caller
        volume24h: 0, // Will be filled by caller
        timestamp: TimezoneUtils.getBerlinTimestamp(),
      };
    }

    return null;
  }

  /**
   * Get price history for a token
   */
  getPriceHistory(tokenId: string, side: 'YES' | 'NO'): PriceSnapshot[] {
    const key = `${tokenId}_${side}`;
    return this.priceHistory.get(key) || [];
  }

  /**
   * Calculate price trend (upward/downward)
   */
  getPriceTrend(tokenId: string, side: 'YES' | 'NO', samples: number = 5): {
    trend: 'UP' | 'DOWN' | 'STABLE';
    averageChange: number;
  } {
    const history = this.getPriceHistory(tokenId, side);
    
    if (history.length < 2) {
      return { trend: 'STABLE', averageChange: 0 };
    }

    const recentHistory = history.slice(-samples);
    let totalChange = 0;
    let changes = 0;

    for (let i = 1; i < recentHistory.length; i++) {
      const change = recentHistory[i].price - recentHistory[i - 1].price;
      totalChange += change;
      changes++;
    }

    const averageChange = changes > 0 ? totalChange / changes : 0;

    if (averageChange > 0.01) {
      return { trend: 'UP', averageChange };
    } else if (averageChange < -0.01) {
      return { trend: 'DOWN', averageChange };
    } else {
      return { trend: 'STABLE', averageChange };
    }
  }

  /**
   * Clear old data (memory management)
   */
  clearOldData(hoursToKeep: number = 24): void {
    const cutoffTime = Date.now() - (hoursToKeep * 60 * 60 * 1000);

    for (const [key, history] of this.priceHistory.entries()) {
      const filteredHistory = history.filter(snapshot => {
        const snapshotTime = new Date(snapshot.timestamp).getTime();
        return snapshotTime > cutoffTime;
      });

      if (filteredHistory.length === 0) {
        this.priceHistory.delete(key);
      } else {
        this.priceHistory.set(key, filteredHistory);
      }
    }

    TimezoneUtils.log(`Cleared old price data, keeping last ${hoursToKeep} hours`);
  }
}
