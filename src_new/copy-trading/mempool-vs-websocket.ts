/**
 * MEMPOOL vs WEBSOCKET COMPARISON
 *
 * Her iki kaynağı da dinler, hangisinin daha hızlı olduğunu ölçer.
 * Trade'i ilk kim yakalarsa kazanır!
 *
 * Usage:
 *   ./node_modules/.bin/ts-node src_new/copy-trading/mempool-vs-websocket.ts
 */

import { ethers } from 'ethers';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIG
// ============================================================================

const TARGET_WALLET = '0x336848a1a1cb00348020c9457676f34d882f21cd'.toLowerCase();
const CHAINSTACK_WS = process.env.CHAINSTACK_WS_URL || '';
const RTDS_WS = 'wss://ws-live-data.polymarket.com';

// Polymarket Contracts
const POLYMARKET_CONTRACTS = [
  '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'.toLowerCase(), // CTF Exchange
  '0xC5d563A36AE78145C45a50134d48A1215220f80a'.toLowerCase(), // Neg Risk CTF
  '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'.toLowerCase(), // Neg Risk Adapter
];

// ============================================================================
// TRACKING
// ============================================================================

interface TradeEvent {
  source: 'MEMPOOL' | 'WEBSOCKET';
  timestamp: number;
  txHash?: string;
  tokenId?: string;
  details: string;
}

const tradeEvents: Map<string, TradeEvent[]> = new Map();
const stats = {
  mempoolFirst: 0,
  websocketFirst: 0,
  mempoolOnly: 0,
  websocketOnly: 0,
  avgMempoolLead: 0,
  avgWebsocketLead: 0,
  totalComparisons: 0
};

// ============================================================================
// MEMPOOL MONITOR
// ============================================================================

let mempoolProvider: ethers.providers.WebSocketProvider | null = null;
const seenMempoolTx = new Set<string>();

async function startMempoolMonitor(): Promise<void> {
  if (!CHAINSTACK_WS) {
    console.log('❌ CHAINSTACK_WS_URL not set');
    return;
  }

  console.log('🔌 Connecting to Chainstack (Mempool)...');
  mempoolProvider = new ethers.providers.WebSocketProvider(CHAINSTACK_WS);

  const network = await mempoolProvider.getNetwork();
  console.log(`✅ Mempool connected: ${network.name}\n`);

  mempoolProvider.on('pending', async (txHash: string) => {
    if (seenMempoolTx.has(txHash)) return;
    seenMempoolTx.add(txHash);

    // Keep set manageable
    if (seenMempoolTx.size > 10000) {
      const arr = Array.from(seenMempoolTx);
      seenMempoolTx.clear();
      arr.slice(-5000).forEach(h => seenMempoolTx.add(h));
    }

    try {
      const tx = await mempoolProvider!.getTransaction(txHash);
      if (!tx) return;

      const from = tx.from?.toLowerCase();
      if (from !== TARGET_WALLET) return;

      const to = tx.to?.toLowerCase();
      const isPolymarket = to && POLYMARKET_CONTRACTS.includes(to);

      const now = Date.now();
      const timeStr = new Date().toLocaleTimeString('tr-TR', { hour12: false, fractionalSecondDigits: 3 });

      console.log(`\n[${timeStr}] 🟡 MEMPOOL: TX detected`);
      console.log(`   Hash: ${txHash.slice(0, 20)}...`);
      console.log(`   To: ${tx.to?.slice(0, 20)}...`);
      console.log(`   Polymarket: ${isPolymarket ? '✅ YES' : '❌ NO'}`);

      if (isPolymarket) {
        recordEvent(txHash, {
          source: 'MEMPOOL',
          timestamp: now,
          txHash,
          details: `To: ${tx.to}`
        });
      }

    } catch (e) {
      // TX might be replaced/dropped
    }
  });

  mempoolProvider._websocket.on('close', () => {
    console.log('⚠️ Mempool disconnected, reconnecting...');
    setTimeout(startMempoolMonitor, 3000);
  });
}

// ============================================================================
// WEBSOCKET (RTDS) MONITOR
// ============================================================================

let rtdsWs: WebSocket | null = null;

function startWebSocketMonitor(): void {
  console.log('🔌 Connecting to RTDS (WebSocket)...');
  rtdsWs = new WebSocket(RTDS_WS);

  rtdsWs.on('open', () => {
    console.log('✅ RTDS connected\n');

    rtdsWs!.send(JSON.stringify({
      action: 'subscribe',
      subscriptions: [{ topic: 'activity', type: 'trades' }]
    }));

    // Ping keepalive
    setInterval(() => {
      if (rtdsWs?.readyState === WebSocket.OPEN) {
        rtdsWs.ping();
      }
    }, 5000);
  });

  rtdsWs.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.topic !== 'activity' || msg.type !== 'trades') return;

      const payload = msg.payload;
      if ((payload.proxyWallet || '').toLowerCase() !== TARGET_WALLET) return;

      const now = Date.now();
      const timeStr = new Date().toLocaleTimeString('tr-TR', { hour12: false, fractionalSecondDigits: 3 });
      const txHash = payload.transactionHash || `ws-${now}`;

      console.log(`\n[${timeStr}] 🟢 WEBSOCKET: Trade detected`);
      console.log(`   Hash: ${txHash.slice(0, 20)}...`);
      console.log(`   ${payload.outcome} @ ${payload.price} = $${(parseFloat(payload.size) * parseFloat(payload.price)).toFixed(2)}`);
      console.log(`   ${payload.title?.slice(0, 40)}...`);

      recordEvent(txHash, {
        source: 'WEBSOCKET',
        timestamp: now,
        txHash,
        tokenId: payload.asset,
        details: `${payload.outcome} @ ${payload.price}`
      });

    } catch (e) {}
  });

  rtdsWs.on('close', () => {
    console.log('⚠️ RTDS disconnected, reconnecting...');
    setTimeout(startWebSocketMonitor, 3000);
  });

  rtdsWs.on('error', (err) => {
    console.error('❌ RTDS error:', err.message);
  });
}

// ============================================================================
// EVENT RECORDING & COMPARISON
// ============================================================================

function recordEvent(txHash: string, event: TradeEvent): void {
  if (!tradeEvents.has(txHash)) {
    tradeEvents.set(txHash, []);
  }

  const events = tradeEvents.get(txHash)!;
  events.push(event);

  // If we have both sources, compare
  if (events.length >= 2) {
    compareEvents(txHash, events);
  }

  // Cleanup old events after 30 seconds
  setTimeout(() => {
    if (tradeEvents.has(txHash)) {
      const evts = tradeEvents.get(txHash)!;
      if (evts.length === 1) {
        // Only one source caught it
        if (evts[0].source === 'MEMPOOL') {
          stats.mempoolOnly++;
          console.log(`\n⚠️ TX ${txHash.slice(0, 12)}... - MEMPOOL ONLY (WebSocket missed)`);
        } else {
          stats.websocketOnly++;
          console.log(`\n⚠️ TX ${txHash.slice(0, 12)}... - WEBSOCKET ONLY (Mempool missed)`);
        }
      }
      tradeEvents.delete(txHash);
      printStats();
    }
  }, 30000);
}

function compareEvents(txHash: string, events: TradeEvent[]): void {
  const mempool = events.find(e => e.source === 'MEMPOOL');
  const websocket = events.find(e => e.source === 'WEBSOCKET');

  if (!mempool || !websocket) return;

  const diff = websocket.timestamp - mempool.timestamp;
  stats.totalComparisons++;

  const timeStr = new Date().toLocaleTimeString('tr-TR', { hour12: false });

  if (diff > 0) {
    // Mempool was first
    stats.mempoolFirst++;
    stats.avgMempoolLead = ((stats.avgMempoolLead * (stats.mempoolFirst - 1)) + diff) / stats.mempoolFirst;

    console.log(`\n[${timeStr}] 🏆 MEMPOOL WON by ${diff}ms`);
    console.log(`   TX: ${txHash.slice(0, 20)}...`);
  } else if (diff < 0) {
    // WebSocket was first
    stats.websocketFirst++;
    const lead = Math.abs(diff);
    stats.avgWebsocketLead = ((stats.avgWebsocketLead * (stats.websocketFirst - 1)) + lead) / stats.websocketFirst;

    console.log(`\n[${timeStr}] 🏆 WEBSOCKET WON by ${Math.abs(diff)}ms`);
    console.log(`   TX: ${txHash.slice(0, 20)}...`);
  } else {
    console.log(`\n[${timeStr}] 🤝 TIE - Both at same time`);
  }

  printStats();
}

function printStats(): void {
  const total = stats.mempoolFirst + stats.websocketFirst;
  if (total === 0) return;

  const mempoolWinRate = ((stats.mempoolFirst / total) * 100).toFixed(1);
  const wsWinRate = ((stats.websocketFirst / total) * 100).toFixed(1);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 KARŞILAŞTIRMA SONUÇLARI`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`   🟡 Mempool kazandı: ${stats.mempoolFirst} (${mempoolWinRate}%)`);
  console.log(`   🟢 WebSocket kazandı: ${stats.websocketFirst} (${wsWinRate}%)`);
  console.log(`   ⚠️ Sadece Mempool: ${stats.mempoolOnly}`);
  console.log(`   ⚠️ Sadece WebSocket: ${stats.websocketOnly}`);
  console.log(`   📈 Avg Mempool lead: ${stats.avgMempoolLead.toFixed(0)}ms`);
  console.log(`   📈 Avg WebSocket lead: ${stats.avgWebsocketLead.toFixed(0)}ms`);
  console.log(`${'─'.repeat(50)}\n`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('   MEMPOOL vs WEBSOCKET - Speed Comparison');
  console.log('='.repeat(60));
  console.log(`   Target: ${TARGET_WALLET.slice(0, 10)}...`);
  console.log(`   Chainstack: ${CHAINSTACK_WS ? '✅' : '❌'}`);
  console.log('='.repeat(60) + '\n');

  // Start both monitors
  await startMempoolMonitor();
  startWebSocketMonitor();

  console.log('\n🚀 Monitoring both sources... (Ctrl+C to stop)\n');
  console.log('Her trade için hangisinin önce yakaladığını göreceğiz.\n');
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Final Stats:');
  printStats();
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
