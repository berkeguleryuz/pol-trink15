/**
 * Telegram Notification System
 * 3 farklı bot ile bildirim sistemi
 */

import TelegramBot from 'node-telegram-bot-api';
import { MarketRegistry, RegisteredMarket } from '../database/market-registry';

export interface TradeNotification {
  type: 'BUY' | 'SELL' | 'SCALE_OUT';
  market: string;
  amount: number;
  price: number;
  target?: number;
  profit?: number;
  profitPercent?: number;
}

export class TelegramNotifier {
  private newMarketsBot?: TelegramBot;
  private tradesBot?: TelegramBot;
  private trackedBot?: TelegramBot;

  private newMarketsChatId?: string;
  private tradesChatId?: string;
  private trackedChatId?: string;

  private registry: MarketRegistry;

  constructor() {
    this.registry = new MarketRegistry();
    this.initializeBots();
  }

  /**
   * Bot'ları başlat
   */
  private initializeBots(): void {
    // Bot 1: Yeni Marketler
    if (process.env.TELEGRAM_NEW_MARKETS_BOT_TOKEN) {
      this.newMarketsBot = new TelegramBot(
        process.env.TELEGRAM_NEW_MARKETS_BOT_TOKEN,
        { polling: true }
      );
      this.newMarketsChatId = process.env.TELEGRAM_NEW_MARKETS_CHAT_ID;
      this.setupNewMarketsCommands();
      console.log('✅ New Markets Bot initialized');
    }

    // Bot 2: İşlemler
    if (process.env.TELEGRAM_TRADES_BOT_TOKEN) {
      this.tradesBot = new TelegramBot(process.env.TELEGRAM_TRADES_BOT_TOKEN, {
        polling: true,
      });
      this.tradesChatId = process.env.TELEGRAM_TRADES_CHAT_ID;
      this.setupTradesCommands();
      console.log('✅ Trades Bot initialized');
    }

    // Bot 3: Takip
    if (process.env.TELEGRAM_TRACKED_BOT_TOKEN) {
      this.trackedBot = new TelegramBot(process.env.TELEGRAM_TRACKED_BOT_TOKEN, {
        polling: true,
      });
      this.trackedChatId = process.env.TELEGRAM_TRACKED_CHAT_ID;
      this.setupTrackedCommands();
      console.log('✅ Tracked Markets Bot initialized');
    }
  }

  /**
   * YENİ MARKETLER BOT KOMUTLARI
   */
  private setupNewMarketsCommands(): void {
    if (!this.newMarketsBot) return;

    // /stats - Genel istatistikler
    this.newMarketsBot.onText(/\/stats/, (msg: TelegramBot.Message) => {
      const stats = this.registry.getStats();
      const message =
        `📊 *Market İstatistikleri*\n\n` +
        `Toplam: ${stats.total}\n` +
        `Aktif: ${stats.active}\n` +
        `Takip: ${stats.tracked}\n` +
        `Takipsiz: ${stats.untracked}\n` +
        `Kapanmış: ${stats.closed}`;

      this.newMarketsBot?.sendMessage(msg.chat.id, message, {
        parse_mode: 'Markdown',
      });
    });

    // /new24h - Son 24 saatte ekleneler
    this.newMarketsBot.onText(/\/new24h/, (msg: TelegramBot.Message) => {
      const newMarkets = this.registry.getNewMarkets(24);
      if (newMarkets.length === 0) {
        this.newMarketsBot?.sendMessage(
          msg.chat.id,
          '📭 Son 24 saatte yeni market eklenmedi'
        );
        return;
      }

      const message = newMarkets
        .slice(0, 10)
        .map(
          (m, i) =>
            `${i + 1}. ${m.question}\n` +
            `   Vol: $${(m.volume24hr / 1000).toFixed(1)}K`
        )
        .join('\n\n');

      this.newMarketsBot?.sendMessage(
        msg.chat.id,
        `🆕 *Yeni Marketler (${newMarkets.length})*\n\n${message}`,
        { parse_mode: 'Markdown' }
      );
    });

    // /categories - Kategoriler
    this.newMarketsBot.onText(/\/categories/, (msg: TelegramBot.Message) => {
      const stats = this.registry.getStats();
      const message = Object.entries(stats.categories)
        .map(([cat, count]) => `${cat}: ${count}`)
        .join('\n');

      this.newMarketsBot?.sendMessage(
        msg.chat.id,
        `📁 *Kategoriler*\n\n${message}`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  /**
   * İŞLEMLER BOT KOMUTLARI
   */
  private setupTradesCommands(): void {
    if (!this.tradesBot) return;

    this.tradesBot.onText(/\/start/, (msg: TelegramBot.Message) => {
      this.tradesBot?.sendMessage(
        msg.chat.id,
        '💰 *Polybuy Trades Bot*\n\n' +
          'Tüm alım satım işlemlerini bildiririm.\n\n' +
          'Komutlar:\n' +
          '/balance - Bakiye\n' +
          '/positions - Açık pozisyonlar\n' +
          '/history - Son işlemler\n' +
          '/pnl - Kar/Zarar',
        { parse_mode: 'Markdown' }
      );
    });

    // /balance - Wallet bakiyesi
    this.tradesBot.onText(/\/balance/, async (msg: TelegramBot.Message) => {
      try {
        // Polymarket client lazım - şimdilik mock data
        const message =
          '💰 *Bakiye Bilgileri*\n\n' +
          `USDC: $${process.env.FUNDER_ADDRESS ? '19.96' : '0.00'}\n` +
          `Wallet: ${process.env.FUNDER_ADDRESS || 'Ayarlanmadı'}\n\n` +
          '💡 Gerçek bakiye için bot trade sistemiyle entegre edilmeli';

        this.tradesBot?.sendMessage(msg.chat.id, message, {
          parse_mode: 'Markdown',
        });
      } catch (error) {
        this.tradesBot?.sendMessage(
          msg.chat.id,
          '❌ Bakiye alınırken hata oluştu'
        );
      }
    });

    // /positions - Açık pozisyonlar
    this.tradesBot.onText(/\/positions/, async (msg: TelegramBot.Message) => {
      try {
        // Tracked markets üzerinden pozisyon simülasyonu
        const tracked = this.registry.getTrackedMarkets();
        
        if (tracked.length === 0) {
          this.tradesBot?.sendMessage(
            msg.chat.id,
            '📭 Açık pozisyon yok\n\n💡 Market takip etmek için /tracked bot\'unu kullan'
          );
          return;
        }

        const positions = tracked.slice(0, 5).map((m, i) => {
          const currentPrice = m.tokens[0].currentPrice || 0;
          const entryPrice = m.entryPrice || currentPrice;
          const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
          const emoji = pnl > 0 ? '🟢' : pnl < 0 ? '🔴' : '⚪';

          return (
            `${emoji} *Position ${i + 1}*\n` +
            `${m.question.slice(0, 50)}...\n` +
            `Entry: ${(entryPrice * 100).toFixed(1)}% → Now: ${(currentPrice * 100).toFixed(1)}%\n` +
            `PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`
          );
        });

        const message =
          `📊 *Açık Pozisyonlar (${tracked.length})*\n\n` +
          positions.join('\n\n');

        this.tradesBot?.sendMessage(msg.chat.id, message, {
          parse_mode: 'Markdown',
        });
      } catch (error) {
        this.tradesBot?.sendMessage(
          msg.chat.id,
          '❌ Pozisyonlar alınırken hata oluştu'
        );
      }
    });

    // /history - Son işlemler
    this.tradesBot.onText(/\/history/, (msg: TelegramBot.Message) => {
      const message =
        '📜 *Son İşlemler*\n\n' +
        '💡 Henüz trade yapılmadı\n\n' +
        'Live trading başladığında işlem geçmişi burada görünecek';

      this.tradesBot?.sendMessage(msg.chat.id, message, {
        parse_mode: 'Markdown',
      });
    });

    // /pnl - Kar/Zarar
    this.tradesBot.onText(/\/pnl/, async (msg: TelegramBot.Message) => {
      try {
        const tracked = this.registry.getTrackedMarkets();
        
        if (tracked.length === 0) {
          this.tradesBot?.sendMessage(
            msg.chat.id,
            '📊 *Kar/Zarar*\n\nHenüz pozisyon yok'
          );
          return;
        }

        // Toplam PnL hesapla
        let totalPnl = 0;
        let winners = 0;
        let losers = 0;

        tracked.forEach(m => {
          const currentPrice = m.tokens[0].currentPrice || 0;
          const entryPrice = m.entryPrice || currentPrice;
          const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
          
          totalPnl += pnl;
          if (pnl > 0) winners++;
          if (pnl < 0) losers++;
        });

        const avgPnl = totalPnl / tracked.length;
        const emoji = avgPnl > 0 ? '📈' : avgPnl < 0 ? '📉' : '➡️';

        const message =
          `${emoji} *Kar/Zarar Özeti*\n\n` +
          `Toplam Pozisyon: ${tracked.length}\n` +
          `Kazanan: ${winners} 🟢\n` +
          `Kaybeden: ${losers} 🔴\n\n` +
          `Ortalama PnL: ${avgPnl > 0 ? '+' : ''}${avgPnl.toFixed(2)}%\n` +
          `Toplam PnL: ${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}%\n\n` +
          `💡 Gerçek USD hesabı için trading entegrasyonu gerekli`;

        this.tradesBot?.sendMessage(msg.chat.id, message, {
          parse_mode: 'Markdown',
        });
      } catch (error) {
        this.tradesBot?.sendMessage(
          msg.chat.id,
          '❌ PnL hesaplanırken hata oluştu'
        );
      }
    });
  }

  /**
   * TAKİP BOT KOMUTLARI
   */
  private setupTrackedCommands(): void {
    if (!this.trackedBot) return;

    this.trackedBot.onText(/\/start/, (msg: TelegramBot.Message) => {
      this.trackedBot?.sendMessage(
        msg.chat.id,
        '📊 *Polybuy Tracked Markets Bot*\n\n' +
          'Takip edilen marketleri izlerim.\n\n' +
          'Komutlar:\n' +
          '/tracked - Takip edilenler\n' +
          '/untracked - Takip edilmeyenler\n' +
          '/alerts - Uyarılar',
        { parse_mode: 'Markdown' }
      );
    });

    this.trackedBot.onText(/\/tracked/, (msg: TelegramBot.Message) => {
      const tracked = this.registry.getTrackedMarkets();
      if (tracked.length === 0) {
        this.trackedBot?.sendMessage(msg.chat.id, '📭 Takip edilen market yok');
        return;
      }

      const message = tracked
        .slice(0, 10)
        .map((m, i) => {
          const currentPrice = m.tokens[0].currentPrice || 0;
          const priceChange = m.entryPrice
            ? ((currentPrice - m.entryPrice) / m.entryPrice) * 100
            : 0;
          const emoji = priceChange > 0 ? '📈' : priceChange < 0 ? '📉' : '➡️';

          return (
            `${i + 1}. ${emoji} ${m.question}\n` +
            `   Entry: ${((m.entryPrice || 0) * 100).toFixed(1)}% → Now: ${(currentPrice * 100).toFixed(1)}%\n` +
            `   Change: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(1)}%\n` +
            `   Target: +${m.targetProfit}%`
          );
        })
        .join('\n\n');

      this.trackedBot?.sendMessage(
        msg.chat.id,
        `📊 *Takip Edilen Marketler (${tracked.length})*\n\n${message}`,
        { parse_mode: 'Markdown' }
      );
    });

    this.trackedBot.onText(/\/untracked/, (msg: TelegramBot.Message) => {
      const untracked = this.registry.getUntrackedMarkets();
      const message = untracked
        .slice(0, 10)
        .map(
          (m, i) =>
            `${i + 1}. ${m.question}\n` +
            `   Vol: $${(m.volume24hr / 1000).toFixed(1)}K`
        )
        .join('\n\n');

      this.trackedBot?.sendMessage(
        msg.chat.id,
        `📋 *Takip Edilmeyen Marketler (${untracked.length})*\n\n${message}`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  /**
   * NOTIFICATION METHODS
   */

  /**
   * Yeni market bildirimi
   */
  async notifyNewMarket(market: RegisteredMarket): Promise<void> {
    if (!this.newMarketsBot || !this.newMarketsChatId) return;

    const message =
      `🆕 *Yeni Market Keşfedildi*\n\n` +
      `${market.question}\n\n` +
      `Volume: $${(market.volume24hr / 1000).toFixed(1)}K\n` +
      `YES Price: ${(market.tokens[0].currentPrice! * 100).toFixed(1)}%\n` +
      `NO Price: ${(market.tokens[1].currentPrice! * 100).toFixed(1)}%`;

    await this.newMarketsBot.sendMessage(this.newMarketsChatId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Trade bildirimi
   */
  async notifyTrade(trade: TradeNotification): Promise<void> {
    if (!this.tradesBot || !this.tradesChatId) return;

    let emoji = '';
    let action = '';

    switch (trade.type) {
      case 'BUY':
        emoji = '🟢';
        action = 'SATIN ALMA';
        break;
      case 'SELL':
        emoji = '🔴';
        action = 'SATIŞ';
        break;
      case 'SCALE_OUT':
        emoji = '📤';
        action = 'KISMİ SATIŞ';
        break;
    }

    let message =
      `${emoji} *${action}*\n\n` +
      `Market: ${trade.market}\n` +
      `Fiyat: ${(trade.price * 100).toFixed(1)}%\n` +
      `Miktar: ${trade.amount} USDC`;

    if (trade.profit !== undefined && trade.profitPercent !== undefined) {
      const profitEmoji = trade.profit > 0 ? '💰' : '❌';
      message +=
        `\n\n${profitEmoji} Kar: ${trade.profit > 0 ? '+' : ''}${trade.profit.toFixed(2)} USDC (${trade.profitPercent > 0 ? '+' : ''}${trade.profitPercent.toFixed(1)}%)`;
    }

    if (trade.target) {
      message += `\n🎯 Hedef: ${(trade.target * 100).toFixed(1)}%`;
    }

    await this.tradesBot.sendMessage(this.tradesChatId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Takip başlangıç/bitiş bildirimi
   */
  async notifyTracking(
    market: RegisteredMarket,
    started: boolean
  ): Promise<void> {
    if (!this.trackedBot || !this.trackedChatId) return;

    const emoji = started ? '📌' : '📍';
    const action = started ? 'TAKİBE ALINDI' : 'TAKİPTEN ÇIKARILDI';

    let message =
      `${emoji} *${action}*\n\n` +
      `${market.question}\n\n` +
      `Volume: $${(market.volume24hr / 1000).toFixed(1)}K`;

    if (started && market.trackingReason) {
      message += `\n\nNeden: ${market.trackingReason}`;
      if (market.targetProfit) {
        message += `\nHedef Kar: +${market.targetProfit}%`;
      }
    }

    await this.trackedBot.sendMessage(this.trackedChatId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Fiyat değişikliği bildirimi
   */
  async notifyPriceChange(
    market: RegisteredMarket,
    oldPrice: number,
    newPrice: number
  ): Promise<void> {
    if (!this.trackedBot || !this.trackedChatId) return;

    const change = ((newPrice - oldPrice) / oldPrice) * 100;
    const emoji = change > 0 ? '📈' : '📉';

    const message =
      `${emoji} *Fiyat Değişimi*\n\n` +
      `${market.question}\n\n` +
      `Eski: ${(oldPrice * 100).toFixed(1)}%\n` +
      `Yeni: ${(newPrice * 100).toFixed(1)}%\n` +
      `Değişim: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`;

    await this.trackedBot.sendMessage(this.trackedChatId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Hedefe ulaşma bildirimi
   */
  async notifyTargetReached(
    market: RegisteredMarket,
    currentPrice: number
  ): Promise<void> {
    if (!this.trackedBot || !this.trackedChatId) return;

    const profit = market.entryPrice
      ? ((currentPrice - market.entryPrice) / market.entryPrice) * 100
      : 0;

    const message =
      `🎯 *HEDEF ULAŞILDI*\n\n` +
      `${market.question}\n\n` +
      `Giriş: ${((market.entryPrice || 0) * 100).toFixed(1)}%\n` +
      `Şu an: ${(currentPrice * 100).toFixed(1)}%\n` +
      `Kar: +${profit.toFixed(1)}%\n` +
      `Hedef: +${market.targetProfit}%\n\n` +
      `✅ Satış zamanı!`;

    await this.trackedBot.sendMessage(this.trackedChatId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Bot'ları durdur
   */
  stop(): void {
    this.newMarketsBot?.stopPolling();
    this.tradesBot?.stopPolling();
    this.trackedBot?.stopPolling();
    console.log('🛑 All Telegram bots stopped');
  }
}
