/**
 * TRADE LOGGER - Her trade'i detaylı logla
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TradeLog {
  timestamp: string;
  matchId: string;
  matchSlug: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  market: string;
  outcome: string;
  price: number;
  amount: number;
  shares?: number;
  reason: string;
  score: string;
  minute: number;
  matchStatus?: string;
  pnl?: number;
  pnlPercent?: number;
  success: boolean;
  error?: string;
}

export class TradeLogger {
  private logPath: string;

  constructor() {
    const logsDir = path.join(__dirname, '../../logs/trades');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const today = new Date().toISOString().split('T')[0];
    this.logPath = path.join(logsDir, `trades_${today}.jsonl`);
  }

  /**
   * Trade log'u kaydet
   */
  log(tradeLog: TradeLog): void {
    try {
      const logLine = JSON.stringify(tradeLog) + '\n';
      fs.appendFileSync(this.logPath, logLine);
      
      // Console'a da bas (özet)
      const emoji = tradeLog.action === 'BUY' ? '📈' : tradeLog.action === 'SELL' ? '📉' : '⏸️';
      const status = tradeLog.success ? '✅' : '❌';
      console.log(`${status} ${emoji} ${tradeLog.action} ${tradeLog.outcome} @ ${tradeLog.price}¢ | ${tradeLog.reason}`);
      
      if (tradeLog.pnl !== undefined) {
        const pnlSign = tradeLog.pnl >= 0 ? '+' : '';
        console.log(`   💰 PnL: ${pnlSign}$${tradeLog.pnl.toFixed(2)} (${pnlSign}${tradeLog.pnlPercent?.toFixed(1)}%)`);
      }
    } catch (error: any) {
      console.error('❌ Trade log yazma hatası:', error.message);
    }
  }

  /**
   * Bugünkü trade log'larını oku
   */
  readToday(): TradeLog[] {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }
      
      const content = fs.readFileSync(this.logPath, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error: any) {
      console.error('❌ Trade log okuma hatası:', error.message);
      return [];
    }
  }

  /**
   * İstatistikler
   */
  getStats(): {
    totalTrades: number;
    buys: number;
    sells: number;
    successRate: number;
    totalPnL: number;
  } {
    const logs = this.readToday();
    const successful = logs.filter(l => l.success);
    const sells = logs.filter(l => l.action === 'SELL');
    const totalPnL = sells.reduce((sum, l) => sum + (l.pnl || 0), 0);
    
    return {
      totalTrades: logs.length,
      buys: logs.filter(l => l.action === 'BUY').length,
      sells: sells.length,
      successRate: logs.length > 0 ? (successful.length / logs.length) * 100 : 0,
      totalPnL
    };
  }
}
