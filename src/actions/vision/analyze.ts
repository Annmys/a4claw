import config from '../../config.js';
import logger from '../../utils/logger.js';

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const part = item as Record<string, unknown>;
      if (typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeOpenAIModel(model?: string): string | null {
  if (!model) return null;
  const normalized = model.replace(/^(openai|openrouter|anthropic)\//, '').trim();
  if (!normalized) return null;
  if (normalized.startsWith('claude-')) return null;
  return normalized;
}

/**
 * Analyze an image using AI vision.
 * Tries Anthropic Claude first, then OpenAI-compatible vision, then OpenRouter.
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  prompt = 'Describe this image in detail.',
  mimeType = 'image/jpeg',
): Promise<string> {
  const base64 = imageBuffer.toString('base64');

  // Try Anthropic Claude (best vision quality)
  if (config.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: config.AI_MODEL,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType as any, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      });

      const text = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('\n');

      logger.info('Image analyzed via Anthropic', { textLength: text.length });
      return text;
    } catch (err: any) {
      logger.warn('Anthropic vision failed, trying fallback', { error: err.message });
    }
  }

  // Fallback: OpenAI-compatible endpoint (works with current OPENAI_BASE_URL deployments)
  if (config.OPENAI_API_KEY) {
    const baseUrl = (config.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const candidateModels = Array.from(new Set([
      normalizeOpenAIModel(config.MODEL_OVERRIDE),
      normalizeOpenAIModel(config.AI_MODEL),
      'gpt-5.3-codex',
      'gpt-4.1',
      'gpt-4o',
    ].filter((value): value is string => !!value)));

    let lastError: Error | null = null;

    for (const model of candidateModels) {
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
                        model,
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: prompt },
                                { type: 'image_url', image_url: `data:${mimeType};base64,${base64}` },
                            ],
                        }],
            max_tokens: 1024,
            temperature: 0.2,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`${response.status}: ${error}`);
        }

        const data = await response.json() as any;
        const text = extractTextContent(data.choices?.[0]?.message?.content) || 'Could not analyze image';
        logger.info('Image analyzed via OpenAI-compatible vision', { model, textLength: text.length });
        return text;
      } catch (err: any) {
        lastError = err;
        logger.warn('OpenAI-compatible vision failed, trying next model', { model, error: err.message });
      }
    }

    if (lastError) {
      logger.warn('OpenAI-compatible vision exhausted all fallback models', { error: lastError.message });
    }
  }

  // Fallback: OpenRouter with free multimodal model
  if (config.OPENROUTER_API_KEY) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://clawdagent.dev',
        'X-Title': 'ClawdAgent',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-preview-05-20',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: prompt },
          ],
        }],
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter vision error: ${response.status}: ${error}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content ?? 'Could not analyze image';
    logger.info('Image analyzed via OpenRouter', { textLength: text.length });
    return text;
  }

  throw new Error('No vision-capable provider available (need ANTHROPIC_API_KEY, OPENAI_API_KEY with a vision model, or OPENROUTER_API_KEY)');
}
