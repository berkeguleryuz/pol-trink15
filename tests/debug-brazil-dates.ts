import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

(async () => {
  const client = new PolymarketSportsClient();
  const markets = await client.getActiveTradableMarkets();
  
  // Botafogo/Vasco/Gremio/Cruzeiro içeren marketleri bul
  const brazilMarkets = markets.filter((m: any) => {
    const title = (m.eventTitle || '').toLowerCase();
    return title.includes('botafogo') || title.includes('vasco') || 
           title.includes('gremio') || title.includes('cruzeiro');
  });
  
  console.log(`\nFound ${brazilMarkets.length} Brazil markets\n`);
  
  // Unique event'leri grupla
  const eventMap = new Map();
  brazilMarkets.forEach((m: any) => {
    const slug = m.eventSlug;
    if (!eventMap.has(slug)) {
      eventMap.set(slug, m);
    }
  });
  
  console.log(`Unique events: ${eventMap.size}\n`);
  
  Array.from(eventMap.values()).slice(0, 5).forEach((m: any) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Title: "${m.eventTitle}"`);
    console.log(`Slug: ${m.eventSlug}`);
    console.log(`eventStartDate: ${m.eventStartDate}`);
    console.log(`eventEndDate: ${m.eventEndDate}`);
    console.log(`acceptingOrders: ${m.acceptingOrders}`);
    console.log(`active: ${m.active}`);
    console.log(`closed: ${m.closed}`);
    console.log(`end_date_iso: ${m.end_date_iso}`);
    
    // Parse dates
    const now = new Date();
    const startDate = new Date(m.eventStartDate);
    const endDate = new Date(m.eventEndDate);
    
    console.log(`\nParsed:`);
    console.log(`  Now: ${now.toISOString()}`);
    console.log(`  Start: ${startDate.toISOString()}`);
    console.log(`  End: ${endDate.toISOString()}`);
    console.log(`  Days since start: ${((now.getTime() - startDate.getTime()) / (1000*60*60*24)).toFixed(1)}`);
    console.log(`  Is past?: ${startDate < now}`);
    console.log(`  Is live?: ${startDate <= now && endDate > now}`);
    console.log('');
  });
})();
