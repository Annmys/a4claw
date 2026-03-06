import { Router, Request, Response } from 'express';
import multer from 'multer';
import { resolve as pathResolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { Engine } from '../../../core/engine.js';
import { analyzeImage } from '../../../actions/vision/analyze.js';
import { getAllModels } from '../../../core/model-router.js';
import logger from '../../../utils/logger.js';

const UPLOAD_DIR = pathResolve(process.cwd(), 'uploads');

export function setupApiRoutes(engine: Engine): Router {
  const router = Router();

  // Ensure upload directory exists
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

  // Allowed MIME types and extensions for file uploads
  const ALLOWED_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'text/html',
    'application/pdf', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  ]);
  const ALLOWED_EXTS = new Set(['txt', 'md', 'csv', 'pdf', 'json', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'html', 'ts', 'js', 'py']);

  // Multer for chat file uploads (images + documents)
  const upload = multer({
    dest: UPLOAD_DIR,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB (reduced from 50MB)
    fileFilter: (_req, file, cb) => {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      if (ALLOWED_MIMES.has(file.mimetype) || (ext && ALLOWED_EXTS.has(ext))) {
        cb(null, true);
      } else {
        cb(new Error(`File type not allowed: ${file.mimetype} (.${ext})`));
      }
    },
  });

  // POST /api/chat — Send message with optional file attachment
  router.post('/chat', upload.single('file'), async (req: Request, res: Response) => {
    const user = (req as any).user;
    const text = req.body.text ?? '';
    const conversationId = req.body.conversationId as string | undefined;
    const responseMode = req.body.responseMode as string | undefined;
    const model = req.body.model as string | undefined;
    const file = (req as any).file as Express.Multer.File | undefined;

    let attachments: Array<{ type: string; url: string }> | undefined;
    let enrichedText = text;
    let renamedFilePath: string | undefined;

    try {
      if (file) {
        // Validate file content matches claimed type (magic bytes)
        const headerBuf = await readFile(file.path, { flag: 'r' }).then(b => b.subarray(0, 12));
        const isExecutable = headerBuf[0] === 0x4D && headerBuf[1] === 0x5A // MZ (PE/EXE)
          || headerBuf[0] === 0x7F && headerBuf[1] === 0x45 // ELF
          || (headerBuf[0] === 0x23 && headerBuf[1] === 0x21); // #! (script shebang)
        if (isExecutable) {
          try { unlinkSync(file.path); } catch {}
          res.status(400).json({ error: 'Executable files are not allowed' });
          return;
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
        const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);

        if (isImage) {
          // Analyze image with vision AI and include description in message
          const buffer = await readFile(file.path);
          const mimeType = file.mimetype || 'image/jpeg';
          const description = await analyzeImage(
            buffer,
            text ? `The user says: "${text}". Analyze this image and respond to the user's message about it.` : 'Describe this image in detail.',
            mimeType,
          );
          enrichedText = text
            ? `${text}\n\n[Image uploaded: ${file.originalname}]\nImage analysis: ${description}`
            : `[Image uploaded: ${file.originalname}]\nImage analysis: ${description}`;

          // Also ingest into RAG if engine has RAG
          const ragEngine = engine.getRAGEngine();
          if (ragEngine) {
            const { chunkText } = await import('../../../actions/rag/chunker.js');
            const chunks = chunkText(description, file.originalname);
            (ragEngine as any).vectorStore.addChunks(chunks, user.userId).catch(() => {});
          }
        } else {
          // Document file — ingest into RAG and reference in message
          const ragEngine = engine.getRAGEngine();
          const { renameSync } = await import('fs');
          const newPath = `${file.path}.${ext}`;
          renameSync(file.path, newPath);
          renamedFilePath = newPath;

          if (ragEngine) {
            const result = await ragEngine.ingestDocument(newPath, user.userId);
            try { unlinkSync(newPath); } catch {}
            renamedFilePath = undefined;
            const previewBlock = result.preview
              ? `\n\n--- Document preview ---\n${result.preview}`
              : '';
            enrichedText = text
              ? `${text}\n\n[Document uploaded: ${file.originalname} — ${result.chunks} chunks ingested into knowledge base]${previewBlock}\n\nUse the uploaded document content when answering.`
              : `[Document uploaded: ${file.originalname} — ${result.chunks} chunks ingested into knowledge base. Please summarize or answer questions about this document.]${previewBlock}`;
            // Mark as handled so we don't try to delete again
            (file as any)._handled = true;
          } else {
            const { extractText } = await import('../../../actions/rag/extractor.js');
            const docText = await extractText(newPath);
            try { unlinkSync(newPath); } catch {}
            renamedFilePath = undefined;
            const preview = docText.replace(/\s+/g, ' ').trim().slice(0, 1200);
            enrichedText = text
              ? `${text}\n\n[File uploaded: ${file.originalname} — RAG not available]\n\n--- Document preview ---\n${preview}\n\nUse the uploaded document content when answering.`
              : `[File uploaded: ${file.originalname} — RAG not available]\n\n--- Document preview ---\n${preview}\n\nPlease summarize or answer questions about this document.`;
            (file as any)._handled = true;
          }
        }

        // Clean up temp file (skip if already handled by RAG ingest path)
        if (!(file as any)._handled) {
          try { unlinkSync(renamedFilePath ?? file.path); } catch {}
        }
      }

      if (!enrichedText.trim()) {
        res.status(400).json({ error: 'No message or file provided' });
        return;
      }

      const response = await engine.process({
        platform: 'web',
        userId: user.userId,
        userName: user.userId,
        chatId: 'web',
        text: enrichedText,
        userRole: user.role,
        conversationId,
        attachments,
        responseMode: responseMode as any,
        model,
      });

      res.json({
        message: response.text,
        thinking: response.thinking,
        artifacts: response.artifacts,
        agent: response.agentUsed,
        provider: response.provider,
        model: response.modelUsed,
        tokens: response.tokensUsed,
        elapsed: response.elapsed,
      });
    } catch (error: any) {
      logger.error('Chat API error', { error: error.message });
      // Clean up file on error
      if (file) try { unlinkSync(renamedFilePath ?? file.path); } catch {}
      res.status(500).json({ error: 'Failed to process message', details: error.message });
    }
  });

  router.get('/status', (_req: Request, res: Response) => {
    res.json({ status: 'online', uptime: process.uptime(), memory: process.memoryUsage().heapUsed });
  });

  // GET /api/models — list available AI models for the model selector
  router.get('/models', (_req: Request, res: Response) => {
    const models = getAllModels().map(m => ({
      id: m.id, name: m.name, provider: m.provider, tier: m.tier,
      supportsHebrew: m.supportsHebrew, supportsVision: m.supportsVision,
    }));
    res.json({ models: [
      { id: 'auto', name: 'Auto', provider: 'auto', tier: 'auto', supportsHebrew: true, supportsVision: true },
      { id: 'claude-code-cli', name: 'Claude Code CLI (Opus 4.6)', provider: 'claude-code', tier: 'ultra', supportsHebrew: true, supportsVision: true },
      ...models,
    ]});
  });

  return router;
}
