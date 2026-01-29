/**
 * Market Registry
 * Merkezi market veritabanı - tüm marketlerin token ID'lerini saklar
 * Her yeni market otomatik kaydedilir
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MarketToken {
  tokenId: string;
  outcome: string; // YES, NO, veya diğer seçenekler
  currentPrice?: number;
}

export interface RegisteredMarket {
  conditionId: string;
  question: string;
  slug: string;
  tokens: MarketToken[];
  category?: string; // politics, sports, crypto, etc
  volume24hr: number;
  active: boolean;
  closed: boolean;
  endDate?: string; // Market kapanış tarihi
  addedAt: string;
  lastUpdated: string;
  tracking: boolean; // Takip ediliyor mu?
  trackingReason?: string; // Neden takip ediliyor?
  entryPrice?: number; // İlk takip fiyatı
  targetProfit?: number; // Hedef kar %
}

export class MarketRegistry {
  private dbPath: string;
  private markets: Map<string, RegisteredMarket> = new Map();

  constructor() {
    this.dbPath = path.join(__dirname, '../../data/market-registry.json');
    this.ensureDataDir();
    this.loadFromFile();
  }

  /**
   * Data klasörünü oluştur
   */
  private ensureDataDir(): void {
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Dosyadan yükle
   */
  private loadFromFile(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf-8');
        const marketsArray = JSON.parse(data) as RegisteredMarket[];
        this.markets = new Map(marketsArray.map(m => [m.conditionId, m]));
        console.log(`✅ Loaded ${this.markets.size} markets from registry`);
      } else {
        console.log(`📝 Creating new market registry`);
        this.saveToFile();
      }
    } catch (error) {
      console.error('Error loading market registry:', error);
      this.markets = new Map();
    }
  }

  /**
   * Dosyaya kaydet
   */
  private saveToFile(): void {
    try {
      const marketsArray = Array.from(this.markets.values());
      fs.writeFileSync(this.dbPath, JSON.stringify(marketsArray, null, 2));
    } catch (error) {
      console.error('Error saving market registry:', error);
    }
  }

  /**
   * Market ekle veya güncelle
   */
  registerMarket(market: Omit<RegisteredMarket, 'addedAt' | 'lastUpdated'>): RegisteredMarket {
    const existing = this.markets.get(market.conditionId);
    
    const registered: RegisteredMarket = {
      ...market,
      addedAt: existing?.addedAt || new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    this.markets.set(market.conditionId, registered);
    this.saveToFile();

    return registered;
  }

  /**
   * Market'i takibe al
   */
  startTracking(
    conditionId: string,
    reason: string,
    entryPrice: number,
    targetProfit: number = 50
  ): boolean {
    const market = this.markets.get(conditionId);
    if (!market) return false;

    market.tracking = true;
    market.trackingReason = reason;
    market.entryPrice = entryPrice;
    market.targetProfit = targetProfit;
    market.lastUpdated = new Date().toISOString();

    this.saveToFile();
    return true;
  }

  /**
   * Market'i takipten çıkar
   */
  stopTracking(conditionId: string): boolean {
    const market = this.markets.get(conditionId);
    if (!market) return false;

    market.tracking = false;
    market.lastUpdated = new Date().toISOString();

    this.saveToFile();
    return true;
  }

  /**
   * Tüm marketleri getir
   */
  getAllMarkets(): RegisteredMarket[] {
    return Array.from(this.markets.values());
  }

  /**
   * Takip edilen marketleri getir
   */
  getTrackedMarkets(): RegisteredMarket[] {
    return this.getAllMarkets().filter(m => m.tracking && m.active && !m.closed);
  }

  /**
   * Takip edilmeyen marketleri getir
   */
  getUntrackedMarkets(): RegisteredMarket[] {
    return this.getAllMarkets().filter(m => !m.tracking && m.active && !m.closed);
  }

  /**
   * Kategoriye göre marketleri getir
   */
  getMarketsByCategory(category: string): RegisteredMarket[] {
    return this.getAllMarkets().filter(m => m.category === category && m.active);
  }

  /**
   * Market bul
   */
  getMarket(conditionId: string): RegisteredMarket | undefined {
    return this.markets.get(conditionId);
  }

  /**
   * Token ID ile market bul
   */
  findByTokenId(tokenId: string): RegisteredMarket | undefined {
    return this.getAllMarkets().find(m =>
      m.tokens.some(t => t.tokenId === tokenId)
    );
  }

  /**
   * İstatistikler
   */
  getStats() {
    const all = this.getAllMarkets();
    const active = all.filter(m => m.active && !m.closed);
    const tracked = this.getTrackedMarkets();
    const untracked = this.getUntrackedMarkets();

    return {
      total: all.length,
      active: active.length,
      tracked: tracked.length,
      untracked: untracked.length,
      closed: all.filter(m => m.closed).length,
      categories: this.getCategoryStats(),
    };
  }

  /**
   * Kategori istatistikleri
   */
  private getCategoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const market of this.getAllMarkets()) {
      const cat = market.category || 'other';
      stats[cat] = (stats[cat] || 0) + 1;
    }
    return stats;
  }

  /**
   * Yeni marketleri tara ve kaydet (son 24 saatte eklenenler)
   */
  getNewMarkets(hoursAgo: number = 24): RegisteredMarket[] {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursAgo);

    return this.getAllMarkets().filter(m => {
      const addedAt = new Date(m.addedAt);
      return addedAt > cutoff;
    });
  }
}
