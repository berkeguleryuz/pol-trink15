/**
 * Perplexity AI Integration
 * Fetches real-time news and insights for trading decisions
 */

import { config } from '../config';
import { TimezoneUtils } from '../utils/timezone';

export interface PerplexitySearchResult {
  answer: string;
  sources: string[];
  timestamp: string;
  relevance: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface NewsEvent {
  topic: string;
  summary: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  relevantMarkets: string[];
  timestamp: string;
  sources: string[];
}

export class PerplexityAI {
  private apiKey: string;
  private baseUrl = 'https://api.perplexity.ai';

  constructor() {
    if (!config.perplexityApiKey) {
      throw new Error('PERPLEXITY_API_KEY not found in .env file');
    }
    this.apiKey = config.perplexityApiKey;
  }

  /**
   * Search Perplexity for real-time information
   */
  async search(query: string): Promise<PerplexitySearchResult> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar', // Cheapest online model ($1/1M input + $1/1M output tokens)
          messages: [
            {
              role: 'system',
              content: 'You are a financial news analyst. Provide concise, factual summaries of current events with focus on prediction market implications. Include sentiment and impact assessment.',
            },
            {
              role: 'user',
              content: query,
            },
          ],
          max_tokens: 300, // Reduced to save tokens
          temperature: 0.2,
          top_p: 0.9,
          return_citations: true,
          return_images: false,
          return_related_questions: false,
          search_recency_filter: 'day', // Last 24 hours
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Perplexity API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
      }

      const data: any = await response.json();
      const answer = data.choices?.[0]?.message?.content || '';
      const citations = data.citations || [];

      return {
        answer,
        sources: citations,
        timestamp: TimezoneUtils.getBerlinTimestamp(),
        relevance: this.assessRelevance(answer),
      };

    } catch (error: any) {
      TimezoneUtils.log(`Perplexity search failed: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  /**
   * Fetch finance news
   */
  async getFinanceNews(): Promise<NewsEvent[]> {
    const query = `Top 3 breaking financial market news cryptocurrency stock interest rates November 2025. Include: company name, event type, market sentiment positive negative neutral, impact high medium low. Format: numbered list.`;

    const result = await this.search(query);
    return this.parseNewsEvents(result);
  }

  /**
   * Fetch earnings news
   */
  async getEarningsNews(): Promise<NewsEvent[]> {
    const query = `Latest company earnings reports Q4 2025 beat miss expectations guidance stock market reaction. List 3 major companies with results.`;

    const result = await this.search(query);
    return this.parseNewsEvents(result);
  }

  /**
   * Fetch political news
   */
  async getPoliticalNews(): Promise<NewsEvent[]> {
    const query = `Top political developments November 2025 US elections policy decisions geopolitical impact prediction markets. List 3 events with market implications.`;

    const result = await this.search(query);
    return this.parseNewsEvents(result);
  }

  /**
   * Fetch tech news
   */
  async getTechNews(): Promise<NewsEvent[]> {
    const query = `Latest technology industry news AI artificial intelligence product launches regulation crypto November 2025. List 3 major developments.`;

    const result = await this.search(query);
    return this.parseNewsEvents(result);
  }

  /**
   * Fetch sports news (for sports betting bot)
   */
  async getSportsNews(sport: string = 'all'): Promise<NewsEvent[]> {
    const query = `${sport === 'all' ? 'Major sports' : sport} news today injuries lineup changes team form betting odds movements. Last 6 hours updates.`;

    const result = await this.search(query);
    return this.parseNewsEvents(result);
  }

  /**
   * Search for specific market-related information
   */
  async searchMarket(marketQuestion: string): Promise<PerplexitySearchResult> {
    const query = `Prediction market analysis: "${marketQuestion}". Current status, probability estimate, key factors, news sentiment positive negative. Concise 150 words.`;

    return await this.search(query);
  }

  /**
   * Parse news events from Perplexity response
   */
  private parseNewsEvents(result: PerplexitySearchResult): NewsEvent[] {
    const events: NewsEvent[] = [];
    
    // Simple parsing - can be enhanced with better NLP
    const lines = result.answer.split('\n').filter(l => l.trim());
    
    let currentEvent: Partial<NewsEvent> | null = null;
    
    for (const line of lines) {
      // Check for numbered items (1. 2. 3.)
      if (/^\d+\./.test(line)) {
        if (currentEvent && currentEvent.topic) {
          events.push(this.completeNewsEvent(currentEvent));
        }
        currentEvent = {
          topic: line.replace(/^\d+\.\s*/, '').trim(),
          timestamp: TimezoneUtils.getBerlinTimestamp(),
          sources: result.sources,
        };
      } else if (currentEvent && line.trim()) {
        if (!currentEvent.summary) {
          currentEvent.summary = line.trim();
        } else {
          currentEvent.summary += ' ' + line.trim();
        }
      }
    }
    
    // Add last event
    if (currentEvent && currentEvent.topic) {
      events.push(this.completeNewsEvent(currentEvent));
    }

    // If no structured events found, create one from the whole answer
    if (events.length === 0 && result.answer) {
      events.push({
        topic: 'Market Update',
        summary: result.answer.substring(0, 300),
        sentiment: this.analyzeSentiment(result.answer),
        impact: result.relevance === 'HIGH' ? 'HIGH' : result.relevance === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        relevantMarkets: [],
        timestamp: TimezoneUtils.getBerlinTimestamp(),
        sources: result.sources,
      });
    }

    return events;
  }

  /**
   * Complete a partial news event
   */
  private completeNewsEvent(partial: Partial<NewsEvent>): NewsEvent {
    return {
      topic: partial.topic || 'Unknown',
      summary: partial.summary || '',
      sentiment: partial.sentiment || this.analyzeSentiment(partial.summary || ''),
      impact: partial.impact || this.assessImpact(partial.summary || ''),
      relevantMarkets: partial.relevantMarkets || [],
      timestamp: partial.timestamp || TimezoneUtils.getBerlinTimestamp(),
      sources: partial.sources || [],
    };
  }

  /**
   * Analyze sentiment from text
   */
  private analyzeSentiment(text: string): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' {
    const lowerText = text.toLowerCase();
    
    const positiveWords = ['surge', 'rally', 'gains', 'up', 'bullish', 'positive', 'beat', 'record', 'growth'];
    const negativeWords = ['drop', 'fall', 'down', 'bearish', 'negative', 'miss', 'decline', 'loss'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    for (const word of positiveWords) {
      if (lowerText.includes(word)) positiveCount++;
    }
    
    for (const word of negativeWords) {
      if (lowerText.includes(word)) negativeCount++;
    }
    
    if (positiveCount > negativeCount) return 'POSITIVE';
    if (negativeCount > positiveCount) return 'NEGATIVE';
    return 'NEUTRAL';
  }

  /**
   * Assess impact level
   */
  private assessImpact(text: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    const lowerText = text.toLowerCase();
    
    const highImpactWords = ['breaking', 'major', 'significant', 'massive', 'record', 'historic'];
    const mediumImpactWords = ['notable', 'important', 'considerable'];
    
    for (const word of highImpactWords) {
      if (lowerText.includes(word)) return 'HIGH';
    }
    
    for (const word of mediumImpactWords) {
      if (lowerText.includes(word)) return 'MEDIUM';
    }
    
    return 'LOW';
  }

  /**
   * Assess relevance of search result
   */
  private assessRelevance(text: string): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (!text || text.length < 100) return 'LOW';
    if (text.length > 400) return 'HIGH';
    return 'MEDIUM';
  }

  /**
   * Log news event
   */
  logNewsEvent(event: NewsEvent): void {
    const emoji = event.impact === 'HIGH' ? '🔥' : event.impact === 'MEDIUM' ? '📰' : '📌';
    const sentimentEmoji = event.sentiment === 'POSITIVE' ? '📈' : event.sentiment === 'NEGATIVE' ? '📉' : '➖';
    
    TimezoneUtils.log(`${emoji} ${sentimentEmoji} ${event.topic}`, 'INFO');
    console.log(`   Impact: ${event.impact} | Sentiment: ${event.sentiment}`);
    console.log(`   ${event.summary.substring(0, 150)}${event.summary.length > 150 ? '...' : ''}`);
    
    if (event.sources.length > 0) {
      console.log(`   Sources: ${event.sources.slice(0, 2).join(', ')}`);
    }
    console.log('');
  }
}
