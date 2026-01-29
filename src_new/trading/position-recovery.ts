/**
 * POSITION RECOVERY
 * 
 * Bot yeniden başladığında açık pozisyonları Polymarket'ten çeker
 * ve PositionManager'a yükler
 */

import { ClobClient } from '@polymarket/clob-client';
import { Position, PositionType } from './types';
import { MarketFetcher } from './market-fetcher';

interface PolymarketPosition {
  asset_id: string; // token ID
  market: string; // market slug
  side: 'BUY' | 'SELL';
  size: string; // shares owned
  cost_basis: string; // total cost in USD
  current_value: string; // current market value
  realized_pnl: string;
  unrealized_pnl: string;
}

export class PositionRecovery {
  private client: ClobClient;
  private marketFetcher: MarketFetcher;

  constructor(client: ClobClient) {
    this.client = client;
    this.marketFetcher = new MarketFetcher();
  }

  /**
   * Polymarket'ten tüm açık pozisyonları çek
   */
  async loadOpenPositions(): Promise<Position[]> {
    console.log('\n🔄 Açık pozisyonlar yükleniyor...');

    try {
      // Wallet address from environment
      const address = process.env.WALLET_ADDRESS || '0x50fCb5beAC8d9AD939f4D8f0DaaaC045778BEc89';
      console.log(`   📍 Wallet: ${address}`);

      // NOT: ClobClient'da getPositions() metodu yok
      // Bunun yerine getOpenOrders() kullanacağız
      const openOrders = await this.client.getOpenOrders();
      console.log(`   📦 ${openOrders.length} açık emir bulundu`);

      // Pozisyonları parse et
      const positions: Position[] = [];

      for (const order of openOrders) {
        // Her order bir pozisyon olabilir
        const position = await this.parseOrderToPosition(order);
        if (position) {
          positions.push(position);
        }
      }

      console.log(`   ✅ ${positions.length} pozisyon yüklendi`);
      return positions;

    } catch (error: any) {
      console.error('❌ Pozisyon yükleme hatası:', error.message);
      return [];
    }
  }

  /**
   * Order'ı Position'a çevir
   */
  private async parseOrderToPosition(order: any): Promise<Position | null> {
    try {
      // Token ID'den market bilgisini bul
      const tokenId = order.asset_id || order.token_id;
      
      // Market slug'ı bul (football-matches.json'dan)
      const marketSlug = await this.findMarketByTokenId(tokenId);
      if (!marketSlug) {
        console.warn(`   ⚠️  Token market'i bulunamadı: ${tokenId.slice(0, 10)}...`);
        return null;
      }

      // Position oluştur
      const shares = parseFloat(order.original_size || order.size || '0');
      const avgPrice = parseFloat(order.price || '0.5');
      const amount = shares * avgPrice;

      const position: Position = {
        id: `${marketSlug}-${tokenId.slice(0, 8)}`,
        matchId: marketSlug,
        market: marketSlug,
        conditionId: order.market || '',
        tokenId: tokenId,
        type: this.guessPositionType(order),
        outcome: order.side === 'BUY' ? 'YES' : 'NO',
        side: order.side === 'BUY' ? 'BUY' : 'SELL',
        shares: shares,
        amount: amount,
        avgEntryPrice: avgPrice,
        currentPrice: avgPrice, // Güncellenecek
        unrealizedPnL: 0,
        unrealizedPnLPercent: 0,
        openTime: new Date(order.created_at || Date.now()),
        status: 'OPEN'
      };

      return position;

    } catch (error: any) {
      console.error('❌ Order parse hatası:', error.message);
      return null;
    }
  }

  /**
   * Token ID'den market slug'ı bul
   */
  private async findMarketByTokenId(tokenId: string): Promise<string | null> {
    // football-matches.json'dan tüm maçları yükle ve token ID'leri ara
    const fs = await import('fs');
    const path = await import('path');
    
    try {
      const dataPath = path.join(process.cwd(), 'data', 'football-matches.json');
      const jsonData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      const matches = jsonData.matches || [];

      for (const match of matches) {
        if (!match.markets) continue;

        for (const market of match.markets) {
          const tokenIds = JSON.parse(market.clobTokenIds);
          if (tokenIds.includes(tokenId)) {
            return match.slug;
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Position type'ı tahmin et (market question'dan)
   */
  private guessPositionType(order: any): PositionType {
    // Bu kısım market question'a göre yapılacak
    // Şimdilik generic
    return PositionType.TEAM_WINS_YES;
  }
}
