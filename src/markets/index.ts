import axios from 'axios';
import { logger } from '../utils/logger';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

export interface Market {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  clobTokenIds: string;
  tokens: { tokenId: string; outcome: string; price: string }[];
  enableOrderBook: boolean;
  active: boolean;
  closed: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  description?: string;
  endDate?: string;
  category?: string;
  volume?: string;
  liquidity?: string;
}

export interface MarketFilters {
  active?: boolean;
  closed?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Get active markets from Polymarket
 */
export async function getActiveMarkets(filters: MarketFilters = {}): Promise<Market[]> {
  try {
    const params: any = {
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      active: filters.active !== undefined ? filters.active : true,
      closed: filters.closed !== undefined ? filters.closed : false,
    };

    logger.info(`Fetching markets from Gamma API...`);
    const response = await axios.get(`${GAMMA_API_URL}/markets`, { params });
    
    const markets = response.data.map((m: any) => parseMarket(m));
    logger.info(`✓ Found ${markets.length} markets`);
    
    return markets;
  } catch (error: any) {
    logger.error('Failed to fetch markets', error);
    throw new Error(`Failed to fetch markets: ${error.message}`);
  }
}

/**
 * Get a specific market by slug
 */
export async function getMarketBySlug(slug: string): Promise<Market | null> {
  try {
    logger.info(`Fetching market: ${slug}`);
    const response = await axios.get(`${GAMMA_API_URL}/markets`, {
      params: { slug }
    });

    if (response.data && response.data.length > 0) {
      const market = parseMarket(response.data[0]);
      logger.info(`✓ Market found: ${market.question}`);
      return market;
    }

    logger.warn(`Market not found: ${slug}`);
    return null;
  } catch (error: any) {
    logger.error(`Failed to fetch market: ${slug}`, error);
    throw new Error(`Failed to fetch market: ${error.message}`);
  }
}

/**
 * Search markets by question
 */
export async function searchMarkets(query: string, limit: number = 10): Promise<Market[]> {
  try {
    logger.info(`Searching markets: ${query}`);
    const markets = await getActiveMarkets({ limit: 100 });
    
    const filtered = markets.filter(m => 
      m.question.toLowerCase().includes(query.toLowerCase()) ||
      m.description?.toLowerCase().includes(query.toLowerCase())
    ).slice(0, limit);
    
    logger.info(`✓ Found ${filtered.length} matching markets`);
    return filtered;
  } catch (error: any) {
    logger.error('Failed to search markets', error);
    throw new Error(`Failed to search markets: ${error.message}`);
  }
}

/**
 * Get token IDs for a market (YES and NO tokens)
 */
export function getTokenIds(market: Market): { yes: string; no: string } | null {
  try {
    if (!market.clobTokenIds) {
      return null;
    }

    // clobTokenIds can be a JSON array string: "[\"tokenId1\", \"tokenId2\"]"
    // or a comma-separated string: "tokenId1,tokenId2"
    let tokens: string[] = [];
    
    if (market.clobTokenIds.startsWith('[')) {
      // JSON array format
      try {
        tokens = JSON.parse(market.clobTokenIds);
      } catch {
        // Fallback: remove brackets and quotes manually
        tokens = market.clobTokenIds
          .replace(/[\[\]"]/g, '')
          .split(',')
          .map(t => t.trim());
      }
    } else {
      // Comma-separated format
      tokens = market.clobTokenIds.split(',').map(t => t.trim());
    }
    
    if (tokens.length !== 2) {
      logger.warn(`Expected 2 tokens, found ${tokens.length}`);
      return null;
    }

    return {
      yes: tokens[0].trim(),
      no: tokens[1].trim(),
    };
  } catch (error: any) {
    logger.error('Failed to parse token IDs', error);
    return null;
  }
}

/**
 * Parse market data from API response
 */
function parseMarket(data: any): Market {
  const tokens: { tokenId: string; outcome: string; price: string }[] = [];
  
  if (data.clobTokenIds) {
    const tokenIds = data.clobTokenIds.split(',');
    const prices = data.outcomePrices ? data.outcomePrices.split(',') : ['0', '0'];
    const outcomes = data.outcomes ? data.outcomes.split(',') : ['Yes', 'No'];
    
    tokenIds.forEach((tokenId: string, index: number) => {
      tokens.push({
        tokenId: tokenId.trim(),
        outcome: outcomes[index] || (index === 0 ? 'Yes' : 'No'),
        price: prices[index] || '0',
      });
    });
  }

  return {
    id: data.id,
    question: data.question,
    slug: data.slug,
    conditionId: data.conditionId,
    clobTokenIds: data.clobTokenIds,
    tokens,
    enableOrderBook: data.enableOrderBook || false,
    active: data.active || false,
    closed: data.closed || false,
    orderPriceMinTickSize: data.orderPriceMinTickSize || 0.01,
    orderMinSize: data.orderMinSize || 1,
    description: data.description,
    endDate: data.endDate,
    category: data.category,
    volume: data.volume,
    liquidity: data.liquidity,
  };
}

/**
 * Display market information
 */
export function displayMarket(market: Market): void {
  console.log('\n' + '='.repeat(70));
  console.log(`📊 ${market.question}`);
  console.log('='.repeat(70));
  console.log(`ID:           ${market.id}`);
  console.log(`Slug:         ${market.slug}`);
  console.log(`Status:       ${market.active ? '🟢 Active' : '🔴 Inactive'}`);
  console.log(`Closed:       ${market.closed ? 'Yes' : 'No'}`);
  console.log(`Category:     ${market.category || 'N/A'}`);
  console.log(`End Date:     ${market.endDate || 'N/A'}`);
  console.log(`Volume:       ${market.volume || 'N/A'}`);
  console.log(`Liquidity:    ${market.liquidity || 'N/A'}`);
  console.log(`Min Tick:     ${market.orderPriceMinTickSize}`);
  console.log(`Min Size:     ${market.orderMinSize}`);
  
  if (market.tokens.length > 0) {
    console.log('\nTokens:');
    market.tokens.forEach(token => {
      console.log(`  ${token.outcome}: ${token.price} (${token.tokenId.substring(0, 10)}...)`);
    });
  }
  
  if (market.description) {
    console.log(`\nDescription:`);
    console.log(`  ${market.description.substring(0, 200)}${market.description.length > 200 ? '...' : ''}`);
  }
  
  console.log('='.repeat(70) + '\n');
}
