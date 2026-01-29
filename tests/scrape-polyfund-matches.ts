import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface PolyfundMarket {
  id: string;
  ticker: string;
  slug: string;
  title?: string;
  question?: string;
  description?: string;
  endDate?: string;
  end_date?: string;
  endDateIso?: string;
  startDate?: string;
  volume24hr?: number;
  liquidity?: number;
  outcomes?: any[];
  tokens?: any[];
  markets?: any[]; // Nested markets array with conditionId and clobTokenIds
}

interface MarketOutcome {
  question: string;
  outcomes: string; // JSON array: ["Yes", "No"]
  clobTokenIds: string; // JSON array of token IDs
  conditionId: string;
}

interface MatchData {
  id: string;
  slug: string;
  title: string;
  endDate: string;
  matchDate: string; // Extracted from slug (YYYY-MM-DD)
  volume24hr?: number;
  liquidity?: number;
  sport?: string; // Extracted from slug (nfl, epl, uel, etc.)
  markets?: MarketOutcome[]; // ✅ ALL markets (home win, draw, away win)
}

/**
 * Extract date from slug (format: sport-team1-team2-YYYY-MM-DD)
 * Examples:
 *   nfl-lv-den-2025-11-06 → 2025-11-06
 *   epl-sun-ars-2025-11-08 → 2025-11-08
 *   uel-mid1-cel3-2025-11-06 → 2025-11-06
 */
function extractDateFromSlug(slug: string): string | null {
  const parts = slug.split('-');
  if (parts.length < 4) return null;
  
  // Last 3 parts should be YYYY-MM-DD
  const year = parts[parts.length - 3];
  const month = parts[parts.length - 2];
  const day = parts[parts.length - 1];
  
  // Validate format
  if (year.length === 4 && month.length === 2 && day.length === 2) {
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

/**
 * Extract sport from slug (first segment)
 * Examples:
 *   nfl-lv-den-2025-11-06 → nfl
 *   epl-sun-ars-2025-11-08 → epl
 *   uel-mid1-cel3-2025-11-06 → uel
 */
function extractSportFromSlug(slug: string): string {
  const parts = slug.split('-');
  return parts[0]?.toUpperCase() || 'UNKNOWN';
}

/**
 * Fetch all matches from Polyfund API with pagination
 */
async function fetchAllPolyfundMatches(): Promise<MatchData[]> {
  console.log('\n' + '='.repeat(80));
  console.log('   ⚽ POLYFUND MATCH FETCHER - PAGINATION');
  console.log('='.repeat(80));

  const allMatches: MatchData[] = [];
  let offset = 0;
  const limit = 60; // API limit per request
  let pageNumber = 1;
  
  try {
    while (true) {
      console.log(`\n📡 Page ${pageNumber} - Fetching matches (offset: ${offset}, limit: ${limit})...`);
      
      const response = await axios.get('https://www.polyfund.so/api/market-items', {
        params: {
          limit,
          offset,
          active: true,
          archived: false,
          closed: false,
          order: 'volume24hr',
          ascending: false,
          liquidity_num_min: 1,
          tag_id: 1  // Sports tag
        },
        timeout: 10000
      });

      const markets = Array.isArray(response.data) ? response.data : (response.data.data || []);
      
      if (markets.length === 0) {
        console.log(`   ⛔ No more matches found. Stopping pagination.`);
        break;
      }
      
      console.log(`   ✅ Found ${markets.length} markets`);

      // Parse matches
      for (const market of markets) {
        const slug = market.slug || market.ticker;
        if (!slug) continue;

        const matchDate = extractDateFromSlug(slug);
        if (!matchDate) {
          console.log(`   ⚠️ Skipping ${slug} - Could not extract date`);
          continue;
        }

        const endDate = market.endDate || market.end_date || market.endDateIso;
        const title = market.title || market.question || slug;

        // ✅ Extract ALL markets (home win, draw, away win)
        const markets: MarketOutcome[] = [];
        
        if (market.markets && market.markets.length > 0) {
          for (const m of market.markets) {
            if (m.question && m.clobTokenIds && m.conditionId) {
              markets.push({
                question: m.question,
                outcomes: m.outcomes || '["Yes", "No"]',
                clobTokenIds: m.clobTokenIds,
                conditionId: m.conditionId
              });
            }
          }
        }

        allMatches.push({
          id: market.id,
          slug,
          title,
          endDate: endDate || matchDate,
          matchDate,
          volume24hr: market.volume24hr,
          liquidity: market.liquidity,
          sport: extractSportFromSlug(slug),
          markets // ✅ ALL markets with tokens
        });
      }

      // Continue pagination
      offset += limit;
      pageNumber++;

      // Safety limit (prevent infinite loop)
      if (pageNumber > 20) {
        console.log(`   ⚠️ Reached safety limit (20 pages). Stopping.`);
        break;
      }
    }

    console.log(`\n✅ Total matches fetched: ${allMatches.length}`);
    return allMatches;

  } catch (error: any) {
    console.error('\n❌ Error fetching matches:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2).slice(0, 500));
    }
    return allMatches; // Return what we have so far
  }
}

/**
 * Filter and sort matches by date
 */
function filterAndSortMatches(matches: MatchData[], daysAhead: number = 7): MatchData[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today
  
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  
  const todayStr = today.toISOString().split('T')[0];
  const futureDateStr = futureDate.toISOString().split('T')[0];

  console.log(`\n📅 Filtering matches: ${todayStr} → ${futureDateStr}`);

  // Filter: today through today+daysAhead
  const filtered = matches.filter(match => {
    return match.matchDate >= todayStr && match.matchDate <= futureDateStr;
  });

  console.log(`   ✅ ${filtered.length} matches within date range`);

  // Sort by matchDate (ascending - soonest first)
  filtered.sort((a, b) => a.matchDate.localeCompare(b.matchDate));

  return filtered;
}

/**
 * Save matches to local cache
 */
function saveToCache(matches: MatchData[]): void {
  const dataDir = path.join(__dirname, '..', 'data');
  
  // Create data directory if it doesn't exist
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const filePath = path.join(dataDir, 'polymarket-matches.json');
  
  const cacheData = {
    updatedAt: new Date().toISOString(),
    totalMatches: matches.length,
    matches
  };

  fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2));
  console.log(`\n💾 Saved ${matches.length} matches to: ${filePath}`);
}

/**
 * Check if cache is stale (older than 30 minutes)
 */
function isCacheStale(): boolean {
  const filePath = path.join(__dirname, '..', 'data', 'polymarket-matches.json');
  
  if (!fs.existsSync(filePath)) {
    console.log('   📭 Cache file does not exist');
    return true;
  }

  const stats = fs.statSync(filePath);
  const fileAge = Date.now() - stats.mtimeMs;
  const thirtyMinutes = 30 * 60 * 1000;

  if (fileAge > thirtyMinutes) {
    console.log(`   ⏰ Cache is ${Math.round(fileAge / 60000)} minutes old (stale)`);
    return true;
  }

  console.log(`   ✅ Cache is ${Math.round(fileAge / 60000)} minutes old (fresh)`);
  return false;
}

/**
 * Print match statistics
 */
function printStatistics(matches: MatchData[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 MATCH STATISTICS');
  console.log('='.repeat(80));

  // Group by date
  const byDate: { [date: string]: MatchData[] } = {};
  matches.forEach(match => {
    if (!byDate[match.matchDate]) {
      byDate[match.matchDate] = [];
    }
    byDate[match.matchDate].push(match);
  });

  // Group by sport
  const bySport: { [sport: string]: number } = {};
  matches.forEach(match => {
    const sport = match.sport || 'UNKNOWN';
    bySport[sport] = (bySport[sport] || 0) + 1;
  });

  console.log(`\n📅 BY DATE:`);
  Object.keys(byDate).sort().forEach(date => {
    const count = byDate[date].length;
    const dateObj = new Date(date);
    const dayName = dateObj.toLocaleDateString('tr-TR', { weekday: 'long' });
    console.log(`   ${date} (${dayName}): ${count} matches`);
  });

  console.log(`\n⚽ BY SPORT:`);
  Object.entries(bySport)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sport, count]) => {
      console.log(`   ${sport}: ${count} matches`);
    });

  console.log(`\n📊 TOTAL: ${matches.length} matches`);
  
  // ✅ Market statistics
  const withMarkets = matches.filter(m => m.markets && m.markets.length > 0);
  const withoutMarkets = matches.filter(m => !m.markets || m.markets.length === 0);
  
  console.log(`\n🎫 MARKETS:`);
  console.log(`   ✅ With markets: ${withMarkets.length} matches`);
  console.log(`   ❌ Without markets: ${withoutMarkets.length} matches`);
  
  if (withMarkets.length > 0) {
    const totalMarkets = withMarkets.reduce((sum, m) => sum + (m.markets?.length || 0), 0);
    const avgMarketsPerMatch = (totalMarkets / withMarkets.length).toFixed(1);
    console.log(`   📊 Total markets: ${totalMarkets}`);
    console.log(`   📈 Avg per match: ${avgMarketsPerMatch}`);
  }
  
  console.log('='.repeat(80));
}

/**
 * Print today's matches
 */
function printTodaysMatches(matches: MatchData[]): void {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayMatches = matches.filter(m => m.matchDate === todayStr);

  if (todayMatches.length === 0) {
    console.log('\n⚠️ No matches today!');
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`🔴 TODAY'S MATCHES (${todayStr})`);
  console.log('='.repeat(80));

  todayMatches.forEach((match, index) => {
    console.log(`\n${index + 1}. ${match.sport} - ${match.title}`);
    console.log(`   🔗 ${match.slug}`);
    if (match.volume24hr) {
      console.log(`   💰 Volume: $${match.volume24hr.toLocaleString()}`);
    }
    if (match.liquidity) {
      console.log(`   💧 Liquidity: $${match.liquidity.toLocaleString()}`);
    }
  });

  console.log('\n' + '='.repeat(80));
}

/**
 * Main function
 */
async function main() {
  console.log('\n🚀 Starting Polyfund Match Scraper...\n');

  // Check if cache exists and is fresh
  console.log('🔍 Checking cache status...');
  const needsRefresh = isCacheStale();

  if (!needsRefresh) {
    console.log('✅ Cache is fresh! Loading from file...\n');
    const filePath = path.join(__dirname, '..', 'data', 'polymarket-matches.json');
    const cacheData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`📦 Loaded ${cacheData.totalMatches} matches from cache`);
    console.log(`🕐 Last updated: ${new Date(cacheData.updatedAt).toLocaleString('tr-TR')}`);
    
    printStatistics(cacheData.matches);
    printTodaysMatches(cacheData.matches);
    
    console.log('\n💡 To force refresh, delete: data/polymarket-matches.json\n');
    return;
  }

  // Fetch fresh data
  console.log('🔄 Cache is stale or missing. Fetching fresh data...\n');
  
  const allMatches = await fetchAllPolyfundMatches();
  
  if (allMatches.length === 0) {
    console.error('\n❌ No matches found!');
    return;
  }

  // Filter and sort by date (today + 7 days)
  const filteredMatches = filterAndSortMatches(allMatches, 7);

  // Save to cache
  saveToCache(filteredMatches);

  // Print statistics
  printStatistics(filteredMatches);
  
  // Print today's matches
  printTodaysMatches(filteredMatches);

  console.log('\n✅ Done!\n');
}

// Run
main();
