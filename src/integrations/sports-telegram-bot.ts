/**
 * Sports Telegram Bot - Bot #4 Only
 * Real-time live sports match updates for instant trading
 */

export interface MatchScore {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  event?: 'GOAL' | 'RED_CARD' | 'HALFTIME' | 'FULLTIME';
}

export interface SportsTradingSignal {
  type: 'GOAL' | 'MATCH_START' | 'RED_CARD';
  match: MatchScore;
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  confidence: number;
  actions: TradingAction[];
  timestamp: Date;
}

export interface TradingAction {
  market: string;
  side: 'YES' | 'NO';
  priority: number;
  reason: string;
}

export class SportsTelegramBot {
  private activeMatches: Map<string, MatchScore> = new Map();
  
  constructor() {
    console.log('⚽ Sports Telegram Bot #4 initialized');
  }

  /**
   * Parse match score from message
   * Formats: "⚽ GOAL! Real Madrid 2-1 PSG (67')"
   */
  parseMatchScore(text: string): MatchScore | null {
    const clean = text.replace(/[⚽🔴⏱️🏁]/g, '').trim();

    // "GOAL! Team1 2-1 Team2 (67')"
    const pattern1 = /GOAL!?\s+(.+?)\s+(\d+)-(\d+)\s+(.+?)\s*\((\d+)'\)/i;
    const match1 = clean.match(pattern1);
    if (match1) {
      return {
        homeTeam: match1[1].trim(),
        awayTeam: match1[4].trim(),
        homeScore: parseInt(match1[2]),
        awayScore: parseInt(match1[3]),
        minute: parseInt(match1[5]),
        event: 'GOAL',
      };
    }

    // "Team1 vs Team2"
    const pattern2 = /(.+?)\s+(?:vs|v)\s+(.+)/i;
    const match2 = clean.match(pattern2);
    if (match2) {
      return {
        homeTeam: match2[1].trim(),
        awayTeam: match2[2].trim(),
        homeScore: 0,
        awayScore: 0,
        minute: 0,
      };
    }

    return null;
  }

  /**
   * Generate multi-position trading actions
   * Example: Real 1-0 PSG → BUY Real Win, BUY PSG Lose, BUY No Draw
   */
  generateActions(match: MatchScore): TradingAction[] {
    const actions: TradingAction[] = [];
    const scoreDiff = match.homeScore - match.awayScore;

    if (scoreDiff === 0) {
      // Tied game - wait or hedge
      return actions;
    }

    const winner = scoreDiff > 0 ? match.homeTeam : match.awayTeam;
    const loser = scoreDiff > 0 ? match.awayTeam : match.homeTeam;

    // Action 1: BUY winner to WIN
    actions.push({
      market: `${winner} to win`,
      side: 'YES',
      priority: 1,
      reason: `${winner} leading ${Math.abs(scoreDiff)}-0`,
    });

    // Action 2: BUY loser to LOSE (NO on their win)
    actions.push({
      market: `${loser} to win`,
      side: 'NO',
      priority: 2,
      reason: `${loser} losing`,
    });

    // Action 3: BUY NO DRAW
    actions.push({
      market: `Draw`,
      side: 'NO',
      priority: 3,
      reason: 'Score difference exists',
    });

    return actions;
  }

  /**
   * Process incoming sports message
   */
  processMessage(text: string, timestamp: Date): SportsTradingSignal | null {
    // Check freshness (< 30 sec)
    const age = Date.now() - timestamp.getTime();
    if (age > 30000) {
      console.log(`⏰ Message too old (${(age / 1000).toFixed(0)}s)`);
      return null;
    }

    const match = this.parseMatchScore(text);
    if (!match) {
      return null;
    }

    // Detect event type
    const lowerText = text.toLowerCase();
    let type: 'GOAL' | 'MATCH_START' | 'RED_CARD' = 'GOAL';
    if (lowerText.includes('red card') || lowerText.includes('🔴')) {
      type = 'RED_CARD';
    } else if (lowerText.includes('kick-off') || lowerText.includes('starts')) {
      type = 'MATCH_START';
    }

    // Generate actions
    const actions = this.generateActions(match);

    // Calculate urgency & confidence
    const urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' = type === 'GOAL' ? 'CRITICAL' : 'HIGH';
    const scoreDiff = Math.abs(match.homeScore - match.awayScore);
    let confidence = 70;
    if (scoreDiff >= 2) confidence = 90;
    else if (scoreDiff === 1 && match.minute >= 75) confidence = 85;

    console.log(`\n⚽ SIGNAL: ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`);
    console.log(`🎯 Type: ${type} | Minute: ${match.minute}'`);
    console.log(`📊 Actions: ${actions.length}`);

    // Cache match state
    const key = `${match.homeTeam}_${match.awayTeam}`;
    this.activeMatches.set(key, match);

    return {
      type,
      match,
      urgency,
      confidence,
      actions,
      timestamp,
    };
  }

  /**
   * Get previous match state
   */
  getPreviousState(homeTeam: string, awayTeam: string): MatchScore | null {
    const key = `${homeTeam}_${awayTeam}`;
    return this.activeMatches.get(key) || null;
  }

  /**
   * Clear match after it ends
   */
  clearMatch(homeTeam: string, awayTeam: string): void {
    const key = `${homeTeam}_${awayTeam}`;
    this.activeMatches.delete(key);
  }

  /**
   * Start listening (simulated for now)
   */
  async startListening(callback: (signal: SportsTradingSignal) => void): Promise<void> {
    console.log('👂 Telegram listener started (simulated)');
    
    // Simulate periodic messages
    setInterval(() => {
      // Simulate a goal event
      const mockSignal: SportsTradingSignal = {
        type: 'GOAL',
        match: {
          homeTeam: 'Real Madrid',
          awayTeam: 'Barcelona',
          homeScore: 1,
          awayScore: 0,
          minute: 23,
          event: 'GOAL',
        },
        urgency: 'CRITICAL',
        confidence: 85,
        actions: this.generateActions({
          homeTeam: 'Real Madrid',
          awayTeam: 'Barcelona',
          homeScore: 1,
          awayScore: 0,
          minute: 23,
        }),
        timestamp: new Date(),
      };
      
      // Only trigger occasionally
      if (Math.random() > 0.95) {
        callback(mockSignal);
      }
    }, 60 * 1000); // Check every minute
  }
}
