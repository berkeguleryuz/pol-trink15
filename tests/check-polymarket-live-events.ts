import { PolymarketSportsClient } from '../src/integrations/polymarket-sports';

async function checkPolymarketLiveEvents() {
  console.log('\n' + '='.repeat(80));
  console.log('   🔴 POLYMARKET LIVE EVENTS CHECK');
  console.log('='.repeat(80) + '\n');

  const client = new PolymarketSportsClient();

  try {
    // 1. Get all active events
    console.log('📡 Fetching all active events from Polymarket...\n');
    
    const response = await fetch('https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100');
    const events = await response.json() as any[];

    console.log(`✅ Found ${events.length} active events\n`);

    if (events.length === 0) {
      console.log('❌ No active events found.\n');
      return;
    }

    // 2. Filter for sports events that might be live
    console.log('🔍 Analyzing events...\n');
    console.log('─'.repeat(80) + '\n');

    const now = new Date();
    const liveEvents: any[] = [];
    const upcomingEvents: any[] = [];

    for (const event of events) {
      const startDate = event.startDate ? new Date(event.startDate) : null;
      const endDate = event.endDate ? new Date(event.endDate) : null;

      // Check if event is currently happening (between start and end date)
      const isLive = startDate && endDate && startDate <= now && now <= endDate;

      const eventInfo = {
        title: event.title,
        slug: event.slug,
        startDate: startDate?.toLocaleString('tr-TR'),
        endDate: endDate?.toLocaleString('tr-TR'),
        markets: event.markets?.length || 0,
        tags: event.tags || [],
        active: event.active,
        closed: event.closed,
        isLive
      };

      if (isLive) {
        liveEvents.push(eventInfo);
      } else if (startDate && startDate > now) {
        upcomingEvents.push(eventInfo);
      }
    }

    // Display LIVE events
    if (liveEvents.length > 0) {
      console.log(`🔴 LIVE EVENTS (${liveEvents.length}):\n`);
      
      for (const event of liveEvents) {
        console.log(`⚽ ${event.title}`);
        console.log(`   🔗 Slug: ${event.slug}`);
        console.log(`   ⏰ Started: ${event.startDate}`);
        console.log(`   🏁 Ends: ${event.endDate}`);
        console.log(`   📈 Markets: ${event.markets}`);
        console.log(`   🏷️  Tags: ${event.tags.join(', ')}`);
        console.log('─'.repeat(80) + '\n');
      }
    } else {
      console.log('⚠️  No LIVE events found at this moment.\n');
      console.log('💡 This is normal - matches might not have started yet.\n');
    }

    // Display upcoming events (next few hours)
    const soonEvents = upcomingEvents
      .filter(e => {
        const start = new Date(e.startDate!);
        const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntilStart <= 6; // Next 6 hours
      })
      .slice(0, 10);

    if (soonEvents.length > 0) {
      console.log(`⏳ UPCOMING EVENTS (Next 6 hours - showing ${soonEvents.length}):\n`);
      
      for (const event of soonEvents) {
        const start = new Date(event.startDate!);
        const hoursUntilStart = (start.getTime() - now.getTime()) / (1000 * 60 * 60);
        const minutesUntilStart = Math.round(hoursUntilStart * 60);

        console.log(`📅 ${event.title}`);
        console.log(`   🔗 Slug: ${event.slug}`);
        console.log(`   ⏰ Starts in: ${minutesUntilStart} minutes`);
        console.log(`   📈 Markets: ${event.markets}`);
        console.log(`   🏷️  Tags: ${event.tags.join(', ')}`);
        console.log('─'.repeat(80) + '\n');
      }
    }

    // 3. Get teams list to understand structure
    console.log('\n' + '='.repeat(80));
    console.log('   🏆 AVAILABLE TEAMS');
    console.log('='.repeat(80) + '\n');

    const teamsResponse = await fetch('https://gamma-api.polymarket.com/teams?limit=20');
    const teams = await teamsResponse.json() as any[];

    console.log(`Total teams available: ${teams.length}\n`);
    
    // Group by sport/league
    const teamsByLeague = teams.reduce((acc: any, team: any) => {
      const league = team.league || 'Unknown';
      if (!acc[league]) acc[league] = [];
      acc[league].push(team.name);
      return acc;
    }, {});

    console.log('Teams by league:');
    Object.entries(teamsByLeague).forEach(([league, teamList]: [string, any]) => {
      console.log(`\n${league}:`);
      console.log(`   ${teamList.slice(0, 5).join(', ')}${teamList.length > 5 ? ` ... (+${teamList.length - 5} more)` : ''}`);
    });

    // 4. Summary
    console.log('\n' + '='.repeat(80));
    console.log('   📊 SUMMARY');
    console.log('='.repeat(80) + '\n');
    console.log(`🔴 Live Events: ${liveEvents.length}`);
    console.log(`⏳ Upcoming (6h): ${soonEvents.length}`);
    console.log(`📅 Total Active: ${events.length}`);
    console.log(`🏆 Total Teams: ${teams.length}`);

    // 5. Check specific tags for sports
    console.log('\n' + '='.repeat(80));
    console.log('   🏷️  CHECKING SPORTS TAGS');
    console.log('='.repeat(80) + '\n');

    const tagsResponse = await fetch('https://gamma-api.polymarket.com/tags?limit=50');
    const tags = await tagsResponse.json() as any[];

    const sportsTags = tags.filter((tag: any) => 
      tag.name.toLowerCase().includes('soccer') ||
      tag.name.toLowerCase().includes('football') ||
      tag.name.toLowerCase().includes('basketball') ||
      tag.name.toLowerCase().includes('baseball') ||
      tag.name.toLowerCase().includes('sports')
    );

    console.log(`Found ${sportsTags.length} sports-related tags:\n`);
    sportsTags.forEach((tag: any) => {
      console.log(`   📌 ${tag.name} (ID: ${tag.id})`);
    });

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

checkPolymarketLiveEvents()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
