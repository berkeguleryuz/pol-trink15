const WebSocket = require('ws');

const WS_URL = 'wss://ws-live-data.polymarket.com';

// Test edilecek subscription'lar
const subscriptions = [
  { name: 'Test 1: activity/trades', payload: {"action": "subscribe", "subscriptions": [{"topic": "activity", "type": "trades"}]} },
  { name: 'Test 2: activity/*', payload: {"action": "subscribe", "subscriptions": [{"topic": "activity", "type": "*"}]} },
  { name: 'Test 3: trades/update', payload: {"action": "subscribe", "subscriptions": [{"topic": "trades", "type": "update"}]} },
];

let currentTestIndex = 0;
let ws = null;
let messageCount = 0;
let testStartTime = null;
const MAX_MESSAGES = 10;
const TEST_TIMEOUT = 15000; // 15 saniye

function runTest(testIndex) {
  if (testIndex >= subscriptions.length) {
    console.log('\n========================================');
    console.log('TÜM TESTLER TAMAMLANDI');
    console.log('========================================');
    process.exit(0);
  }

  const test = subscriptions[testIndex];
  messageCount = 0;
  testStartTime = Date.now();

  console.log('\n========================================');
  console.log(`${test.name}`);
  console.log('========================================');
  console.log('Gönderilen:', JSON.stringify(test.payload, null, 2));
  console.log('----------------------------------------');

  ws = new WebSocket(WS_URL);

  const timeout = setTimeout(() => {
    console.log(`\n[TIMEOUT] ${TEST_TIMEOUT/1000} saniye içinde ${messageCount} mesaj alındı`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }, TEST_TIMEOUT);

  ws.on('open', () => {
    console.log('[BAĞLANTI] WebSocket açıldı');
    ws.send(JSON.stringify(test.payload));
    console.log('[GÖNDERİLDİ] Subscription isteği');
  });

  ws.on('message', (data) => {
    messageCount++;
    const msg = data.toString();

    try {
      const parsed = JSON.parse(msg);
      console.log(`\n[MESAJ #${messageCount}] (${((Date.now() - testStartTime)/1000).toFixed(1)}s)`);
      console.log(JSON.stringify(parsed, null, 2));

      // Önemli alanları analiz et
      if (parsed.data) {
        console.log('\n--- ALAN ANALİZİ ---');
        const fields = Object.keys(parsed.data);
        console.log('Mevcut alanlar:', fields.join(', '));

        // User adresi var mı?
        if (parsed.data.user || parsed.data.maker || parsed.data.taker || parsed.data.owner) {
          console.log('USER/MAKER/TAKER:', parsed.data.user || parsed.data.maker || parsed.data.taker || parsed.data.owner);
        }

        // İşlem detayları
        if (parsed.data.size) console.log('SIZE:', parsed.data.size);
        if (parsed.data.price) console.log('PRICE:', parsed.data.price);
        if (parsed.data.side) console.log('SIDE:', parsed.data.side);
        if (parsed.data.asset_id) console.log('ASSET_ID:', parsed.data.asset_id);
        if (parsed.data.market) console.log('MARKET:', parsed.data.market);
        if (parsed.data.outcome) console.log('OUTCOME:', parsed.data.outcome);
      }

    } catch (e) {
      console.log(`\n[MESAJ #${messageCount}] (raw):`, msg);
    }

    if (messageCount >= MAX_MESSAGES) {
      console.log(`\n[LIMIT] ${MAX_MESSAGES} mesaj alındı, sonraki teste geçiliyor...`);
      clearTimeout(timeout);
      ws.close();
    }
  });

  ws.on('error', (err) => {
    console.log('[HATA]', err.message);
  });

  ws.on('close', () => {
    console.log('[KAPANDI] WebSocket bağlantısı kapandı');
    clearTimeout(timeout);
    currentTestIndex++;
    setTimeout(() => runTest(currentTestIndex), 2000);
  });
}

console.log('========================================');
console.log('POLYMARKET ACTIVITY/TRADES WEBSOCKET TESTİ');
console.log('========================================');
console.log('URL:', WS_URL);
console.log('Her test için max mesaj:', MAX_MESSAGES);
console.log('Timeout:', TEST_TIMEOUT/1000, 'saniye');

runTest(0);
