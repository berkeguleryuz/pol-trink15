import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

(async () => {
  const client = new PolymarketSportsClient();
  const markets = await client.getActiveTradableMarkets();
  
  const now = new Date();
  
  // Brezilya maçlarını bul
  const brazilMatches = markets.filter((m: any) => {
    const title = (m.eventTitle || '').toLowerCase();
    return (title.includes('mineiro') || title.includes('bahia') || 
            title.includes('gremio') || title.includes('grêmio') ||
            title.includes('cruzeiro') || title.includes('flamengo') ||
            title.includes('são paulo') || title.includes('sao paulo'));
  });
  
  console.log(`\n🇧🇷 Found ${brazilMatches.length} Brazil markets\n`);
  
  // Group by event
  const eventMap = new Map();
  brazilMatches.forEach((m: any) => {
    if (!eventMap.has(m.eventSlug)) {
      eventMap.set(m.eventSlug, m);
    }
  });
  
  console.log(`📊 Unique events: ${eventMap.size}\n`);
  
  Array.from(eventMap.values()).forEach((m: any) => {
    const endDate = new Date(m.eventEndDate);
    const hoursUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    const minutesUntilEnd = (endDate.getTime() - now.getTime()) / (1000 * 60);
    
    const isWithin6Hours = hoursUntilEnd <= 6 && hoursUntilEnd > 0;
    const emoji = isWithin6Hours ? '✅' : '❌';
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`${emoji} ${m.eventTitle}`);
    console.log(`   End Date: ${endDate.toLocaleString('tr-TR')}`);
    console.log(`   Hours until end: ${hoursUntilEnd.toFixed(2)}h (${minutesUntilEnd.toFixed(0)} mins)`);
    console.log(`   Within 6h?: ${isWithin6Hours}`);
    console.log(`   Accepting orders: ${m.acceptingOrders}`);
    console.log(`   Active: ${m.active}`);
    console.log('');
  });
})();
