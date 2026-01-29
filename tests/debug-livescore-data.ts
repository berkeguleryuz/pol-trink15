import { LiveScore6Client } from '../src/integrations/livescore6-client';

/**
 * LiveScore6 API'den gelen RAW veriyi incele
 */

async function debugLiveScore6() {
  const client = new LiveScore6Client();
  
  const matches = await client.getLiveMatches();
  
  if (matches.length === 0) {
    console.log('No live matches\n');
    return;
  }
  
  const match = matches[0];
  
  console.log('📊 First Live Match Details:\n');
  console.log(JSON.stringify(match, null, 2));
}

debugLiveScore6().catch(console.error);
