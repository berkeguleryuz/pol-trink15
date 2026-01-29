/**
 * Debug: Market tag'lerini görelim
 */

import axios from 'axios';

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

async function debugTags() {
  console.log('\n🔍 Fetching markets to debug tags...\n');

  try {
    const response = await axios.get(`${GAMMA_API_URL}/markets`, {
      params: {
        active: true,
        closed: false,
        limit: 50, // İlk 50 market
      },
      timeout: 15000,
    });

    const markets = response.data || [];

    console.log(`📊 Found ${markets.length} active markets\n`);

    // İlk 10 market'in tag'lerini göster
    for (let i = 0; i < Math.min(10, markets.length); i++) {
      const market = markets[i];
      
      console.log(`${i + 1}. "${market.question}"`);
      console.log(`   Tags: ${market.tags?.join(', ') || '(no tags)'}`);
      console.log(`   Group Item Title: ${market.groupItemTitle || '(none)'}`);
      console.log(`   Description: ${market.description?.substring(0, 100) || '(none)'}...`);
      console.log('');
    }

    // Tag frequency analizi
    console.log('\n📊 TAG FREQUENCY ANALYSIS:\n');
    const tagCounts = new Map<string, number>();
    
    markets.forEach((market: any) => {
      (market.tags || []).forEach((tag: string) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });

    const sortedTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20); // Top 20 tags

    sortedTags.forEach(([tag, count]) => {
      console.log(`   ${tag}: ${count} markets`);
    });

  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

debugTags();
