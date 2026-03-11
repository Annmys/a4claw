import { Router, Request, Response } from 'express';
import multer from 'multer';
import { resolve as pathResolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { Engine } from '../../../core/engine.js';
import { analyzeImage } from '../../../actions/vision/analyze.js';
import { extractText } from '../../../actions/rag/extractor.js';
import { getAllModels } from '../../../core/model-router.js';
import { publishFileToUserShare } from '../../../core/shared-artifacts.js';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  getConversationMetadataForUser,
  mergeConversationMetadataForUser,
} from '../../../memory/repositories/conversations.js';
import logger from '../../../utils/logger.js';

const UPLOAD_DIR = pathResolve(process.cwd(), 'uploads');

function normalizeDocumentText(input: string): string {
  return input
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function buildLocalDocumentFallback(userText: string, fileName: string, extractedText: string): string {
  const normalized = normalizeDocumentText(extractedText);
  const lines = normalized.split('\n').filter(Boolean);
  const summaryLines = lines.slice(0, 8);
  const previewLines = lines.slice(0, 20);
  const isSummaryRequest = /总结|摘要|概括|总结一下|summar|summary|extract|提炼|主要内容|内容/.test(userText.toLowerCase());

  if (summaryLines.length === 0) {
    return `已收到文件《${fileName}》，但本地未提取到可用正文。`;
  }

  if (isSummaryRequest) {
    return [
      `已为你先做本地兜底总结：《${fileName}》`,
      '',
      '核心内容：',
      ...summaryLines.map((line, index) => `${index + 1}. ${line}`),
    ].join('\n');
  }

  return [
    `主处理链路异常，先返回《${fileName}》的本地提取结果。`,
    '',
    '正文预览：',
    ...previewLines.map((line) => `- ${line}`),
  ].join('\n');
}

function isDocumentSummaryRequest(text: string): boolean {
  return /总结|摘要|概括|总结一下|summar|summary|extract|提炼|主要内容|内容|看一下|看看|readme|说明书/.test(text.toLowerCase());
}

function looksLikeModelFailure(text: string | undefined): boolean {
  if (!text) return false;
  return [
    'Circuit breaker [',
    'No providers available',
    'Insufficient credits',
    'משהו השתבש',
    'שגיאה:',
    'API keys',
  ].some((pattern) => text.includes(pattern));
}

function shouldReuseConversationDocumentContext(text: string): boolean {
  return /这个文件|这份文件|这个pdf|这份pdf|这个文档|这份文档|里面的内容|开始翻译|继续翻译|完整翻译|全文翻译|翻译成中文|总结一下|总结这份|总结这个|继续总结|接着总结|提取要点|继续处理|继续分析|分析这份|分析这个|这个readme|summar|summary|translate|this file|the file|this pdf|the pdf|this document|the document|continue translation|continue summary/i.test(text);
}

async function resolveDbUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

async function getConversationDocumentContext(conversationId: string, dbUserId: string): Promise<null | {
  fileName: string;
  mimeType?: string;
  artifactPath?: string;
  cachedText?: string;
}> {
  const metadata = await getConversationMetadataForUser(conversationId, dbUserId);
  const raw = metadata?.lastDocumentContext;
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Record<string, unknown>;
  if (typeof doc.fileName !== 'string') return null;
  return {
    fileName: doc.fileName,
    mimeType: typeof doc.mimeType === 'string' ? doc.mimeType : undefined,
    artifactPath: typeof doc.artifactPath === 'string' ? doc.artifactPath : undefined,
    cachedText: typeof doc.cachedText === 'string' ? doc.cachedText : undefined,
  };
}

async function resolveConversationDocumentText(context: {
  artifactPath?: string;
  cachedText?: string;
}): Promise<string> {
  if (context.cachedText?.trim()) return context.cachedText;
  if (context.artifactPath && existsSync(context.artifactPath)) {
    return extractText(context.artifactPath);
  }
  return '';
}

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
    const requestId = randomUUID().slice(0, 8);
    const user = (req as any).user;
    const text = req.body.text ?? '';
    const conversationId = req.body.conversationId as string | undefined;
    const responseMode = req.body.responseMode as string | undefined;
    const model = req.body.model as string | undefined;
    const file = (req as any).file as Express.Multer.File | undefined;

    let attachments: Array<{ type: string; url: string }> | undefined;
    let enrichedText = text;
    let renamedFilePath: string | undefined;
    let uploadedArtifact: any | undefined;
    let extractedDocumentText = '';

    try {
      logger.info('Chat API request', {
        requestId,
        userId: user?.userId,
        conversationId: conversationId ?? null,
        hasFile: !!file,
        textLength: typeof text === 'string' ? text.length : 0,
        responseMode: responseMode ?? 'auto',
        model: model ?? 'auto',
      });

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
          try {
            uploadedArtifact = await publishFileToUserShare(file.path, user.userId, file.originalname);
          } catch (artifactErr: any) {
            logger.warn('Failed to publish uploaded image to shared output', {
              userId: user.userId,
              fileName: file.originalname,
              error: artifactErr.message,
            });
          }

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

          try {
            uploadedArtifact = await publishFileToUserShare(newPath, user.userId, file.originalname);
          } catch (artifactErr: any) {
            logger.warn('Failed to publish uploaded document to shared output', {
              userId: user.userId,
              fileName: file.originalname,
              error: artifactErr.message,
            });
          }

          if (ragEngine) {
            const result = await ragEngine.ingestDocument(newPath, user.userId);
            extractedDocumentText = typeof result.preview === 'string' ? result.preview : '';
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
            const docText = await extractText(newPath);
            extractedDocumentText = docText;
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

        if (conversationId && extractedDocumentText.trim()) {
          try {
            const dbUserId = await resolveDbUserId(user.userId);
            await mergeConversationMetadataForUser(conversationId, dbUserId, {
              lastDocumentContext: {
                fileName: file.originalname,
                mimeType: file.mimetype,
                artifactPath: uploadedArtifact?.path,
                cachedText: extractedDocumentText.slice(0, 20000),
                updatedAt: new Date().toISOString(),
              },
            });
          } catch (contextErr: any) {
            logger.warn('Failed to persist conversation document context', {
              userId: user.userId,
              conversationId,
              error: contextErr.message,
            });
          }
        }
      } else if (conversationId && shouldReuseConversationDocumentContext(text)) {
        try {
          const dbUserId = await resolveDbUserId(user.userId);
          const documentContext = await getConversationDocumentContext(conversationId, dbUserId);
          if (documentContext) {
            const documentText = await resolveConversationDocumentText(documentContext);
            if (documentText.trim()) {
              enrichedText = [
                `[Conversation document context: ${documentContext.fileName}]`,
                'Use the following document as the primary source for this reply.',
                '--- Document content ---',
                documentText.slice(0, 20000),
                '--- End document content ---',
                '',
                text,
              ].join('\n');
            }
          }
        } catch (contextErr: any) {
          logger.warn('Failed to load conversation document context', {
            userId: user.userId,
            conversationId,
            error: contextErr.message,
          });
        }
      }

      if (!enrichedText.trim()) {
        res.status(400).json({ error: 'No message or file provided' });
        return;
      }

      if (file && extractedDocumentText.trim() && isDocumentSummaryRequest(text || '')) {
        const responseArtifacts = uploadedArtifact ? [uploadedArtifact] : undefined;
        res.json({
          message: buildLocalDocumentFallback(text, file.originalname, extractedDocumentText),
          artifacts: responseArtifacts,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
        });
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

      const shouldUseLocalFallback =
        Boolean(file)
        && Boolean(extractedDocumentText.trim())
        && looksLikeModelFailure(response.text);

      if (shouldUseLocalFallback) {
        const responseArtifacts = uploadedArtifact ? [uploadedArtifact] : undefined;
        res.json({
          message: buildLocalDocumentFallback(text, file!.originalname, extractedDocumentText),
          thinking: response.thinking,
          artifacts: responseArtifacts,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
          elapsed: response.elapsed,
        });
        return;
      }

      logger.info('Chat API response', {
        requestId,
        userId: user?.userId,
        conversationId: conversationId ?? null,
        provider: response.provider ?? null,
        model: response.modelUsed ?? null,
        elapsed: response.elapsed ?? null,
      });

      const responseArtifacts = Array.isArray(response.artifacts) ? [...response.artifacts] : [];
      if (uploadedArtifact) {
        const alreadyIncluded = responseArtifacts.some(a =>
          a?.path === uploadedArtifact.path || a?.url === uploadedArtifact.url
        );
        if (!alreadyIncluded) responseArtifacts.unshift(uploadedArtifact);
      }

      res.json({
        message: response.text,
        thinking: response.thinking,
        artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
        agent: response.agentUsed,
        provider: response.provider,
        model: response.modelUsed,
        tokens: response.tokensUsed,
        elapsed: response.elapsed,
      });
    } catch (error: any) {
      logger.error('Chat API error', {
        requestId,
        userId: user?.userId,
        conversationId: conversationId ?? null,
        error: error.message,
      });
      // Clean up file on error
      if (file) try { unlinkSync(renamedFilePath ?? file.path); } catch {}
      if (res.headersSent) return;

      if (file && extractedDocumentText.trim()) {
        const responseArtifacts = uploadedArtifact ? [uploadedArtifact] : undefined;
        res.status(200).json({
          message: buildLocalDocumentFallback(text, file.originalname, extractedDocumentText),
          artifacts: responseArtifacts,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
        });
        return;
      }

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
