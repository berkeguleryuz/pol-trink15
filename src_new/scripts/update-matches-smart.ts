/**
 * SMART MATCH UPDATE - Akıllı Güncelleme
 * 
 * ✅ Mevcut maçları KORUR (apiFootballId, tracking state)
 * ✅ Yeni maçları EKLER
 * ✅ Bitmiş maçları SİLER (endDate geçmiş + closed)
 * ✅ Polyfund'dan SAYFALAYARAK çeker (60'ar 60'ar)
 * 
 * Kullanım:
 * - Bot başlatılırken: await smartUpdateMatches()
 * - 1-2 saatte bir: await smartUpdateMatches()
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface PolyfundMatch {
  slug: string;
  question: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  archived?: boolean;
  homeTeam?: string | null;
  awayTeam?: string | null;
  title?: string;
  league?: string;
  outcomes?: any[];
  volume?: string;
  liquidity?: string;
  tags?: any[];
}

interface FootballMatch {
  slug: string;
  title: string;
  homeTeam: string | null;
  awayTeam: string | null;
  league: string;
  startDate: string;
  endDate: string;
  outcomes: any[];
  volume: string;
  liquidity: string;
  tags?: any[];
  
  // API-Football linking (KORUNMALI)
  apiFootballId?: number;
  homeScore?: number;
  awayScore?: number;
  currentMinute?: number;
  
  // Tracking state (KORUNMALI)
  isTracking?: boolean;
  lastChecked?: string;
}

interface MatchDatabase {
  updatedAt: string;
  berlinTime: string;
  totalMatches: number;
  matches: FootballMatch[];
}

const POLYFUND_API = 'https://www.polyfund.so/api/market-items';
const PAGE_SIZE = 60;
const MAX_PAGES = 50; // Max 3000 maç (50 sayfa) - tüm listeyi tara

/**
 * Maçın futbol maçı olup olmadığını kontrol et
 * NOT: SLUG prefix'ine göre - sadece bilinen futbol ligleri
 */
function isFootballMatch(match: PolyfundMatch): boolean {
  const slug = (match.slug || '').toLowerCase();
  const title = (match.question || match.title || '').toLowerCase();
  
  // 1. "vs" veya "vs." içermeli (takım maçı formatı)
  const hasVersus = title.includes(' vs ') || title.includes(' vs. ');
  if (!hasVersus) return false;
  
  // 2. SADECE BİLİNEN FUTBOL LİG SLUG'LARI (kısa prefix listesi)
  const FOOTBALL_SLUGS = [
    'epl-',  // Premier League
    'lal-',  // La Liga
    'bun-',  // Bundesliga
    'fl1-',  // Ligue 1
    'sea-',  // Serie A
    'mls-',  // MLS
    'uel-',  // Europa League
    'ucl-',  // Champions League
    'col-',  // Conference League
    'aus-',  // Australian League
    'kor-',  // K-League (Korea)
    'arg-',  // Argentina
    'rus-',  // Russian Premier League
    'efa-',  // EFA (?)
    'elc-',  // EFL Championship
    'tur-',  // Süper Lig
    'bra-',  // Brasileirão
    'spl-',  // Saudi Pro League
  ];
  
  const isFootballLeague = FOOTBALL_SLUGS.some(prefix => slug.startsWith(prefix));
  
  // Sadece bu liglerdeki maçları kabul et
  return isFootballLeague;
}

/**
 * Polyfund'dan TÜM aktif maçları çek (sayfalayarak)
 */
/**
 * Polyfund'dan TÜM aktif maçları çek (sayfalayarak)
 */
async function fetchAllActiveMatches(): Promise<PolyfundMatch[]> {
  const allMatches: PolyfundMatch[] = [];
  
  console.log('📡 Polyfund API\'den SPOR maçları çekiliyor (tag_id=1)...');
  
  let page = 0;
  let hasMore = true;
  
  while (hasMore && page < MAX_PAGES) {
    const offset = page * PAGE_SIZE;
    
    try {
      // ÖNEMLİ: tag_id=1 ekleyerek SADECE SPOR kategorisini çek
      const url = `${POLYFUND_API}?limit=${PAGE_SIZE}&offset=${offset}&active=true&archived=false&closed=false&order=volume24hr&ascending=false&liquidity_num_min=1&tag_id=1&related_tags=true`;
      
      const response = await axios.get(url, { timeout: 10000 });
      const matches = response.data as PolyfundMatch[];
      
      if (!Array.isArray(matches) || matches.length === 0) {
        console.log(`   ℹ️  Sayfa ${page + 1}: Maç bulunamadı, duruluyor`);
        hasMore = false;
        break;
      }
      
      // Sadece FUTBOL maçlarını ekle (diğer sporları filtrele: basketbol, tenis, vs)
      const footballMatches = matches.filter(isFootballMatch);
      allMatches.push(...footballMatches);
      
      console.log(`   ✅ Sayfa ${page + 1}: ${matches.length} spor → ${footballMatches.length} futbol (toplam: ${allMatches.length})`);
      
      // Daha az maç döndü = son sayfa
      if (matches.length < PAGE_SIZE) {
        console.log(`   ℹ️  Son sayfaya ulaşıldı`);
        hasMore = false;
        break;
      }
      
      page++;
      
      // Rate limiting (1 saniye bekle)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error: any) {
      console.error(`   ❌ Sayfa ${page + 1} hatası:`, error.message);
      hasMore = false;
      break;
    }
  }
  
  // EndDate'e göre sırala (yakın olanlar önce)
  allMatches.sort((a, b) => {
    const dateA = a.endDate ? new Date(a.endDate).getTime() : Date.now() + 365 * 24 * 60 * 60 * 1000;
    const dateB = b.endDate ? new Date(b.endDate).getTime() : Date.now() + 365 * 24 * 60 * 60 * 1000;
    return dateA - dateB;
  });
  
  return allMatches;
}

/**
 * Maçın bitmiş olup olmadığını kontrol et
 */
function isMatchExpired(match: FootballMatch): boolean {
  if (!match.endDate) return false;
  
  const endDate = new Date(match.endDate);
  const now = new Date();
  
  // EndDate geçtiyse ve 2 saatten fazla olmuşsa
  const hoursSinceEnd = (now.getTime() - endDate.getTime()) / (1000 * 60 * 60);
  return hoursSinceEnd > 2;
}

/**
 * Tamamlanan maçları arşivle
 */
function archiveCompletedMatches(matches: FootballMatch[], archivePath: string): FootballMatch[] {
  const completedMatches: FootballMatch[] = [];
  
  // Mevcut arşivi oku
  let archive: FootballMatch[] = [];
  if (fs.existsSync(archivePath)) {
    const archiveData = fs.readFileSync(archivePath, 'utf-8');
    archive = JSON.parse(archiveData);
  }
  
  // Tamamlanan maçları arşive ekle
  matches.forEach(match => {
    if (isMatchExpired(match)) {
      completedMatches.push(match);
      
      // Arşivde yoksa ekle
      const alreadyArchived = archive.some(m => m.slug === match.slug);
      if (!alreadyArchived) {
        archive.push(match);
      }
    }
  });
  
  // Arşivi kaydet (son 1000 maç)
  if (completedMatches.length > 0) {
    const limitedArchive = archive.slice(-1000);
    fs.writeFileSync(archivePath, JSON.stringify(limitedArchive, null, 2), 'utf-8');
  }
  
  return completedMatches;
}

/**
 * Polyfund match'i FootballMatch formatına çevir
 */
function convertToFootballMatch(polyfundMatch: PolyfundMatch): FootballMatch {
  // Title'dan takım isimlerini parse et
  let homeTeam = polyfundMatch.homeTeam;
  let awayTeam = polyfundMatch.awayTeam;
  
  if (!homeTeam || !awayTeam) {
    const title = polyfundMatch.question || polyfundMatch.title || '';
    const parts = title.split(' vs. ');
    if (parts.length === 2) {
      homeTeam = parts[0].trim();
      awayTeam = parts[1].trim();
    }
  }
  
  // Return raw object with id
  return {
    id: polyfundMatch.slug,
    slug: polyfundMatch.slug,
    title: polyfundMatch.question || polyfundMatch.title || 'Unknown Match',
    homeTeam: homeTeam || null,
    awayTeam: awayTeam || null,
    league: polyfundMatch.league || 'Unknown League',
    startDate: polyfundMatch.startDate || new Date().toISOString(),
    endDate: polyfundMatch.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    outcomes: polyfundMatch.outcomes || [],
    volume: polyfundMatch.volume || '0',
    liquidity: polyfundMatch.liquidity || '0',
    tags: polyfundMatch.tags || []
  } as any;
}

/**
 * SMART UPDATE - Mevcut maçları koruyarak güncelle
 */
export async function smartUpdateMatches(dataPath: string): Promise<{
  added: number;
  updated: number;
  removed: number;
  archived: number;
  total: number;
}> {
  console.log('\n🔄 SMART MATCH UPDATE - Başlatılıyor...\n');
  
  const archivePath = dataPath.replace('football-matches.json', 'completed-matches.json');
  
  // 1. Mevcut database'i oku
  let currentDb: MatchDatabase;
  if (fs.existsSync(dataPath)) {
    const fileContent = fs.readFileSync(dataPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    
    // Farklı JSON formatlarını handle et
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].matches) {
      currentDb = parsed[0];
    } else if (parsed.matches) {
      currentDb = parsed;
    } else {
      currentDb = {
        updatedAt: new Date().toISOString(),
        berlinTime: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
        totalMatches: 0,
        matches: []
      };
    }
  } else {
    currentDb = {
      updatedAt: new Date().toISOString(),
      berlinTime: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
      totalMatches: 0,
      matches: []
    };
  }
  
  console.log(`📊 Mevcut database: ${currentDb.matches.length} maç\n`);
  
  // 2. Polyfund'dan yeni maçları çek
  const polyfundMatches = await fetchAllActiveMatches();
  console.log(`\n📥 Polyfund'dan çekilen: ${polyfundMatches.length} maç\n`);
  
  // 3. Mevcut maçları Map'e çevir (slug -> match)
  const existingMatches = new Map<string, FootballMatch>();
  currentDb.matches.forEach(match => {
    existingMatches.set(match.slug, match);
  });
  
  // 4. Polyfund maçlarını Map'e çevir
  const polyfundMap = new Map<string, PolyfundMatch>();
  polyfundMatches.forEach(match => {
    polyfundMap.set(match.slug, match);
  });
  
  // 5. Güncelleme işlemleri
  const updatedMatches: FootballMatch[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let removedCount = 0;
  
  console.log('🔄 Maçlar işleniyor...\n');
  
  // 5a. Polyfund'daki her maç için
  for (const [slug, polyfundMatch] of polyfundMap) {
    const existing = existingMatches.get(slug);
    
    if (existing) {
      // MEVCUT MAÇ - Sadece temel bilgileri güncelle, ÖNEMLİ ALANLARI KORU
      const updated: FootballMatch = {
        ...convertToFootballMatch(polyfundMatch),
        
        // API-Football linkini KORU
        apiFootballId: existing.apiFootballId,
        homeScore: existing.homeScore,
        awayScore: existing.awayScore,
        currentMinute: existing.currentMinute,
        
        // Tracking state'i KORU
        isTracking: existing.isTracking,
        lastChecked: existing.lastChecked
      };
      
      updatedMatches.push(updated);
      updatedCount++;
      
    } else {
      // YENİ MAÇ - Ekle
      const newMatch = convertToFootballMatch(polyfundMatch);
      updatedMatches.push(newMatch);
      addedCount++;
      console.log(`   ➕ YENİ: ${newMatch.title}`);
    }
  }
  
  // 5b. Mevcut maçlardan Polyfund'da OLMAYANLARI kontrol et
  for (const [slug, existing] of existingMatches) {
    if (!polyfundMap.has(slug)) {
      // Polyfund'da yok - Eğer expired ise SİL, değilse KORU
      if (isMatchExpired(existing)) {
        removedCount++;
        console.log(`   🗑️  SİLİNDİ (bitti): ${existing.title}`);
      } else {
        // Henüz bitmemiş ama Polyfund'da yok - KORU (geçici olabilir)
        updatedMatches.push(existing);
        console.log(`   ⚠️  KORUNDU (Polyfund'da yok ama henüz bitmedi): ${existing.title}`);
      }
    }
  }
  
  // 5c. Tamamlanan maçları arşivle
  const completedMatches = archiveCompletedMatches(updatedMatches, archivePath);
  const archivedCount = completedMatches.length;
  
  // Arşivlenen maçları listeden çıkar
  const finalMatches = updatedMatches.filter(match => !isMatchExpired(match));
  
  // 6. EndDate'e göre sırala (yakın olanlar önce)
  finalMatches.sort((a, b) => {
    const dateA = a.endDate ? new Date(a.endDate).getTime() : Date.now() + 365 * 24 * 60 * 60 * 1000;
    const dateB = b.endDate ? new Date(b.endDate).getTime() : Date.now() + 365 * 24 * 60 * 60 * 1000;
    return dateA - dateB;
  });
  
  // 7. Yeni database'i kaydet
  const newDb: MatchDatabase = {
    updatedAt: new Date().toISOString(),
    berlinTime: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    totalMatches: finalMatches.length,
    matches: finalMatches
  };
  
  fs.writeFileSync(dataPath, JSON.stringify(newDb, null, 2), 'utf-8');
  
  // 8. Sonuçları raporla
  console.log('\n' + '='.repeat(60));
  console.log('✅ SMART UPDATE TAMAMLANDI');
  console.log('='.repeat(60));
  console.log(`➕ Yeni maç eklendi:     ${addedCount}`);
  console.log(`🔄 Mevcut güncellendi:   ${updatedCount}`);
  console.log(`🗑️  Bitmiş silindi:      ${removedCount}`);
  console.log(`📦 Arşivlendi:           ${archivedCount}`);
  console.log(`📊 Toplam aktif maç:     ${finalMatches.length}`);
  console.log('='.repeat(60) + '\n');
  
  return {
    added: addedCount,
    updated: updatedCount,
    removed: removedCount,
    archived: archivedCount,
    total: finalMatches.length
  };
}

// CLI'den çalıştırılırsa
if (require.main === module) {
  const dataPath = path.join(__dirname, '../../data/football-matches.json');
  smartUpdateMatches(dataPath)
    .then(result => {
      console.log('✅ İşlem tamamlandı');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Hata:', err.message);
      process.exit(1);
    });
}
