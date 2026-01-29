/**
 * MATCH MANAGER - Maç listesi yönetimi
 * Görevler:
 * 1. football-matches.json'dan maçları yükle
 * 2. Durum güncellemeleri (upcoming → soon → live → finished)
 * 3. Bitmiş maçları temizle (1 saat sonra)
 * 4. Çoklu maç koordinasyonu (20-50 maç)
 * Max 250 satır
 */

import * as fs from 'fs';
import * as path from 'path';
import { FootballMatch, MatchStatus, SystemState } from './types';

export class MatchManager {
  private matches: Map<string, FootballMatch> = new Map();
  private dataPath: string;
  private lastUpdate: Date = new Date();
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private pendingSave: boolean = false;

  constructor(dataPath?: string) {
    this.dataPath = dataPath || path.join(__dirname, '../../data/football-matches.json');
  }

  /**
   * Maçları JSON'dan yükle
   */
  async loadMatches(): Promise<FootballMatch[]> {
    try {
      if (!fs.existsSync(this.dataPath)) {
        console.warn('⚠️  football-matches.json bulunamadı!');
        return [];
      }

      const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      const matches: FootballMatch[] = data.matches || [];

      // Map'e yükle ve eski apiFootballId'leri koru
      matches.forEach(match => {
        const existingMatch = this.matches.get(match.id);
        
        // ⚡ ÖNEMLI: CANLI maçlarda skorları KORU!
        // JSON'dan gelen skorlar eski olabilir (cache lag)
        // LiveScoreTracker'dan gelen skorlar her zaman güncel
        const isLiveTracked = existingMatch && 
                             existingMatch.currentMinute !== undefined && 
                             existingMatch.currentMinute !== null && 
                             existingMatch.currentMinute > 0;
        
        const fullMatch = {
          ...match,
          // Eski apiFootballId'yi koru (API'den gelmez)
          apiFootballId: match.apiFootballId || existingMatch?.apiFootballId,
          
          // CANLI maçlarda memory'deki skorları koru, yoksa JSON'dan al
          homeScore: isLiveTracked ? existingMatch.homeScore : (match.homeScore ?? existingMatch?.homeScore),
          awayScore: isLiveTracked ? existingMatch.awayScore : (match.awayScore ?? existingMatch?.awayScore),
          currentMinute: isLiveTracked ? existingMatch.currentMinute : (match.currentMinute ?? existingMatch?.currentMinute),
          
          // Status: Canlı maçlarda mevcut status'ü koru (değişiklik varsa updateAllStatuses() halleder)
          status: isLiveTracked ? existingMatch.status : this.calculateStatus(match)
        };
        
        // minutesUntilKickoff'u hesapla
        fullMatch.minutesUntilKickoff = this.getMinutesUntilKickoff(fullMatch);
        
        this.matches.set(match.id, fullMatch);
      });

      this.lastUpdate = new Date();
      console.log(`✅ ${matches.length} maç yüklendi`);
      
      return Array.from(this.matches.values());
    } catch (error: any) {
      console.error('❌ Maç yükleme hatası:', error.message);
      return [];
    }
  }

  /**
   * Maç durumunu hesapla (Berlin saatine göre)
   */
  private calculateStatus(match: FootballMatch): MatchStatus {
    // ÖNEMLİ: Sadece apiFootballId OLAN maçları canlı score ile LIVE sayıyoruz
    // Bu sayede sadece gerçek futbol maçları tracking'e girer
    
    // ⚡ Maç 95+ dakikaya geldiyse FINISHED (uzatma dahil)
    if (match.currentMinute !== undefined && match.currentMinute !== null && match.currentMinute > 95) {
      return MatchStatus.FINISHED;
    }
    
    // apiFootballId varsa ve currentMinute > 0 ise LIVE
    if (match.apiFootballId && match.currentMinute !== undefined && match.currentMinute !== null && match.currentMinute > 0) {
      return MatchStatus.LIVE;
    }
    
    // Kickoff zamanı bul: önce kickoffUTC, yoksa endDate kullan
    const kickoffTime = match.kickoffUTC || match.endDate;
    
    // Ne kickoffUTC ne endDate yoksa → UPCOMING (tracking'e girmesin)
    if (!kickoffTime) {
      return MatchStatus.UPCOMING;
    }
    
    // Normal hesaplama
    const now = new Date();
    const kickoff = new Date(kickoffTime);
    const diffMs = kickoff.getTime() - now.getTime();
    const minutesUntilKickoff = Math.floor(diffMs / (1000 * 60));

    if (minutesUntilKickoff < -120) {
      // 2 saatten fazla geçti → Bitmiş
      return MatchStatus.FINISHED;
    } else if (minutesUntilKickoff < 0) {
      // Başlamış ama 2 saat geçmemiş → Canlı
      return MatchStatus.LIVE;
    } else if (minutesUntilKickoff < 30) {
      // 30 dk'dan az kaldı → Yakında
      return MatchStatus.SOON;
    } else {
      // Henüz erken → Yaklaşan
      return MatchStatus.UPCOMING;
    }
  }

  /**
   * Tüm maçların durumlarını güncelle
   * ⚡ Her 5 saniyede çalışır - minutesUntilKickoff sürekli güncellenir
   */
  updateAllStatuses(): void {
    let updated = 0;
    
    this.matches.forEach((match, id) => {
      const oldStatus = match.status;
      const newStatus = this.calculateStatus(match);
      
      // minutesUntilKickoff'u HER ZAMAN güncelle (countdown için)
      match.minutesUntilKickoff = this.getMinutesUntilKickoff(match);
      
      if (oldStatus !== newStatus) {
        match.status = newStatus;
        updated++;
        
        console.log(`🔄 ${match.slug}: ${oldStatus} → ${newStatus}`);
      }
    });

    if (updated > 0) {
      console.log(`✅ ${updated} maç durumu güncellendi`);
    }
  }

  /**
   * Maç başlama süresini hesapla
   */
  private getMinutesUntilKickoff(match: FootballMatch): number {
    const kickoffTime = match.kickoffUTC || match.endDate;
    if (!kickoffTime) return 999999; // Çok uzak gelecek
    
    const now = new Date();
    const kickoff = new Date(kickoffTime);
    return Math.floor((kickoff.getTime() - now.getTime()) / (1000 * 60));
  }

  /**
   * Belirli durumdaki maçları getir
   */
  getMatchesByStatus(status: MatchStatus): FootballMatch[] {
    return Array.from(this.matches.values())
      .filter(m => m.status === status)
      .sort((a, b) => {
        const timeA = new Date(a.kickoffUTC || a.endDate || 0).getTime();
        const timeB = new Date(b.kickoffUTC || b.endDate || 0).getTime();
        return timeA - timeB;
      });
  }

  /**
   * Aktif maçları getir (upcoming + soon + live)
   */
  getActiveMatches(): FootballMatch[] {
    return Array.from(this.matches.values())
      .filter(m => m.status !== MatchStatus.FINISHED)
      .sort((a, b) => new Date(a.kickoffUTC).getTime() - new Date(b.kickoffUTC).getTime());
  }

  /**
   * Canlı maçları getir
   */
  getLiveMatches(): FootballMatch[] {
    return this.getMatchesByStatus(MatchStatus.LIVE);
  }

  /**
   * Yakında başlayacak maçları getir (0-30 dk)
   */
  getSoonMatches(): FootballMatch[] {
    return this.getMatchesByStatus(MatchStatus.SOON);
  }

  /**
   * Bugünkü maçları getir
   */
  getTodayMatches(): FootballMatch[] {
    const today = new Date().toISOString().split('T')[0];
    return Array.from(this.matches.values())
      .filter(m => m.matchDate === today && m.status !== MatchStatus.FINISHED);
  }

  /**
   * Maç bilgisini güncelle (API'den gelen verilerle)
   * ⚡ JSON'a da yaz - Status raporları güncel kalır
   * 🔥 Debounced: Her saniye değil, 2 saniyede 1 yazılır
   */
  updateMatch(matchId: string, updates: Partial<FootballMatch>): void {
    const match = this.matches.get(matchId);
    if (match) {
      const oldMinute = match.currentMinute;
      Object.assign(match, updates);
      
      // 🔍 DEBUG: Dakika güncellendi mi?
      if (updates.currentMinute !== undefined && updates.currentMinute !== oldMinute) {
        console.log(`   ⏱️  ${match.slug}: ${oldMinute}' → ${updates.currentMinute}'`);
      }
      
      // Önemli: Status değişikliklerini yeniden hesapla
      if (updates.homeScore !== undefined || updates.awayScore !== undefined || updates.currentMinute !== undefined) {
        match.status = this.calculateStatus(match);
      }
      
      // Debounced save: 2 saniye içinde birden fazla update gelirse tek yazım yap
      this.scheduleSave();
    }
  }

  /**
   * Debounced save scheduler
   * ⚡ 2 saniye: Skor güncellemeleri hızlı yazılır ama disk yormaz
   */
  private scheduleSave(): void {
    this.pendingSave = true;
    
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(() => {
      if (this.pendingSave) {
        this.saveToCache();
        this.pendingSave = false;
      }
    }, 2000); // 2 saniye (eski: 5 saniye)
  }

  /**
   * Bitmiş maçları temizle (1 saat sonra)
   */
  cleanupFinished(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleaned = 0;

    this.matches.forEach((match, id) => {
      if (match.status === MatchStatus.FINISHED) {
        const kickoff = new Date(match.kickoffUTC);
        const matchEndEstimate = new Date(kickoff.getTime() + 130 * 60 * 1000); // +130 dk

        if (matchEndEstimate < oneHourAgo) {
          this.matches.delete(id);
          cleaned++;
          console.log(`🗑️  Temizlendi: ${match.slug}`);
        }
      }
    });

    if (cleaned > 0) {
      console.log(`✅ ${cleaned} bitmiş maç temizlendi`);
      this.saveToCache();
    }
  }

  /**
   * Güncellenmiş maç listesini kaydet
   */
  private saveToCache(): void {
    try {
      const data = {
        updatedAt: new Date().toISOString(),
        berlinTime: this.convertToBerlinTime(new Date()),
        totalMatches: this.matches.size,
        matches: Array.from(this.matches.values())
      };

      fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
      console.log(`💾 Cache güncellendi: ${this.matches.size} maç`);
    } catch (error: any) {
      console.error('❌ Cache kaydetme hatası:', error.message);
    }
  }

  /**
   * UTC'yi Berlin saatine çevir (UTC+1)
   */
  private convertToBerlinTime(date: Date): string {
    const berlin = new Date(date.getTime() + 60 * 60 * 1000);
    const year = berlin.getUTCFullYear();
    const month = String(berlin.getUTCMonth() + 1).padStart(2, '0');
    const day = String(berlin.getUTCDate()).padStart(2, '0');
    const hours = String(berlin.getUTCHours()).padStart(2, '0');
    const minutes = String(berlin.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * Maç al (ID ile)
   */
  getMatch(matchId: string): FootballMatch | undefined {
    return this.matches.get(matchId);
  }

  /**
   * Sistem durumu özeti
   */
  getSystemState(): SystemState {
    const all = Array.from(this.matches.values());
    const today = this.getTodayMatches();
    const upcoming = this.getMatchesByStatus(MatchStatus.UPCOMING);
    const soon = this.getSoonMatches();
    const active = this.getActiveMatches();
    const live = this.getLiveMatches();
    const finished = this.getMatchesByStatus(MatchStatus.FINISHED);

    return {
      allMatches: all,
      todayMatches: today,
      upcomingMatches: upcoming,
      soonMatches: soon,
      activeMatches: active,
      liveMatches: live,
      finishedMatches: finished,
      positions: [], // Trading module'den gelecek
      dailyPnL: 0,   // Trading module'den gelecek
      totalTrades: 0,
      lastUpdate: this.lastUpdate
    };
  }

  /**
   * İstatistik yazdır
   */
  printStatistics(): void {
    const upcoming = this.getMatchesByStatus(MatchStatus.UPCOMING).length;
    const soon = this.getMatchesByStatus(MatchStatus.SOON).length;
    const live = this.getMatchesByStatus(MatchStatus.LIVE).length;
    const finished = this.getMatchesByStatus(MatchStatus.FINISHED).length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 MAÇ İSTATİSTİKLERİ');
    console.log('='.repeat(60));
    console.log(`🟢 Yaklaşan (30+ dk):  ${upcoming} maç`);
    console.log(`🟡 Yakında (0-30 dk):  ${soon} maç`);
    console.log(`🔴 Canlı:              ${live} maç`);
    console.log(`⚫ Bitmiş:             ${finished} maç`);
    console.log(`📊 Toplam:             ${this.matches.size} maç`);
    console.log('='.repeat(60) + '\n');
  }
}
