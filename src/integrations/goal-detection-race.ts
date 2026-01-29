import 'dotenv/config';
import { LiveScore6Client } from './livescore6-client';
import { SofaSportClient } from './sofasport-api';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🎯 GOAL DETECTION TRACKER - LIVESCORE6 PRIMARY
 * 
 * LiveScore6 ile gerçek zamanlı gol takibi
 * SofaSport ile doğrulama
 * 
 * Kullanım:
 * const tracker = new GoalDetectionRaceTracker();
 * await tracker.startMonitoring(15); // Her 15 saniyede kontrol
 */

interface APIScoreSnapshot {
  api: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number | string | null;
  timestamp: Date;
  responseTime: number;
}

interface GoalDetectionLog {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  oldScore: string;
  newScore: string;
  minute: number | string | null;
  detectedBy: string;
  detectedAt: Date;
  verifiedBy: string[];
}

export class GoalDetectionRaceTracker {
  private livescore6: LiveScore6Client;
  private sofasport: SofaSportClient;
  
  private lastKnownScores: Map<string, { home: number; away: number }> = new Map();
  private goalLogs: GoalDetectionLog[] = [];
  private logFilePath: string;
  
  private apiStats = {
    livescore6: { firstDetections: 0, totalChecks: 0, avgResponseTime: 0 },
    sofasport: { firstDetections: 0, totalChecks: 0, avgResponseTime: 0 }
  };
  
  constructor() {
    this.livescore6 = new LiveScore6Client();
    this.sofasport = new SofaSportClient();
    
    const logsDir = path.join(process.cwd(), 'logs', 'goal-detection');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const date = new Date().toISOString().split('T')[0];
    this.logFilePath = path.join(logsDir, `goal_race_${date}.jsonl`);
  }

  /**
   * ⚡ PRIMARY: LiveScore6'dan canlı maçları al
   */
  async checkLiveScore6(): Promise<APIScoreSnapshot[]> {
    const start = Date.now();
    
    try {
      const matches = await this.livescore6.getLiveMatches();
      const responseTime = Date.now() - start;
      
      this.apiStats.livescore6.totalChecks++;
      this.apiStats.livescore6.avgResponseTime = 
        (this.apiStats.livescore6.avgResponseTime + responseTime) / 2;
      
      return matches.map(m => ({
        api: 'LiveScore6',
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        minute: m.minute,
        timestamp: new Date(),
        responseTime
      }));
    } catch (error) {
      console.error('❌ LiveScore6 check failed:', error);
      return [];
    }
  }

  /**
   * 🔄 BACKUP: SofaSport'tan canlı maçları al
   */
  async checkSofaSport(): Promise<APIScoreSnapshot[]> {
    const start = Date.now();
    
    try {
      const matches = await this.sofasport.getAllLiveFootballMatches();
      const responseTime = Date.now() - start;
      
      this.apiStats.sofasport.totalChecks++;
      this.apiStats.sofasport.avgResponseTime = 
        (this.apiStats.sofasport.avgResponseTime + responseTime) / 2;
      
      return matches.map(m => ({
        api: 'SofaSport',
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        minute: m.minute,
        timestamp: new Date(),
        responseTime
      }));
    } catch (error) {
      console.error('❌ SofaSport check failed:', error);
      return [];
    }
  }

  /**
   * 🎯 Ana izleme döngüsü
   */
  async startMonitoring(intervalSeconds: number = 15): Promise<void> {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 GOAL DETECTION - LIVESCORE6 PRIMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`⚡ Check interval: ${intervalSeconds} seconds`);
    console.log(`📡 Primary API: LiveScore6`);
    console.log(`🔄 Backup API: SofaSport\n`);
    
    let checkCount = 0;
    
    while (true) {
      checkCount++;
      const timestamp = new Date().toLocaleTimeString('tr-TR');
      
      console.log(`\n🔍 CHECK #${checkCount} [${timestamp}]`);
      console.log('━'.repeat(80));
      
      const livescoreMatches = await this.checkLiveScore6();
      
      if (livescoreMatches.length === 0) {
        console.log('⚠️  No live matches found\n');
        await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        continue;
      }
      
      console.log(`\n📊 Found ${livescoreMatches.length} live matches\n`);
      
      for (const match of livescoreMatches) {
        const matchKey = `${match.homeTeam}-${match.awayTeam}`;
        const lastScore = this.lastKnownScores.get(matchKey);
        
        if (!lastScore) {
          this.lastKnownScores.set(matchKey, { 
            home: match.homeScore, 
            away: match.awayScore 
          });
          
          console.log(`📝 ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam} (${match.minute || 'N/A'})`);
          continue;
        }
        
        if (lastScore.home !== match.homeScore || lastScore.away !== match.awayScore) {
          await this.handleGoalDetected(match, lastScore);
          
          this.lastKnownScores.set(matchKey, { 
            home: match.homeScore, 
            away: match.awayScore 
          });
        } else {
          console.log(`✓ ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam} (${match.minute || 'N/A'})`);
        }
      }
      
      console.log(`\n⏳ Next check in ${intervalSeconds} seconds...`);
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    }
  }

  /**
   * 🚨 Gol tespit edildiğinde çağrılır
   */
  private async handleGoalDetected(
    match: APIScoreSnapshot,
    lastScore: { home: number; away: number }
  ): Promise<void> {
    const oldScore = `${lastScore.home}-${lastScore.away}`;
    const newScore = `${match.homeScore}-${match.awayScore}`;
    
    console.log('\n🚨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⚽ GOAL! ${match.homeTeam} vs ${match.awayTeam}`);
    console.log(`   ${oldScore} → ${newScore} (${match.minute || 'N/A'}')`);
    console.log('🚨━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // SofaSport ile doğrula
    const sofasportMatches = await this.checkSofaSport();
    const sofasportMatch = sofasportMatches.find(m => 
      this.normalizeTeamName(m.homeTeam) === this.normalizeTeamName(match.homeTeam)
    );
    
    const verifiedBy: string[] = [];
    
    if (sofasportMatch) {
      const verified = 
        sofasportMatch.homeScore === match.homeScore && 
        sofasportMatch.awayScore === match.awayScore;
      
      if (verified) {
        console.log(`✅ SofaSport doğruladı: ${sofasportMatch.homeScore}-${sofasportMatch.awayScore}`);
        verifiedBy.push('SofaSport');
      } else {
        console.log(`⚠️  SofaSport farklı: ${sofasportMatch.homeScore}-${sofasportMatch.awayScore}`);
      }
    }
    
    // Log kaydet
    const goalLog: GoalDetectionLog = {
      matchId: `${match.homeTeam}-${match.awayTeam}`,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      oldScore,
      newScore,
      minute: match.minute,
      detectedBy: 'LiveScore6',
      detectedAt: new Date(),
      verifiedBy
    };
    
    this.goalLogs.push(goalLog);
    fs.appendFileSync(this.logFilePath, JSON.stringify(goalLog) + '\n');
    
    this.apiStats.livescore6.firstDetections++;
    
    console.log(`\n📊 Total goals detected: ${this.goalLogs.length}`);
    console.log(`   LiveScore6: ${this.apiStats.livescore6.firstDetections} first detections\n`);
  }

  /**
   * Takım ismi normalize et
   */
  private normalizeTeamName(name: string): string {
    return name.toLowerCase()
      .replace(/\b(fc|sc|cf|ac|ca|rb|red bull|sport club|club|athletic|clube|ec|fr|cr)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * İstatistikleri göster
   */
  printStats(): void {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 GOAL DETECTION STATS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    console.log(`LiveScore6:`);
    console.log(`  First detections: ${this.apiStats.livescore6.firstDetections}`);
    console.log(`  Total checks: ${this.apiStats.livescore6.totalChecks}`);
    console.log(`  Avg response: ${Math.round(this.apiStats.livescore6.avgResponseTime)}ms\n`);
    
    console.log(`SofaSport:`);
    console.log(`  Verifications: ${this.apiStats.sofasport.totalChecks}`);
    console.log(`  Avg response: ${Math.round(this.apiStats.sofasport.avgResponseTime)}ms\n`);
    
    console.log(`Total goals: ${this.goalLogs.length}\n`);
  }
}

export default GoalDetectionRaceTracker;
