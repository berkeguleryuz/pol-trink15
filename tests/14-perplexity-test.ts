/**
 * Test Perplexity AI Integration
 */

import { PerplexityAI } from '../src/integrations/perplexity-ai';
import { TimezoneUtils } from '../src/utils/timezone';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  PERPLEXITY AI TEST');
  console.log('='.repeat(70) + '\n');

  try {
    const perplexity = new PerplexityAI();
    TimezoneUtils.log('✅ Perplexity AI initialized', 'INFO');

    console.log('\n' + '='.repeat(70));
    console.log('🔍 Fetching Finance News...');
    console.log('='.repeat(70) + '\n');

    const financeNews = await perplexity.getFinanceNews();
    
    if (financeNews.length > 0) {
      console.log(`Found ${financeNews.length} finance news items:\n`);
      financeNews.forEach(event => perplexity.logNewsEvent(event));
    } else {
      console.log('No finance news found.\n');
    }

    console.log('\n' + '='.repeat(70));
    console.log('📊 Fetching Tech News...');
    console.log('='.repeat(70) + '\n');

    const techNews = await perplexity.getTechNews();
    
    if (techNews.length > 0) {
      console.log(`Found ${techNews.length} tech news items:\n`);
      techNews.forEach(event => perplexity.logNewsEvent(event));
    } else {
      console.log('No tech news found.\n');
    }

    console.log('\n' + '='.repeat(70));
    console.log('🏛️  Fetching Political News...');
    console.log('='.repeat(70) + '\n');

    const politicalNews = await perplexity.getPoliticalNews();
    
    if (politicalNews.length > 0) {
      console.log(`Found ${politicalNews.length} political news items:\n`);
      politicalNews.forEach(event => perplexity.logNewsEvent(event));
    } else {
      console.log('No political news found.\n');
    }

    console.log('\n' + '='.repeat(70));
    console.log('🎯 Testing Market Research...');
    console.log('='.repeat(70) + '\n');

    const marketResult = await perplexity.searchMarket('Will Bitcoin reach $100,000 in 2025?');
    
    console.log('Market Analysis:');
    console.log(marketResult.answer);
    console.log(`\nRelevance: ${marketResult.relevance}`);
    console.log(`Sources: ${marketResult.sources.slice(0, 3).join(', ')}\n`);

    console.log('='.repeat(70));
    console.log('✅ PERPLEXITY AI TEST COMPLETED');
    console.log('='.repeat(70) + '\n');

  } catch (error: any) {
    TimezoneUtils.log(`Test failed: ${error.message}`, 'ERROR');
    console.error(error);
    process.exit(1);
  }
}

main();
