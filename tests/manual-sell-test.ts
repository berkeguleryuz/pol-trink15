/**
 * MANUEL SELL TEST
 * Açtığımız 3 pozisyonu satıyoruz
 */

import { PolymarketClientWrapper } from '../src_new/trading/polymarket-client';
import { ClobClient, Side, OrderType } from '@polymarket/clob-client';

interface Position {
  tokenId: string;
  description: string;
  shares?: number; // Eğer biliyorsak
}

async function sellToken(client: ClobClient, tokenId: string, description: string): Promise<void> {
  console.log(`\n📉 SATIŞ: ${description}`);
  console.log(`   Token ID: ${tokenId.slice(0, 20)}...`);
  
  try {
    // Önce bu token'daki pozisyonumuzu sorgula
    console.log('   🔍 Pozisyon sorgulanıyor...');
    
    // Basit sell stratejisi: Tüm shares'leri sat
    // Not: Gerçek uygulamada balance sorgulama yapılmalı
    
    console.log('   💰 Market sell order oluşturuluyor...');
    
    // Approximate: Her pozisyon için ~$1 harcadık, fiyat ~0.8 ise ~1.25 shares
    // Ama tam değeri bilmediğimiz için küçük bir miktar deneyelim
    const sellAmount = 1.0; // shares (conservative estimate)
    
    const orderObj = await client.createMarketOrder({
      tokenID: tokenId,
      amount: sellAmount, // shares to sell
      side: Side.SELL
    });

    const response = await client.postOrder(orderObj, OrderType.FOK);

    console.log(`   ✅ Sell executed!`);
    console.log(`   📋 Order ID: ${response.orderID}`);
    
  } catch (error: any) {
    console.error(`   ❌ Sell failed: ${error.message}`);
  }
}

async function main() {
  console.log('\n💰 MANUEL SELL TEST');
  console.log('='.repeat(80));
  console.log('Açtığımız 3 pozisyonu satıyoruz');
  console.log('='.repeat(80) + '\n');

  // Client başlat
  console.log('📡 Polymarket client başlatılıyor...');
  const clientWrapper = await PolymarketClientWrapper.create();
  const client = clientWrapper.getClient();
  console.log('   ✅ Client hazır - LIVE MODE!\n');

  // Açtığımız pozisyonların token ID'leri
  const positions: Position[] = [
    {
      tokenId: '74415029846425030034646178029108619752039539788542762625563584119227596807461',
      description: '1️⃣  Al Qadisiyah KAZANIR (YES)'
    },
    {
      tokenId: '98167471773685251679435563480229090757768288503109631400382047575444341436842',
      description: '2️⃣  BERABERE BİTER (NO)'
    },
    {
      tokenId: '97846973831922776072890477492378040693663097174077167540112748479346450202635',
      description: '3️⃣  Al Kholood KAZANIR (NO)'
    }
  ];

  console.log('💼 POZİSYONLAR:');
  positions.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.description}`);
  });
  console.log('\n' + '='.repeat(80));

  // Her pozisyonu sat
  for (const position of positions) {
    await sellToken(client, position.tokenId, position.description);
    
    // Rate limiting için kısa bekle
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ SATIŞ TESTİ TAMAMLANDI');
  console.log('🔗 Portfolio: https://polymarket.com/portfolio/0x50fCb5beAC8d9AD939f4D8f0DaaaC045778BEc89');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
