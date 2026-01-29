/**
 * Timezone utilities for Europe/Berlin
 * Current timezone: UTC+1 (CET) / UTC+2 (CEST in summer)
 */

export class TimezoneUtils {
  private static readonly BERLIN_TZ = 'Europe/Berlin';

  /**
   * Get current time in Berlin timezone
   */
  static getBerlinTime(): Date {
    return new Date(new Date().toLocaleString('en-US', { timeZone: this.BERLIN_TZ }));
  }

  /**
   * Format date for Berlin timezone
   */
  static formatBerlinTime(date: Date = new Date()): string {
    return date.toLocaleString('de-DE', { 
      timeZone: this.BERLIN_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  /**
   * Get Berlin timestamp for logging
   */
  static getBerlinTimestamp(): string {
    const now = new Date();
    return now.toLocaleString('de-DE', { 
      timeZone: this.BERLIN_TZ,
      hour12: false
    });
  }

  /**
   * Check if current time is within trading hours
   * Market active hours: 00:00 - 23:59 Berlin time
   * We avoid maintenance windows if needed
   */
  static isWithinTradingHours(): boolean {
    const berlinTime = this.getBerlinTime();
    const hour = berlinTime.getHours();
    
    // Trade 24/7 but avoid maintenance (3:00-3:15 AM Berlin time)
    if (hour === 3 && berlinTime.getMinutes() < 15) {
      return false;
    }
    
    return true;
  }

  /**
   * Check if it's prime trading hours (high liquidity)
   * 14:00 - 23:00 Berlin time (US market hours)
   */
  static isPrimeTradingHours(): boolean {
    const berlinTime = this.getBerlinTime();
    const hour = berlinTime.getHours();
    
    // US market hours (9:00 AM - 6:00 PM ET = 15:00 - 00:00 Berlin)
    return hour >= 14 && hour < 23;
  }

  /**
   * Get time until next scan (in milliseconds)
   */
  static getTimeUntilNextScan(intervalMinutes: number = 5): number {
    const now = new Date();
    const nextScan = new Date(now);
    nextScan.setMinutes(Math.ceil(now.getMinutes() / intervalMinutes) * intervalMinutes);
    nextScan.setSeconds(0);
    nextScan.setMilliseconds(0);
    
    return nextScan.getTime() - now.getTime();
  }

  /**
   * Log with Berlin timestamp
   */
  static log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
    const timestamp = this.getBerlinTimestamp();
    const emoji = level === 'INFO' ? '📊' : level === 'WARN' ? '⚠️' : '❌';
    console.log(`${emoji} [${timestamp}] ${message}`);
  }
}
