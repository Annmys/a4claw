import { randomUUID } from 'crypto';
import { basename, extname } from 'path';
import { readFile, unlink, writeFile } from 'fs/promises';
import config from '../config.js';
import logger from '../utils/logger.js';
import { publishFileToUserShare, type ChatArtifact } from './shared-artifacts.js';

export type OfficeArtifactFormat =
  | 'pdf'
  | 'md'
  | 'txt'
  | 'json'
  | 'html'
  | 'csv'
  | 'xlsx'
  | 'docx'
  | 'pptx';

export interface DocumentArtifactRequest {
  userId: string;
  fileName: string;
  userText: string;
  content: string;
}

export interface ArtifactGenerationPlan {
  requestedFormats: string[];
  generatedFormats: string[];
  unresolvedFormats: string[];
  primaryFormat: string;
  extensionMode: 'builtin-only' | 'external-fallback' | 'external-only';
  rationale: string;
}

export interface ArtifactGenerationResult {
  artifacts: ChatArtifact[];
  plan: ArtifactGenerationPlan;
}

interface ArtifactGenerator {
  format: OfficeArtifactFormat;
  generate: (targetPath: string, title: string, body: string) => Promise<void>;
}

const DOCUMENT_PDF_FONT_PATH = '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf';
const builtInGenerators = new Map<OfficeArtifactFormat, ArtifactGenerator>();

function sanitizeStem(input: string): string {
  return basename(input, extname(input))
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'document';
}

function normalizeText(input: string): string {
  return input.replace(/\r/g, '').trim();
}

function classifyOutputSuffix(text: string): string {
  const normalized = text.trim().toLowerCase();
  if (/翻译|translate|translation|译成|译为|中文|英文/.test(normalized)) return 'translated';
  if (/总结|摘要|概括|summary|summar|提炼|要点/.test(normalized)) return 'summary';
  if (/改写|重写|rewrite|润色|整理|排版|编辑/.test(normalized)) return 'rewritten';
  if (/分析|analysis|解释|问答|qa|q&a|校对/.test(normalized)) return 'analysis';
  if (/报价|quote|报价单|清单|表格|excel|spreadsheet/.test(normalized)) return 'sheet';
  if (/演示|汇报|powerpoint|ppt|slides|presentation/.test(normalized)) return 'slides';
  return 'result';
}

function buildArtifactBody(fileName: string, userText: string, content: string): string {
  const requestLine = userText.trim() || '自动处理文档';
  return [
    `文件名：${fileName}`,
    `处理要求：${requestLine}`,
    `生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    content.trim(),
  ].join('\n');
}

function detectRequestedFormats(userText: string, fileName: string): string[] {
  const normalized = userText.toLowerCase();
  const requested = new Set<string>();
  if (/\b(docx|word)\b|word文档|word文件|docx|文档版/.test(normalized)) requested.add('docx');
  if (/\b(pptx|ppt|powerpoint|slides?)\b|幻灯片|演示文稿|汇报稿/.test(normalized)) requested.add('pptx');
  if (/\b(xlsx|excel|spreadsheet)\b|表格|报价单|清单|excel/.test(normalized)) requested.add('xlsx');
  if (/\bcsv\b|逗号分隔/.test(normalized)) requested.add('csv');
  if (/\bmarkdown\b|\.md\b|md格式|markdown格式/.test(normalized)) requested.add('md');
  if (/\btxt\b|纯文本|text file/.test(normalized)) requested.add('txt');
  if (/\bjson\b|json格式/.test(normalized)) requested.add('json');
  if (/\bhtml\b|网页格式|web page/.test(normalized)) requested.add('html');
  if (/\bpdf\b|pdf格式|pdf文件/.test(normalized)) requested.add('pdf');

  if (requested.size > 0) return Array.from(requested);

  const sourceExt = extname(fileName).toLowerCase();
  if (sourceExt === '.xlsx' || sourceExt === '.xls' || /报价|清单|表格/.test(userText)) return ['xlsx'];
  if (sourceExt === '.pptx' || sourceExt === '.ppt') return ['pptx'];
  if (sourceExt === '.docx' || sourceExt === '.doc') return ['docx'];
  return ['pdf'];
}

function splitParagraphs(body: string): string[] {
  return normalizeText(body)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function extractMarkdownTable(text: string): string[][] | null {
  const lines = normalizeText(text).split('\n');
  const tableLines = lines.filter((line) => line.includes('|'));
  if (tableLines.length < 2) return null;

  const rows = tableLines
    .map((line) => line.trim())
    .filter((line) => /^\|?.+\|.+\|?$/.test(line))
    .map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));

  if (rows.length < 2) return null;
  const separatorIndex = rows.findIndex((row) => row.every((cell) => /^:?-{2,}:?$/.test(cell)));
  if (separatorIndex !== 1) return null;

  const header = rows[0];
  const dataRows = rows.slice(2).filter((row) => row.some((cell) => cell));
  if (header.length === 0 || dataRows.length === 0) return null;
  return [header, ...dataRows];
}

function extractKeyValueRows(text: string): string[][] | null {
  const lines = normalizeText(text).split('\n').filter(Boolean);
  const rows = lines
    .map((line) => line.replace(/^[\-\*\d.、\s]+/, '').trim())
    .map((line) => {
      const idx = Math.max(line.indexOf('：'), line.indexOf(':'));
      if (idx <= 0) return null;
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
    .filter((row): row is string[] => Array.isArray(row) && row.length === 2 && Boolean(row[0]) && Boolean(row[1]));
  if (rows.length < 2) return null;
  return [['字段', '内容'], ...rows];
}

function extractRowsForSheet(text: string): string[][] {
  return extractMarkdownTable(text)
    ?? extractKeyValueRows(text)
    ?? [['行号', '内容'], ...normalizeText(text).split('\n').filter(Boolean).map((line, index) => [String(index + 1), line.trim()])];
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  if (current.trim() || text.endsWith(' ')) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [''];
}

async function generatePdf(targetPath: string, title: string, body: string): Promise<void> {
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
  page.drawText(title, { x: marginX, y: cursorY, size: titleSize, font, color: rgb(0.1, 0.1, 0.1) });
  cursorY -= titleLineHeight;

  for (const paragraph of body.split('\n')) {
    const lines = wrapPdfLine(paragraph, maxWidth, (line) => font.widthOfTextAtSize(line, textSize));
    for (const line of lines) {
      ensureSpace(textLineHeight);
      page.drawText(line || ' ', { x: marginX, y: cursorY, size: textSize, font, color: rgb(0.16, 0.16, 0.16) });
      cursorY -= textLineHeight;
    }
  }

  const bytes = await pdfDoc.save();
  await writeFile(targetPath, bytes);
}

async function generateMarkdown(targetPath: string, title: string, body: string): Promise<void> {
  const content = [`# ${title}`, '', body].join('\n');
  await writeFile(targetPath, content, 'utf-8');
}

async function generateText(targetPath: string, title: string, body: string): Promise<void> {
  await writeFile(targetPath, `${title}\n\n${body}`, 'utf-8');
}

async function generateJson(targetPath: string, title: string, body: string): Promise<void> {
  let content: unknown = {
    title,
    body,
    generatedAt: new Date().toISOString(),
  };
  try {
    content = JSON.parse(body);
  } catch {}
  await writeFile(targetPath, JSON.stringify(content, null, 2), 'utf-8');
}

async function generateHtml(targetPath: string, title: string, body: string): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; margin: 40px; color: #111827; line-height: 1.7; }
    h1 { font-size: 28px; margin-bottom: 24px; }
    pre { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(body)}</pre>
</body>
</html>`;
  await writeFile(targetPath, html, 'utf-8');
}

async function generateCsv(targetPath: string, _title: string, body: string): Promise<void> {
  const rows = extractRowsForSheet(body);
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  await writeFile(targetPath, csv, 'utf-8');
}

async function generateXlsx(targetPath: string, title: string, body: string): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = extractRowsForSheet(body);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Result');
  const metaSheet = XLSX.utils.aoa_to_sheet([
    ['Title', title],
    ['Generated At', new Date().toISOString()],
  ]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, 'Meta');
  XLSX.writeFile(workbook, targetPath);
}

async function generateDocx(targetPath: string, title: string, body: string): Promise<void> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    ...splitParagraphs(body).flatMap((block) => {
      const lines = block.split('\n').filter(Boolean);
      if (lines.length === 0) return [];
      return lines.map((line, index) => {
        const trimmed = line.trim();
        if (/^#{1,6}\s+/.test(trimmed)) {
          return new Paragraph({
            text: trimmed.replace(/^#{1,6}\s+/, ''),
            heading: HeadingLevel.HEADING_1,
          });
        }
        if (/^[\-\*\d.、]/.test(trimmed)) {
          return new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun(trimmed.replace(/^[\-\*\d.、\s]+/, ''))],
          });
        }
        return new Paragraph({ text: trimmed, spacing: { after: index === lines.length - 1 ? 180 : 80 } });
      });
    }),
  ];
  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);
  await writeFile(targetPath, buffer);
}

async function generatePptx(targetPath: string, title: string, body: string): Promise<void> {
  const pptxMod = await import('pptxgenjs');
  const PptxGenJS = (pptxMod as any).default ?? pptxMod;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'a4claw';
  pptx.subject = title;
  pptx.title = title;
  pptx.lang = 'zh-CN';

  const intro = pptx.addSlide();
  intro.addText(title, { x: 0.6, y: 0.5, w: 12.0, h: 0.7, fontSize: 24, bold: true, color: '1F2937' });
  intro.addText(`生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`, {
    x: 0.6, y: 1.4, w: 8.5, h: 0.4, fontSize: 11, color: '4B5563',
  });

  const sections = splitParagraphs(body);
  const chunks = sections.length > 0 ? sections : [body];
  for (const chunk of chunks) {
    const slide = pptx.addSlide();
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.replace(/^#{1,6}\s+/, '') || title;
    const bullets = lines.slice(1).map((line) => ({ text: line.replace(/^[\-\*\d.、\s]+/, '') }));
    slide.addText(heading, { x: 0.6, y: 0.4, w: 12.0, h: 0.5, fontSize: 20, bold: true, color: '111827' });
    slide.addText(bullets.length > 0 ? bullets : [{ text: heading }], {
      x: 0.8, y: 1.2, w: 11.4, h: 5.4, fontSize: 16, color: '374151', breakLine: false, bullet: { indent: 16 },
      valign: 'top', margin: 0.08,
    });
  }

  await pptx.writeFile({ fileName: targetPath });
}

function registerBuiltInGenerator(format: OfficeArtifactFormat, generate: ArtifactGenerator['generate']): void {
  builtInGenerators.set(format, { format, generate });
}

registerBuiltInGenerator('pdf', generatePdf);
registerBuiltInGenerator('md', generateMarkdown);
registerBuiltInGenerator('txt', generateText);
registerBuiltInGenerator('json', generateJson);
registerBuiltInGenerator('html', generateHtml);
registerBuiltInGenerator('csv', generateCsv);
registerBuiltInGenerator('xlsx', generateXlsx);
registerBuiltInGenerator('docx', generateDocx);
registerBuiltInGenerator('pptx', generatePptx);

export function registerArtifactGenerator(format: OfficeArtifactFormat, generate: ArtifactGenerator['generate']): void {
  registerBuiltInGenerator(format, generate);
}

export function getArtifactGeneratorFormats(): string[] {
  return Array.from(builtInGenerators.keys());
}

async function generateViaExternalAdapter(format: string, params: DocumentArtifactRequest, body: string): Promise<ChatArtifact | null> {
  if (!config.ARTIFACT_ADAPTER_URL) return null;

  const response = await fetch(config.ARTIFACT_ADAPTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format,
      request: {
        fileName: params.fileName,
        userText: params.userText,
        content: body,
        userId: params.userId,
      },
    }),
    signal: AbortSignal.timeout(config.ARTIFACT_ADAPTER_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Artifact adapter ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json() as {
    filePath?: string;
    fileName?: string;
    dataBase64?: string;
  };

  if (payload.filePath) {
    return publishFileToUserShare(payload.filePath, params.userId, payload.fileName || `${sanitizeStem(params.fileName)}.${format}`);
  }

  if (payload.dataBase64) {
    const tmpPath = `/tmp/${randomUUID()}-${sanitizeStem(params.fileName)}.${format}`;
    await writeFile(tmpPath, Buffer.from(payload.dataBase64, 'base64'));
    try {
      return await publishFileToUserShare(tmpPath, params.userId, payload.fileName || `${sanitizeStem(params.fileName)}.${format}`);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  return null;
}

export async function createDocumentResultArtifacts(params: DocumentArtifactRequest): Promise<ArtifactGenerationResult> {
  const requestedFormats = detectRequestedFormats(params.userText, params.fileName);
  const body = buildArtifactBody(params.fileName, params.userText, params.content);
  const title = `${sanitizeStem(params.fileName)}-${classifyOutputSuffix(params.userText)}`;
  const artifacts: ChatArtifact[] = [];
  const generatedFormats: string[] = [];
  const unresolvedFormats: string[] = [];
  let usedExternal = false;

  for (const format of requestedFormats) {
    const builtIn = builtInGenerators.get(format as OfficeArtifactFormat);
    if (builtIn) {
      const tmpPath = `/tmp/${randomUUID()}-${title}.${format}`;
      try {
        await builtIn.generate(tmpPath, title, body);
        const artifact = await publishFileToUserShare(tmpPath, params.userId, `${title}.${format}`);
        artifacts.push(artifact);
        generatedFormats.push(format);
      } catch (error: any) {
        logger.warn('Built-in artifact generation failed', {
          format,
          fileName: params.fileName,
          error: error.message,
        });
        unresolvedFormats.push(format);
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
      continue;
    }

    try {
      const artifact = await generateViaExternalAdapter(format, params, body);
      if (artifact) {
        artifacts.push(artifact);
        generatedFormats.push(format);
        usedExternal = true;
      } else {
        unresolvedFormats.push(format);
      }
    } catch (error: any) {
      logger.warn('External artifact adapter failed', {
        format,
        fileName: params.fileName,
        error: error.message,
      });
      unresolvedFormats.push(format);
    }
  }

  if (artifacts.length === 0 && !generatedFormats.includes('pdf')) {
    const fallbackPath = `/tmp/${randomUUID()}-${title}.pdf`;
    try {
      await generatePdf(fallbackPath, title, body);
      artifacts.push(await publishFileToUserShare(fallbackPath, params.userId, `${title}.pdf`));
      generatedFormats.push('pdf');
    } finally {
      await unlink(fallbackPath).catch(() => {});
    }
  }

  return {
    artifacts,
    plan: {
      requestedFormats,
      generatedFormats,
      unresolvedFormats,
      primaryFormat: generatedFormats[0] ?? 'pdf',
      extensionMode: usedExternal
        ? (generatedFormats.some((format) => builtInGenerators.has(format as OfficeArtifactFormat)) ? 'external-fallback' : 'external-only')
        : 'builtin-only',
      rationale: usedExternal
        ? '优先使用内置办公格式生成器，无法内置生成的格式回退到外部适配器。'
        : '使用内置办公格式生成器直接产出结果文件。',
    },
  };
}
