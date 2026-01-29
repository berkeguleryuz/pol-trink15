import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * LiveScore6 RAW API response'u göster
 */

async function debugRawAPI() {
  const apiKey = process.env.LIVESCORE_API_KEY || '';
  
  const response = await axios.get('https://livescore6.p.rapidapi.com/matches/v2/list-live', {
    params: {
      Category: 'soccer',
      Timezone: '-7'
    },
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': 'livescore6.p.rapidapi.com'
    }
  });
  
  const stages = response.data.Stages || [];
  
  if (stages.length === 0) {
    console.log('No stages found\n');
    return;
  }
  
  const firstStage = stages[0];
  const firstEvent = firstStage.Events?.[0];
  
  console.log('📊 First Stage:\n');
  console.log(`Sdn: ${firstStage.Sdn}`);
  console.log(`Cnm: ${firstStage.Cnm}`);
  console.log(`Csnm: ${firstStage.Csnm}`);
  console.log('');
  
  console.log('📊 First Event:\n');
  console.log(JSON.stringify(firstEvent, null, 2));
}

debugRawAPI().catch(console.error);
