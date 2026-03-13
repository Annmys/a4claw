import { Router, Request, Response } from 'express';
import multer from 'multer';
import { basename, extname, resolve as pathResolve } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { Engine } from '../../../core/engine.js';
import { analyzeImage } from '../../../actions/vision/analyze.js';
import { extractText, SUPPORTED_DOCUMENT_EXTENSIONS } from '../../../actions/rag/extractor.js';
import { getAllModels } from '../../../core/model-router.js';
import { publishFileToUserShare } from '../../../core/shared-artifacts.js';
import { createDocumentResultArtifacts } from '../../../core/document-artifact-pipeline.js';
import { findOrCreateUser } from '../../../memory/repositories/users.js';
import {
  getOrCreateConversation,
  getConversationMetadataForUser,
  mergeConversationMetadataForUser,
} from '../../../memory/repositories/conversations.js';
import { saveMessage as saveConversationMessage } from '../../../memory/repositories/messages.js';
import logger from '../../../utils/logger.js';

const UPLOAD_DIR = pathResolve(process.cwd(), 'uploads');
const DOCUMENT_PDF_FONT_PATH = '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf';
type DocumentOutputAction = 'translation' | 'summary' | 'rewrite' | 'analysis' | 'result';

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

function isImplicitDocumentFollowup(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  return /^(这一份|这份|这个|这个文件|这份文件|这个pdf|这份pdf|刚才那个|刚才这份|刚才发的|刚才发的pdf|刚才的pdf|上一份|上一个文件|这一个文件|这一个pdf|继续|继续处理|继续这个|继续这一份|继续这份|继续翻这个|继续翻译这份)$/i.test(normalized);
}

function classifyDocumentOutputAction(text: string): DocumentOutputAction {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return 'result';
  if (/总结|摘要|概括|summary|summar|提炼|要点|写的是什么|讲了什么/.test(normalized)) return 'summary';
  if (/翻译|translate|translation|译成|译为/.test(normalized)) return 'translation';
  if (/改写|重写|rewrite|润色|整理|排版|编辑/.test(normalized)) return 'rewrite';
  if (/分析|analysis|解释|问答|qa|q&a|校对/.test(normalized)) return 'analysis';
  return 'result';
}

function resolveDocumentOutputAction(text: string, previousAction?: DocumentOutputAction): DocumentOutputAction {
  const explicit = classifyDocumentOutputAction(text);
  if (explicit !== 'result') return explicit;
  if (isImplicitDocumentFollowup(text)) return previousAction ?? 'summary';
  return explicit;
}

function buildResolvedDocumentRequest(
  userText: string,
  fileName: string,
  action: DocumentOutputAction,
  previousRequest?: string,
): string {
  const normalized = userText.trim();
  if (normalized && !isImplicitDocumentFollowup(normalized)) return normalized;
  if (previousRequest?.trim()) return previousRequest.trim();

  switch (action) {
    case 'translation':
      return `请把《${fileName}》完整翻译成中文，尽量保留原标题、编号、列表和段落结构。`;
    case 'summary':
      return `请用中文总结《${fileName}》的主要内容，直接给结果。`;
    case 'analysis':
      return `请用中文分析《${fileName}》的核心内容和要点。`;
    case 'rewrite':
      return `请根据《${fileName}》的正文整理并重写为清晰的中文结果。`;
    default:
      return `请根据《${fileName}》的正文直接完成处理并返回结果。`;
  }
}

function buildLocalDocumentFallback(
  userText: string,
  fileName: string,
  extractedText: string,
  previousAction?: DocumentOutputAction,
  previousRequest?: string,
): string {
  const normalized = normalizeDocumentText(extractedText);
  const lines = normalized.split('\n').filter(Boolean);
  const summaryLines = lines.slice(0, 12);
  const previewLines = lines.slice(0, 20);
  const resolvedAction = resolveDocumentOutputAction(userText, previousAction);
  const resolvedRequest = buildResolvedDocumentRequest(userText, fileName, resolvedAction, previousRequest);

  if (summaryLines.length === 0) {
    return `已收到文件《${fileName}》，但本地未提取到可用正文。`;
  }

  if (resolvedAction === 'summary') {
    return [
      `主模型链路暂时失败，先返回《${fileName}》的本地提取要点：`,
      '',
      '识别到的主要内容：',
      ...summaryLines.map((line, index) => `${index + 1}. ${line}`),
    ].join('\n');
  }

  if (resolvedAction === 'translation') {
    return [
      `主模型链路暂时失败，未能完成《${fileName}》的中文翻译。`,
      `已保留本次任务要求：${resolvedRequest}`,
      '',
      '当前已提取到的正文预览：',
      ...previewLines.map((line) => `- ${line}`),
    ].join('\n');
  }

  return [
    `主处理链路异常，先返回《${fileName}》的本地提取结果。`,
    `任务要求：${resolvedRequest}`,
    '',
    '正文预览：',
    ...previewLines.map((line) => `- ${line}`),
  ].join('\n');
}

function isDocumentSummaryRequest(text: string): boolean {
  return /总结|摘要|概括|总结一下|summar|summary|extract|提炼|主要内容|内容|看一下|看看|readme|说明书|写的是什么|讲了什么/.test(text.toLowerCase());
}

function isDocumentDirectRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || isImplicitDocumentFollowup(normalized)) return true;
  return /总结|摘要|概括|总结一下|summar|summary|extract|提炼|主要内容|内容|看一下|看看|readme|说明书|翻译|translate|translation|译成|译为|全文|完整翻译|中文|分析|analysis|解释|问答|qa|q&a|校对|润色|整理|表格|excel/.test(normalized);
}

function buildDocumentOutputFileName(fileName: string, userText: string, extension: 'pdf' | 'md'): string {
  const stem = basename(fileName, extname(fileName)).replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'document';
  const suffixMap = {
    translation: 'translated',
    summary: 'summary',
    rewrite: 'rewritten',
    analysis: 'analysis',
    result: 'result',
  } as const;
  const suffix = suffixMap[classifyDocumentOutputAction(userText)];
  return `${stem}-${suffix}.${extension}`;
}

function buildDocumentArtifactBody(fileName: string, userText: string, content: string): string {
  const requestLine = userText.trim() || '自动处理文档';
  return [
    `文件名：${fileName}`,
    `处理要求：${requestLine}`,
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    content.trim(),
  ].join('\n');
}

function wrapPdfLine(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  if (!text.trim()) return [''];

  const segments = text.split(/(\s+)/).filter(Boolean);
  const hasWordBoundaries = segments.some((segment) => /\s+/.test(segment));
  const units = hasWordBoundaries ? segments : Array.from(text);
  const lines: string[] = [];
  let current = '';

  for (const unit of units) {
    const next = `${current}${unit}`;
    if (!current || measure(next) <= maxWidth) {
      current = next;
      continue;
    }

    if (current.trim()) lines.push(current.trimEnd());
    current = unit.trimStart();

    if (measure(current) <= maxWidth) continue;

    let charLine = '';
    for (const char of Array.from(unit)) {
      const candidate = `${charLine}${char}`;
      if (!charLine || measure(candidate) <= maxWidth) {
        charLine = candidate;
      } else {
        lines.push(charLine);
        charLine = char;
      }
    }
    current = charLine;
  }

  if (current.trim() || text.endsWith(' ')) {
    lines.push(current.trimEnd());
  }

  return lines.length > 0 ? lines : [''];
}

async function writeTextPdf(targetPath: string, title: string, body: string): Promise<void> {
  const pdfLib = await import('pdf-lib');
  const fontkitMod = await import('@pdf-lib/fontkit');
  const PDFDocument = (pdfLib as any).PDFDocument as typeof import('pdf-lib').PDFDocument;
  const rgb = (pdfLib as any).rgb as typeof import('pdf-lib').rgb;
  const fontkit = (fontkitMod as any).default ?? fontkitMod;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await readFile(DOCUMENT_PDF_FONT_PATH);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 48;
  const marginTop = 54;
  const marginBottom = 54;
  const titleSize = 16;
  const textSize = 11;
  const titleLineHeight = 24;
  const textLineHeight = 18;
  const maxWidth = pageWidth - marginX * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - marginTop;

  const ensureSpace = (heightNeeded: number) => {
    if (cursorY - heightNeeded < marginBottom) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      cursorY = pageHeight - marginTop;
    }
  };

  ensureSpace(titleLineHeight);
  page.drawText(title, {
    x: marginX,
    y: cursorY,
    size: titleSize,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  cursorY -= titleLineHeight;

  const paragraphs = body.replace(/\r/g, '').split('\n');
  for (const paragraph of paragraphs) {
    const lines = wrapPdfLine(paragraph, maxWidth, (line) => font.widthOfTextAtSize(line, textSize));
    for (const line of lines) {
      ensureSpace(textLineHeight);
      page.drawText(line || ' ', {
        x: marginX,
        y: cursorY,
        size: textSize,
        font,
        color: rgb(0.16, 0.16, 0.16),
      });
      cursorY -= textLineHeight;
    }
  }

  const bytes = await pdfDoc.save();
  await writeFile(targetPath, bytes);
}

async function createDocumentArtifacts(params: {
  userId: string;
  fileName: string;
  userText: string;
  content: string;
}): Promise<{ artifacts: any[]; artifactPlan: Record<string, unknown> }> {
  const generated = await createDocumentResultArtifacts(params);
  return {
    artifacts: generated.artifacts,
    artifactPlan: generated.plan as unknown as Record<string, unknown>,
  };
}

function looksLikeModelFailure(text: string | undefined): boolean {
  if (!text) return false;
  return [
    'Circuit breaker [',
    'No providers available',
    'Insufficient credits',
    '处理失败',
    '错误：',
    'API keys',
  ].some((pattern) => text.includes(pattern));
}

function shouldReuseConversationDocumentContext(text: string): boolean {
  return /这一份|这份|这个文件|这份文件|这个pdf|这份pdf|这个文档|这份文档|里面的内容|开始翻译|继续翻译|完整翻译|全文翻译|翻译成中文|总结一下|总结这份|总结这个|继续总结|接着总结|提取要点|继续处理|继续分析|分析这份|分析这个|这个readme|summar|summary|translate|this file|the file|this pdf|the pdf|this document|the document|continue translation|continue summary/i.test(text);
}

function sanitizeDocumentMessageWithArtifacts(text: string, artifacts: any[] | undefined): string {
  if (!text?.trim() || !artifacts || artifacts.length === 0) return text;
  const attachmentLine = `已生成并作为附件返回：${artifacts.map((artifact) => artifact.originalName || artifact.name).join('、')}`;
  const generatedNames = artifacts.map((artifact) => String(artifact.originalName || artifact.name || '').toLowerCase());
  const hasOfficeBinary = generatedNames.some((name) => /\.(pdf|docx|xlsx|pptx)$/.test(name));
  let cleaned = text
    .replace(/我(?:当前|目前)?无法(?:直接)?在?(?:此会话|此对话|当前对话)?中?(?:直接)?生成并传输二进制\s*(PDF|Word|DOCX|XLSX|PPTX?)\s*文件[^。\n]*[。\n]?/gi, '')
    .replace(/我(?:当前|目前)?无法(?:直接)?(?:生成|输出|传输)\s*(PDF|Word|DOCX|XLSX|PPTX?)\s*(?:文件)?[^。\n]*[。\n]?/gi, '')
    .replace(/你可以(?:直接)?将(?:以上|下面这份|下方这份)?[^。\n]*(?:另存为|导出为)\s*(PDF|Word|DOCX|XLSX|PPTX?)[^。\n]*[。\n]?/gi, '')
    .replace(/如果你愿意，我也可以下一步给你[^。\n]*[。\n]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (hasOfficeBinary) {
    cleaned = cleaned
      .replace(/(?:^|\n)##\s*(?:PDF|Word|DOCX|XLSX|PPTX?)\s*输出[\s\S]*$/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (!cleaned.includes(attachmentLine)) {
    cleaned = cleaned ? `${cleaned}\n\n${attachmentLine}` : attachmentLine;
  }
  return cleaned;
}

async function resolveDbUserId(jwtUserId: string): Promise<string> {
  const user = await findOrCreateUser(jwtUserId, 'web', jwtUserId);
  return user.masterUserId ?? user.id;
}

async function ensureConversationExists(conversationId: string, dbUserId: string) {
  return getOrCreateConversation(dbUserId, 'web', conversationId);
}

async function saveDocumentConversationExchange(params: {
  conversationId?: string;
  jwtUserId: string;
  fileName: string;
  userText: string;
  assistantText: string;
  metadata: Record<string, unknown>;
}) {
  if (!params.conversationId) return;

  const dbUserId = await resolveDbUserId(params.jwtUserId);
  await ensureConversationExists(params.conversationId, dbUserId);

  const userMessageText = params.userText.trim()
    ? `${params.userText.trim()}\n[${params.fileName}]`
    : `[${params.fileName}]`;

  await saveConversationMessage(params.conversationId, dbUserId, 'user', userMessageText, {
    _conversationId: params.conversationId,
    source: params.metadata.source ?? 'document-direct',
  });
  await saveConversationMessage(params.conversationId, dbUserId, 'assistant', params.assistantText, {
    _conversationId: params.conversationId,
    ...params.metadata,
  });
}

async function getConversationDocumentContext(conversationId: string, dbUserId: string): Promise<null | {
  fileName: string;
  mimeType?: string;
  artifactPath?: string;
  cachedText?: string;
  lastAction?: DocumentOutputAction;
  lastUserRequest?: string;
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
    lastAction: doc.lastAction === 'translation' || doc.lastAction === 'summary' || doc.lastAction === 'rewrite' || doc.lastAction === 'analysis' || doc.lastAction === 'result'
      ? doc.lastAction
      : undefined,
    lastUserRequest: typeof doc.lastUserRequest === 'string' ? doc.lastUserRequest : undefined,
  };
}

async function resolveConversationDocumentText(context: {
  artifactPath?: string;
  cachedText?: string;
}): Promise<string> {
  if (context.artifactPath && existsSync(context.artifactPath)) {
    return extractText(context.artifactPath);
  }
  if (context.cachedText?.trim()) return context.cachedText;
  return '';
}

async function persistConversationDocumentContext(params: {
  conversationId?: string;
  dbUserId?: string;
  fileName: string;
  mimeType?: string;
  artifactPath?: string;
  cachedText?: string;
  userText: string;
  previousAction?: DocumentOutputAction;
  previousRequest?: string;
}) {
  if (!params.conversationId || !params.dbUserId) return;
  const lastAction = resolveDocumentOutputAction(params.userText, params.previousAction);
  const lastUserRequest = buildResolvedDocumentRequest(
    params.userText,
    params.fileName,
    lastAction,
    params.previousRequest,
  );

  await mergeConversationMetadataForUser(params.conversationId, params.dbUserId, {
    lastDocumentContext: {
      fileName: params.fileName,
      mimeType: params.mimeType,
      artifactPath: params.artifactPath,
      cachedText: params.cachedText?.slice(0, 20000),
      lastAction,
      lastUserRequest,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function processDocumentDirect(
  engine: Engine,
  params: {
    userText: string;
    fileName: string;
    documentText: string;
    model?: string;
  }
): Promise<{
  message: string;
  thinking?: string;
  provider: string;
  model?: string;
  tokens?: { input: number; output: number };
}> {
  const trimmedDocument = params.documentText.trim();
  if (!trimmedDocument) {
    return {
      message: `已收到文件《${params.fileName}》，但当前未提取到可用正文。`,
      provider: 'local',
      model: 'local-document-fallback',
    };
  }

  const userRequest = params.userText.trim() || `请总结这份文档《${params.fileName}》的主要内容。`;
  const outputHint = /\b(xlsx|excel|spreadsheet|csv)\b|表格|报价单|清单/.test(userRequest.toLowerCase())
    ? '如果用户要求 Excel、CSV、报价单或表格输出，请优先把结果整理成规范 Markdown 表格，表头清晰，便于后续导出为电子表格。'
    : /\b(docx|word)\b|word文档|word文件/.test(userRequest.toLowerCase())
      ? '如果用户要求 Word 文档输出，请尽量使用清晰标题、分段和项目符号，便于直接生成 DOCX。'
      : /\b(pptx|ppt|powerpoint|slides?)\b|演示文稿|幻灯片|汇报/.test(userRequest.toLowerCase())
        ? '如果用户要求 PowerPoint 输出，请按“标题 + 要点列表”的结构组织内容，便于直接生成 PPTX。'
        : '请优先使用清晰标题、分段和列表结构，便于后续生成办公文件。';
  const promptText = [
    `文档文件名：${params.fileName}`,
    `用户请求：${userRequest}`,
    '',
    '--- 文档正文开始 ---',
    trimmedDocument.slice(0, 50000),
    '--- 文档正文结束 ---',
  ].join('\n');

  const response = await engine.getAIClient().chat({
    systemPrompt: [
      '你是 a4claw 的文档处理助手。',
      '严格基于用户提供的文档正文完成任务，不要脱离文档臆测。',
      '默认直接给最终结果，不要写“目标、步骤、信息缺口、下一步建议”这类任务模板。',
      '如果用户要求翻译成中文，则完整翻译当前提供的正文，并尽量保留原有标题、编号、列表和段落结构。',
      '如果用户要求总结、分析、提取要点或整理内容，则默认用中文回答，结构清晰，直接给结果。',
      outputHint,
      '如果当前提供的正文可能被截断，请明确说明回答是基于已提取内容。',
    ].join('\n'),
    messages: [{ role: 'user', content: promptText }],
    maxTokens: 8000,
    temperature: 0.2,
    model: params.model && params.model !== 'auto' ? params.model : undefined,
  });

  return {
    message: response.content,
    thinking: response.thinking,
    provider: response.provider,
    model: response.modelUsed,
    tokens: {
      input: response.usage.inputTokens,
      output: response.usage.outputTokens,
    },
  };
}

export function setupApiRoutes(engine: Engine): Router {
  const router = Router();

  // Ensure upload directory exists
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

  // Allowed MIME types and extensions for file uploads
  const ALLOWED_MIMES = new Set([
    'text/plain', 'text/markdown', 'text/csv', 'text/html',
    'application/pdf', 'application/json', 'application/rtf', 'text/rtf', 'application/xml', 'text/xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/msword', // doc
    'application/vnd.ms-excel', // xls
    'application/vnd.ms-powerpoint', // ppt
    'application/vnd.oasis.opendocument.text', // odt
    'application/vnd.oasis.opendocument.spreadsheet', // ods
    'application/vnd.oasis.opendocument.presentation', // odp
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  ]);
  const ALLOWED_EXTS = new Set([...SUPPORTED_DOCUMENT_EXTENSIONS, 'jpg', 'jpeg', 'png', 'gif', 'webp']);

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
    const interactionMode = req.body.interactionMode === 'chat' || req.body.interactionMode === 'task'
      ? req.body.interactionMode
      : undefined;
    const file = (req as any).file as Express.Multer.File | undefined;

    let attachments: Array<{ type: string; url: string }> | undefined;
    let enrichedText = text;
    let renamedFilePath: string | undefined;
    let uploadedArtifact: any | undefined;
    let extractedDocumentText = '';
    let activeDocumentFileName: string | undefined;
    let dbUserId: string | undefined;
    let previousDocumentAction: DocumentOutputAction | undefined;
    let previousDocumentRequest: string | undefined;
    let resolvedDocumentAction: DocumentOutputAction = 'result';
    let resolvedDocumentRequest = text || '';

    try {
      logger.info('Chat API request', {
        requestId,
        userId: user?.userId,
        conversationId: conversationId ?? null,
        hasFile: !!file,
        textLength: typeof text === 'string' ? text.length : 0,
        responseMode: responseMode ?? 'auto',
        model: model ?? 'auto',
        interactionMode: interactionMode ?? 'chat',
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
          activeDocumentFileName = file.originalname;

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
            extractedDocumentText = typeof result.text === 'string' ? result.text : '';
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
            await ensureConversationExists(conversationId, dbUserId);
            const existingContext = await getConversationDocumentContext(conversationId, dbUserId);
            previousDocumentAction = existingContext?.lastAction;
            previousDocumentRequest = existingContext?.lastUserRequest;
            await persistConversationDocumentContext({
              conversationId,
              dbUserId,
              fileName: file.originalname,
              mimeType: file.mimetype,
              artifactPath: uploadedArtifact?.path,
              cachedText: extractedDocumentText,
              userText: text,
              previousAction: previousDocumentAction,
              previousRequest: previousDocumentRequest,
            });
          } catch (contextErr: any) {
            logger.warn('Failed to persist conversation document context', {
              userId: user.userId,
              conversationId,
              error: contextErr.message,
            });
          }
        }
      } else if (conversationId && (interactionMode === 'task' || shouldReuseConversationDocumentContext(text))) {
        try {
          const dbUserId = await resolveDbUserId(user.userId);
          const documentContext = await getConversationDocumentContext(conversationId, dbUserId);
          if (documentContext) {
            previousDocumentAction = documentContext.lastAction;
            previousDocumentRequest = documentContext.lastUserRequest;
            const documentText = await resolveConversationDocumentText(documentContext);
            if (documentText.trim()) {
              activeDocumentFileName = documentContext.fileName;
              extractedDocumentText = documentText;
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

      if (conversationId) {
        dbUserId = await resolveDbUserId(user.userId);
        await ensureConversationExists(conversationId, dbUserId);
      }

      resolvedDocumentAction = resolveDocumentOutputAction(text || '', previousDocumentAction);
      resolvedDocumentRequest = activeDocumentFileName
        ? buildResolvedDocumentRequest(text || '', activeDocumentFileName, resolvedDocumentAction, previousDocumentRequest)
        : (text || '');
      const shouldHandleDocumentDirectly =
        Boolean(activeDocumentFileName)
        && Boolean(extractedDocumentText.trim())
        && (
          Boolean(file)
          || interactionMode === 'task'
          || isDocumentDirectRequest(text || '')
          || shouldReuseConversationDocumentContext(text || '')
        );

      if (activeDocumentFileName && extractedDocumentText.trim() && shouldHandleDocumentDirectly) {
        try {
          const direct = await processDocumentDirect(engine, {
            userText: resolvedDocumentRequest,
            fileName: activeDocumentFileName,
            documentText: extractedDocumentText,
            model,
          });

          let generatedArtifacts: any[] = [];
          let artifactPlan: Record<string, unknown> | undefined;
          try {
            const generated = await createDocumentArtifacts({
              userId: user.userId,
              fileName: activeDocumentFileName,
              userText: resolvedDocumentRequest,
              content: direct.message,
            });
            generatedArtifacts = generated.artifacts;
            artifactPlan = generated.artifactPlan;
          } catch (artifactErr: any) {
            logger.warn('Failed to generate document result artifact', {
              requestId,
                userId: user.userId,
                fileName: activeDocumentFileName,
                error: artifactErr.message,
              });
          }

          const responseArtifacts = [...generatedArtifacts, uploadedArtifact].filter(Boolean);
          const finalMessage = sanitizeDocumentMessageWithArtifacts(direct.message, responseArtifacts);

          if (conversationId && dbUserId) {
            await persistConversationDocumentContext({
              conversationId,
              dbUserId,
              fileName: activeDocumentFileName,
              mimeType: file?.mimetype,
              artifactPath: uploadedArtifact?.path,
              cachedText: extractedDocumentText,
              userText: resolvedDocumentRequest,
              previousAction: previousDocumentAction,
              previousRequest: previousDocumentRequest,
            });
            await saveDocumentConversationExchange({
              conversationId,
              jwtUserId: user.userId,
              fileName: activeDocumentFileName,
              userText: resolvedDocumentRequest,
              assistantText: finalMessage,
              metadata: {
                agent: 'document-direct',
                provider: direct.provider,
                model: direct.model,
                tokens: direct.tokens,
                artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
                artifactPlan,
                source: 'document-direct',
              },
            });
          }

          res.json({
            message: finalMessage,
            thinking: direct.thinking,
            artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
            agent: 'document-direct',
            provider: direct.provider,
            model: direct.model,
            tokens: direct.tokens,
            artifactPlan,
          });
          return;
        } catch (directErr: any) {
          logger.warn('Direct document processing failed, falling back to engine', {
            requestId,
            userId: user?.userId,
            conversationId: conversationId ?? null,
            action: resolvedDocumentAction,
            error: directErr.message,
          });
        }
      }

      if (file && extractedDocumentText.trim() && isDocumentSummaryRequest(resolvedDocumentRequest || text || '')) {
        const fallbackMessage = buildLocalDocumentFallback(
          resolvedDocumentRequest,
          file.originalname,
          extractedDocumentText,
          previousDocumentAction,
          previousDocumentRequest,
        );
        const responseArtifacts = [];
        let artifactPlan: Record<string, unknown> | undefined;
        try {
          const generated = await createDocumentArtifacts({
            userId: user.userId,
            fileName: file.originalname,
            userText: resolvedDocumentRequest,
            content: fallbackMessage,
          });
          responseArtifacts.push(...generated.artifacts);
          artifactPlan = generated.artifactPlan;
        } catch (artifactErr: any) {
          logger.warn('Failed to generate fallback document artifact', {
            requestId,
            userId: user.userId,
            fileName: file.originalname,
            error: artifactErr.message,
          });
        }
        if (uploadedArtifact) responseArtifacts.push(uploadedArtifact);
        try {
          if (conversationId && dbUserId) {
            await persistConversationDocumentContext({
              conversationId,
              dbUserId,
              fileName: file.originalname,
              mimeType: file.mimetype,
              artifactPath: uploadedArtifact?.path,
              cachedText: extractedDocumentText,
              userText: resolvedDocumentRequest,
              previousAction: previousDocumentAction,
              previousRequest: previousDocumentRequest,
            });
          }
          await saveDocumentConversationExchange({
            conversationId,
            jwtUserId: user.userId,
            fileName: file.originalname,
            userText: resolvedDocumentRequest,
            assistantText: fallbackMessage,
            metadata: {
              agent: 'document-fallback',
              provider: 'local',
              model: 'local-document-fallback',
              artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
              artifactPlan,
              source: 'document-fallback',
            },
          });
        } catch (saveErr: any) {
          logger.warn('Failed to persist fallback document conversation', {
            requestId,
            userId: user.userId,
            conversationId: conversationId ?? null,
            error: saveErr.message,
          });
        }
        res.json({
          message: fallbackMessage,
          artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
          artifactPlan,
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
        interactionMode,
      });

      const shouldUseLocalFallback =
        Boolean(file)
        && Boolean(extractedDocumentText.trim())
        && looksLikeModelFailure(response.text);

      if (shouldUseLocalFallback) {
        const fallbackMessage = buildLocalDocumentFallback(
          resolvedDocumentRequest,
          file!.originalname,
          extractedDocumentText,
          previousDocumentAction,
          previousDocumentRequest,
        );
        const responseArtifacts = [];
        let artifactPlan: Record<string, unknown> | undefined;
        try {
          const generated = await createDocumentArtifacts({
            userId: user.userId,
            fileName: file!.originalname,
            userText: resolvedDocumentRequest,
            content: fallbackMessage,
          });
          responseArtifacts.push(...generated.artifacts);
          artifactPlan = generated.artifactPlan;
        } catch (artifactErr: any) {
          logger.warn('Failed to generate fallback artifact after model failure', {
            requestId,
            userId: user.userId,
            fileName: file!.originalname,
            error: artifactErr.message,
          });
        }
        if (uploadedArtifact) responseArtifacts.push(uploadedArtifact);
        try {
          if (conversationId && dbUserId) {
            await persistConversationDocumentContext({
              conversationId,
              dbUserId,
              fileName: file!.originalname,
              mimeType: file!.mimetype,
              artifactPath: uploadedArtifact?.path,
              cachedText: extractedDocumentText,
              userText: resolvedDocumentRequest,
              previousAction: previousDocumentAction,
              previousRequest: previousDocumentRequest,
            });
          }
          await saveDocumentConversationExchange({
            conversationId,
            jwtUserId: user.userId,
            fileName: file!.originalname,
            userText: resolvedDocumentRequest,
            assistantText: fallbackMessage,
            metadata: {
              agent: 'document-fallback',
              provider: 'local',
              model: 'local-document-fallback',
              artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
              artifactPlan,
              source: 'document-fallback',
            },
          });
        } catch (saveErr: any) {
          logger.warn('Failed to persist local fallback after model failure', {
            requestId,
            userId: user.userId,
            conversationId: conversationId ?? null,
            error: saveErr.message,
          });
        }
        res.json({
          message: fallbackMessage,
          thinking: response.thinking,
          artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
          artifactPlan,
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
        skillUsed: response.skillUsed,
        pluginUsed: response.pluginUsed,
        executionPath: response.executionPath,
        memoryHits: response.memoryHits,
        routePlan: response.routePlan,
        routingReason: response.routingReason,
        requiredCapabilities: response.requiredCapabilities,
        artifactPlan: response.artifactPlan,
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
        const fallbackMessage = buildLocalDocumentFallback(
          resolvedDocumentRequest || text,
          file.originalname,
          extractedDocumentText,
          previousDocumentAction,
          previousDocumentRequest,
        );
        const responseArtifacts = [];
        let artifactPlan: Record<string, unknown> | undefined;
        try {
          const generated = await createDocumentArtifacts({
            userId: user.userId,
            fileName: file.originalname,
            userText: resolvedDocumentRequest || text,
            content: fallbackMessage,
          });
          responseArtifacts.push(...generated.artifacts);
          artifactPlan = generated.artifactPlan;
        } catch (artifactErr: any) {
          logger.warn('Failed to generate document artifact in error fallback', {
            requestId,
            userId: user.userId,
            fileName: file.originalname,
            error: artifactErr.message,
          });
        }
        if (uploadedArtifact) responseArtifacts.push(uploadedArtifact);
        try {
          if (conversationId && dbUserId) {
            await persistConversationDocumentContext({
              conversationId,
              dbUserId,
              fileName: file.originalname,
              mimeType: file.mimetype,
              artifactPath: uploadedArtifact?.path,
              cachedText: extractedDocumentText,
              userText: resolvedDocumentRequest || text,
              previousAction: previousDocumentAction,
              previousRequest: previousDocumentRequest,
            });
          }
          await saveDocumentConversationExchange({
            conversationId,
            jwtUserId: user.userId,
            fileName: file.originalname,
            userText: resolvedDocumentRequest || text,
            assistantText: fallbackMessage,
            metadata: {
              agent: 'document-fallback',
              provider: 'local',
              model: 'local-document-fallback',
              artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
              artifactPlan,
              source: 'document-fallback',
            },
          });
        } catch (saveErr: any) {
          logger.warn('Failed to persist error fallback document conversation', {
            requestId,
            userId: user.userId,
            conversationId: conversationId ?? null,
            error: saveErr.message,
          });
        }
        res.status(200).json({
          message: fallbackMessage,
          artifacts: responseArtifacts.length > 0 ? responseArtifacts : undefined,
          agent: 'document-fallback',
          provider: 'local',
          model: 'local-document-fallback',
          artifactPlan,
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
