interface FeedbackRecord {
  positive: boolean;
  userMessage: string;
  response: string;
  timestamp: string;
}

/**
 * Self-Improvement — tracks user feedback, detects dissatisfaction,
 * and analyzes patterns to suggest improvements.
 */
export class SelfImprove {
  private feedbackLog: FeedbackRecord[] = [];
  private aiChat: (system: string, message: string) => Promise<string>;
  private sendAlert: ((msg: string) => Promise<void>) | null = null;

  constructor(aiChat: (system: string, message: string) => Promise<string>) {
    this.aiChat = aiChat;
  }

  setAlertSender(fn: (msg: string) => Promise<void>) {
    this.sendAlert = fn;
  }

  /**
   * Detect implicit negative feedback from message patterns.
   */
  isNegativeFeedback(message: string): boolean {
    const negativePhrases = [
      '不是这个', '不对', '错误', '不正确', 'wrong', 'bad', 'not what',
      '不是我要的', '不是这样', '重来', '再试一次', 'try again',
      '不能用', "doesn't work", 'broken', '坏了', '失败',
      '你在干什么', 'what are you doing', '为什么', 'why did you',
    ];
    const lower = message.toLowerCase();
    return negativePhrases.some(p => lower.includes(p));
  }

  /**
   * Record feedback (positive or negative).
   */
  async recordFeedback(params: {
    positive: boolean;
    userMessage: string;
    response: string;
    userId: string;
  }): Promise<void> {
    this.feedbackLog.push({
      positive: params.positive,
      userMessage: params.userMessage.slice(0, 300),
      response: params.response.slice(0, 300),
      timestamp: new Date().toISOString(),
    });

    // If too many negatives in last hour, trigger analysis
    const recentNeg = this.feedbackLog
      .filter(f => !f.positive && Date.now() - new Date(f.timestamp).getTime() < 3600000)
      .length;

    if (recentNeg >= 3 && this.sendAlert) {
      const analysis = await this.analyzeAndSuggest();
      if (analysis) {
        await this.sendAlert(`📈 自我改进分析：\n\n${analysis}`).catch(() => {});
      }
    }
  }

  /**
   * Analyze feedback patterns and suggest improvements.
   */
  async analyzeAndSuggest(): Promise<string> {
    const negatives = this.feedbackLog.filter(f => !f.positive).slice(-10);
    if (negatives.length === 0) return '';

    try {
      const analysis = await this.aiChat(
        `You analyze an AI agent's mistakes to find patterns. Suggest 1-3 concrete improvements.
Respond ONLY with JSON: { "improvements": [{ "issue": "what went wrong", "fix": "how to prevent it" }] }`,
        `Recent failures:\n${negatives.map(n => `Q: ${n.userMessage}\nBad A: ${n.response}`).join('\n---\n')}`,
      );

      const cleaned = analysis.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return (parsed.improvements || [])
        .map((imp: any, i: number) => `${i + 1}. ${imp.issue}\n   => ${imp.fix}`)
        .join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Get satisfaction report.
   */
  getReport(): string {
    const pos = this.feedbackLog.filter(f => f.positive).length;
    const neg = this.feedbackLog.filter(f => !f.positive).length;
    const total = pos + neg;
    const rate = total > 0 ? Math.round((pos / total) * 100) : 100;
    return `Satisfaction: ${rate}% (${pos} positive / ${neg} negative out of ${total})`;
  }

  /**
   * Cleanup old entries (call daily).
   */
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.feedbackLog = this.feedbackLog.filter(
      f => new Date(f.timestamp).getTime() >= cutoff
    );
  }
}
