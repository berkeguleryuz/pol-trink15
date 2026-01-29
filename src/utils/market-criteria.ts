/**
 * Market Filtering Criteria
 * 
 * Bu kriterler bot'un hangi marketlerde trade yapacağını belirler
 */

export interface MarketCriteria {
  minLiquidity: number;      // Minimum likidite (USDC)
  minVolume24h: number;       // Minimum 24h hacim (USDC)
  maxSpread: number;          // Maksimum spread (0.0 - 1.0)
  minProbability: number;     // Minimum YES/NO olasılık (edge bulmak için)
  maxProbability: number;     // Maksimum YES/NO olasılık (edge bulmak için)
  minScore: number;           // Minimum market kalite skoru (0-100)
  categories?: string[];      // İlgilenilen kategoriler (opsiyonel)
  excludeKeywords?: string[]; // Hariç tutulacak kelimeler
  requireKeywords?: string[]; // Mutlaka bulunması gereken kelimeler
  minDaysUntilEnd?: number;   // Market bitimine minimum kalan gün
}

/**
 * Varsayılan konservatif kriterler
 */
export const CONSERVATIVE_CRITERIA: MarketCriteria = {
  minLiquidity: 50000,        // $50K minimum likidite
  minVolume24h: 100000,       // $100K minimum hacim
  maxSpread: 0.05,            // %5 maksimum spread
  minProbability: 0.15,       // %15 minimum (çok kesin marketlerden kaçın)
  maxProbability: 0.85,       // %85 maksimum (çok kesin marketlerden kaçın)
  minScore: 70,               // 70+ skor
  minDaysUntilEnd: 7,         // En az 7 gün kalsın
};

/**
 * Agresif kriterler (daha fazla fırsat)
 */
export const AGGRESSIVE_CRITERIA: MarketCriteria = {
  minLiquidity: 10000,        // $10K minimum
  minVolume24h: 10000,        // $10K minimum
  maxSpread: 0.10,            // %10 maksimum spread
  minProbability: 0.05,       // %5 minimum
  maxProbability: 0.95,       // %95 maksimum
  minScore: 50,               // 50+ skor
  minDaysUntilEnd: 1,         // En az 1 gün
};

/**
 * Balanced kriterler (orta yol)
 */
export const BALANCED_CRITERIA: MarketCriteria = {
  minLiquidity: 25000,        // $25K minimum
  minVolume24h: 50000,        // $50K minimum
  maxSpread: 0.07,            // %7 maksimum spread
  minProbability: 0.10,       // %10 minimum
  maxProbability: 0.90,       // %90 maksimum
  minScore: 60,               // 60+ skor
  minDaysUntilEnd: 3,         // En az 3 gün
};

/**
 * Kripto odaklı kriterler
 */
export const CRYPTO_CRITERIA: MarketCriteria = {
  ...BALANCED_CRITERIA,
  requireKeywords: ['bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain'],
};

/**
 * Politik odaklı kriterler
 */
export const POLITICS_CRITERIA: MarketCriteria = {
  ...BALANCED_CRITERIA,
  requireKeywords: ['trump', 'election', 'president', 'senate', 'congress', 'political'],
};

/**
 * Ekonomi odaklı kriterler
 */
export const ECONOMY_CRITERIA: MarketCriteria = {
  ...BALANCED_CRITERIA,
  requireKeywords: ['fed', 'rate', 'recession', 'inflation', 'gdp', 'economy', 'stock'],
};

/**
 * Filter markets based on criteria
 */
export function filterMarketsByCriteria(
  markets: any[],
  criteria: MarketCriteria
): any[] {
  const now = new Date();
  
  return markets.filter(market => {
    // Likidite kontrolü
    const liquidity = parseFloat(market.liquidity || '0');
    if (liquidity < criteria.minLiquidity) return false;
    
    // Hacim kontrolü
    const volume = parseFloat(market.volume24h || market.volume || '0');
    if (volume < criteria.minVolume24h) return false;
    
    // Spread kontrolü
    if (market.spread > criteria.maxSpread) return false;
    
    // Skor kontrolü
    if (market.score && market.score < criteria.minScore) return false;
    
    // Probability kontrolü
    const yesPrice = market.yesPrice || 0;
    const noPrice = market.noPrice || 0;
    
    if (yesPrice > 0 && (yesPrice < criteria.minProbability || yesPrice > criteria.maxProbability)) {
      if (noPrice > 0 && (noPrice < criteria.minProbability || noPrice > criteria.maxProbability)) {
        return false;
      }
    }
    
    // Bitiş tarihi kontrolü
    if (criteria.minDaysUntilEnd && market.endDate) {
      const endDate = new Date(market.endDate);
      const daysUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntilEnd < criteria.minDaysUntilEnd) return false;
    }
    
    // Kategori kontrolü
    if (criteria.categories && criteria.categories.length > 0) {
      if (!market.category || !criteria.categories.includes(market.category)) {
        return false;
      }
    }
    
    // Kelime kontrolü
    const text = `${market.question} ${market.marketQuestion || ''} ${market.slug || ''}`.toLowerCase();
    
    // Hariç tutulacak kelimeler
    if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
      if (criteria.excludeKeywords.some(keyword => text.includes(keyword.toLowerCase()))) {
        return false;
      }
    }
    
    // Gerekli kelimeler
    if (criteria.requireKeywords && criteria.requireKeywords.length > 0) {
      if (!criteria.requireKeywords.some(keyword => text.includes(keyword.toLowerCase()))) {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Get criteria preset by name
 */
export function getCriteriaPreset(name: string): MarketCriteria {
  switch (name.toLowerCase()) {
    case 'conservative':
      return CONSERVATIVE_CRITERIA;
    case 'aggressive':
      return AGGRESSIVE_CRITERIA;
    case 'balanced':
      return BALANCED_CRITERIA;
    case 'crypto':
      return CRYPTO_CRITERIA;
    case 'politics':
      return POLITICS_CRITERIA;
    case 'economy':
      return ECONOMY_CRITERIA;
    default:
      return BALANCED_CRITERIA;
  }
}

/**
 * Display criteria info
 */
export function displayCriteria(criteria: MarketCriteria): void {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 MARKET FILTERING CRITERIA');
  console.log('='.repeat(60));
  console.log(`Min Liquidity:    $${criteria.minLiquidity.toLocaleString()}`);
  console.log(`Min Volume 24h:   $${criteria.minVolume24h.toLocaleString()}`);
  console.log(`Max Spread:       ${(criteria.maxSpread * 100).toFixed(1)}%`);
  console.log(`Probability Range: ${(criteria.minProbability * 100).toFixed(0)}% - ${(criteria.maxProbability * 100).toFixed(0)}%`);
  console.log(`Min Score:        ${criteria.minScore}/100`);
  
  if (criteria.minDaysUntilEnd) {
    console.log(`Min Days to End:  ${criteria.minDaysUntilEnd} days`);
  }
  
  if (criteria.categories && criteria.categories.length > 0) {
    console.log(`Categories:       ${criteria.categories.join(', ')}`);
  }
  
  if (criteria.requireKeywords && criteria.requireKeywords.length > 0) {
    console.log(`Required Keywords: ${criteria.requireKeywords.join(', ')}`);
  }
  
  if (criteria.excludeKeywords && criteria.excludeKeywords.length > 0) {
    console.log(`Excluded Keywords: ${criteria.excludeKeywords.join(', ')}`);
  }
  
  console.log('='.repeat(60) + '\n');
}
