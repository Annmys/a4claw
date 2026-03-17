import { BaseTool, ToolResult } from './base-tool.js';
import config from '../../config.js';

const FAL_QUEUE = 'https://queue.fal.run';

// ─── Convenience aliases → fal.ai model endpoint IDs ─────────────────────
interface FalAlias { modelId: string; name: string; category: string }

const ALIASES: Record<string, FalAlias> = {
  // ─── IMAGE ──────────────────────────────────────────────────
  image_flux_dev:      { modelId: 'fal-ai/flux/dev', name: 'FLUX Dev', category: 'image' },
  image_flux_schnell:  { modelId: 'fal-ai/flux/schnell', name: 'FLUX Schnell (fast)', category: 'image' },
  image_flux_pro:      { modelId: 'fal-ai/flux-pro/v1.1', name: 'FLUX Pro 1.1', category: 'image' },
  image_flux_ultra:    { modelId: 'fal-ai/flux-pro/v1.1-ultra', name: 'FLUX Pro Ultra', category: 'image' },
  image_flux_realism:  { modelId: 'fal-ai/flux-realism', name: 'FLUX Realism', category: 'image' },
  image_sd3:           { modelId: 'fal-ai/stable-diffusion-v35-large', name: 'SD 3.5 Large', category: 'image' },
  image_sdxl:          { modelId: 'fal-ai/fast-sdxl', name: 'Fast SDXL', category: 'image' },
  image_recraft:       { modelId: 'fal-ai/recraft-v3', name: 'Recraft V3', category: 'image' },
  image_ideogram:      { modelId: 'fal-ai/ideogram/v2/turbo', name: 'Ideogram V2 Turbo', category: 'image' },
  image_aura:          { modelId: 'fal-ai/aura-flow', name: 'AuraFlow', category: 'image' },
  // ─── IMAGE-TO-IMAGE ────────────────────────────────────────
  img2img_flux:        { modelId: 'fal-ai/flux/dev/image-to-image', name: 'FLUX Dev I2I', category: 'image' },
  img2img_sdxl:        { modelId: 'fal-ai/fast-sdxl/image-to-image', name: 'Fast SDXL I2I', category: 'image' },
  // ─── VIDEO ──────────────────────────────────────────────────
  video_minimax:       { modelId: 'fal-ai/minimax/video-01-live', name: 'Minimax Video-01 Live', category: 'video' },
  video_wan:           { modelId: 'fal-ai/wan/v2.1/text-to-video', name: 'Wan 2.1 T2V', category: 'video' },
  video_wan_i2v:       { modelId: 'fal-ai/wan/v2.1/image-to-video', name: 'Wan 2.1 I2V', category: 'video' },
  video_kling:         { modelId: 'fal-ai/kling-video/v2/master/text-to-video', name: 'Kling V2 Master', category: 'video' },
  video_kling_i2v:     { modelId: 'fal-ai/kling-video/v2/master/image-to-video', name: 'Kling V2 I2V', category: 'video' },
  video_luma:          { modelId: 'fal-ai/luma-dream-machine', name: 'Luma Dream Machine', category: 'video' },
  video_hunyuan:       { modelId: 'fal-ai/hunyuan-video', name: 'Hunyuan Video', category: 'video' },
  // ─── UPSCALE ────────────────────────────────────────────────
  upscale_creative:    { modelId: 'fal-ai/creative-upscaler', name: 'Creative Upscaler', category: 'upscale' },
  upscale_clarity:     { modelId: 'fal-ai/clarity-upscaler', name: 'Clarity Upscaler', category: 'upscale' },
  upscale_aura:        { modelId: 'fal-ai/aura-sr', name: 'Aura SR (fast)', category: 'upscale' },
  // ─── UTILITY ────────────────────────────────────────────────
  remove_bg:           { modelId: 'fal-ai/bria/background/remove', name: 'Remove Background', category: 'utility' },
  inpaint:             { modelId: 'fal-ai/flux/dev/inpainting', name: 'FLUX Inpainting', category: 'utility' },
  face_swap:           { modelId: 'fal-ai/face-swap', name: 'Face Swap', category: 'utility' },
};

export class FalTool extends BaseTool {
  name = 'fal';
  description = 'AI Image/Video Generation via fal.ai — FLUX, Stable Diffusion, Kling, Wan, Minimax, Luma, upscaling, inpainting, face swap. Queue-based async with auto-polling.';

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.FAL_AI_API_KEY || '';
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.apiKey) return { success: false, output: '', error: 'FAL_AI_API_KEY not configured' };

    const action = input.action as string;
    if (!action) return { success: false, output: '', error: 'No action provided' };

    try {
      // ─── Utility actions ───────────────────────────────────────
      if (action === 'status')          return await this.checkStatus(input);
      if (action === 'result')          return await this.getResult(input);
      if (action === 'list_models')     return this.listModels();
      if (action === 'cancel')          return await this.cancelRequest(input);

      // ─── Alias-based generation ────────────────────────────────
      const alias = ALIASES[action];
      if (alias) return await this.submitAndPoll(alias.modelId, input);

      // ─── Direct model ID (power-user) ──────────────────────────
      if (action === 'generate') {
        const modelId = input.model as string;
        if (!modelId) return { success: false, output: '', error: 'model is required for generate action' };
        return await this.submitAndPoll(modelId, input);
      }

      return { success: false, output: '', error: `Unknown action: ${action}. Use list_models to see available actions.` };
    } catch (err: any) {
      this.error('Execution error', { error: err.message, action });
      return { success: false, output: '', error: err.message };
    }
  }

  // ─── Submit job and auto-poll for result ─────────────────────────────────
  private async submitAndPoll(modelId: string, input: Record<string, unknown>): Promise<ToolResult> {
    // Build request body — pass through all input fields except meta fields
    const body: Record<string, unknown> = {};
    const metaKeys = new Set(['action', 'model', '_userRole', '_userId']);
    for (const [k, v] of Object.entries(input)) {
      if (!metaKeys.has(k) && v !== undefined) body[k] = v;
    }

    this.log('Submitting job', { modelId, bodyKeys: Object.keys(body).join(',') });

    const submitRes = await this.post(`${FAL_QUEUE}/${modelId}`, body);

    // fal.ai returns either:
    // A) Immediate result (for fast models like schnell): { images: [...] }
    // B) Queued: { request_id, status: "IN_QUEUE" }

    if (submitRes.images || submitRes.video || submitRes.image || submitRes.output) {
      // Immediate result
      return { success: true, output: JSON.stringify(submitRes, null, 2) };
    }

    const requestId = submitRes.request_id;
    if (!requestId) {
      return { success: true, output: JSON.stringify(submitRes, null, 2) };
    }

    this.log('Queued', { requestId, modelId });

    // Auto-poll (up to 10 attempts, 5s interval)
    for (let i = 0; i < 10; i++) {
      await this.sleep(5000);

      try {
        const status = await this.get(`${FAL_QUEUE}/${modelId}/requests/${requestId}/status`);

        if (status.status === 'COMPLETED') {
          const result = await this.get(`${FAL_QUEUE}/${modelId}/requests/${requestId}`);
          return { success: true, output: JSON.stringify(result, null, 2) };
        }

        if (status.status === 'FAILED') {
          return { success: false, output: JSON.stringify(status, null, 2), error: status.error || 'Job failed' };
        }

        this.log('Polling', { requestId, status: status.status, attempt: i + 1, queue_position: status.queue_position });
      } catch {
        // Status check failed — continue polling
      }
    }

    // Still not done — return request_id for manual follow-up
    return {
      success: true,
      output: JSON.stringify({
        status: 'still_processing',
        request_id: requestId,
        model_id: modelId,
        message: 'Job is still processing. Use status action with request_id and model to check later.',
      }, null, 2),
    };
  }

  // ─── Check status of a queued request ────────────────────────────────────
  private async checkStatus(input: Record<string, unknown>): Promise<ToolResult> {
    const requestId = input.request_id as string || input.requestId as string;
    const modelId = input.model as string || input.model_id as string;
    if (!requestId || !modelId) return { success: false, output: '', error: 'request_id and model are required' };

    const status = await this.get(`${FAL_QUEUE}/${modelId}/requests/${requestId}/status`);
    return { success: true, output: JSON.stringify(status, null, 2) };
  }

  // ─── Get result of a completed request ───────────────────────────────────
  private async getResult(input: Record<string, unknown>): Promise<ToolResult> {
    const requestId = input.request_id as string || input.requestId as string;
    const modelId = input.model as string || input.model_id as string;
    if (!requestId || !modelId) return { success: false, output: '', error: 'request_id and model are required' };

    const result = await this.get(`${FAL_QUEUE}/${modelId}/requests/${requestId}`);
    return { success: true, output: JSON.stringify(result, null, 2) };
  }

  // ─── Cancel a queued request ─────────────────────────────────────────────
  private async cancelRequest(input: Record<string, unknown>): Promise<ToolResult> {
    const requestId = input.request_id as string || input.requestId as string;
    const modelId = input.model as string || input.model_id as string;
    if (!requestId || !modelId) return { success: false, output: '', error: 'request_id and model are required' };

    const url = `${FAL_QUEUE}/${modelId}/requests/${requestId}/cancel`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': `Key ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`fal.ai cancel ${res.status}: ${await res.text()}`);
    return { success: true, output: 'Request cancelled' };
  }

  // ─── List available models ───────────────────────────────────────────────
  private listModels(): ToolResult {
    const grouped: Record<string, string[]> = {};
    for (const [action, alias] of Object.entries(ALIASES)) {
      const cat = alias.category.toUpperCase();
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`  ${action} — ${alias.name} (${alias.modelId})`);
    }

    let out = 'fal.ai Available Models:\n\n';
    for (const [cat, items] of Object.entries(grouped)) {
      out += `── ${cat} ──\n${items.join('\n')}\n\n`;
    }
    out += '── POWER USER ──\n  generate — Use any fal.ai model by ID (set model="fal-ai/...")\n';
    out += '\nUse action name directly: fal({ action: "image_flux_dev", prompt: "..." })\n';
    out += 'Or direct model ID: fal({ action: "generate", model: "fal-ai/flux/dev", prompt: "..." })';

    return { success: true, output: out };
  }

  // ─── HTTP helpers ────────────────────────────────────────────────────────
  private async post(url: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`fal.ai ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }

  private async get(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: { 'Authorization': `Key ${this.apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`fal.ai ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
