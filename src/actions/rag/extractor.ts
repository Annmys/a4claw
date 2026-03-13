import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import config from '../../config.js';
import logger from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

const TEXT_FILE_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'tsv', 'json', 'ts', 'js', 'py', 'html', 'htm', 'xml',
  'yaml', 'yml', 'ini', 'log', 'sql', 'sh', 'rtf',
]);

const OFFICE_FILE_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp', 'odt',
]);

const BUILT_IN_DOCUMENT_EXTENSIONS = Array.from(new Set([
  ...TEXT_FILE_EXTENSIONS,
  ...OFFICE_FILE_EXTENSIONS,
]));

export const SUPPORTED_DOCUMENT_EXTENSIONS = Array.from(new Set([
  ...BUILT_IN_DOCUMENT_EXTENSIONS,
  ...config.DOCUMENT_ADAPTER_EXTRA_EXTENSIONS,
]));

export function isSupportedDocumentExtension(ext: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext.toLowerCase());
}

function normalizeText(input: string): string {
  return input
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripMarkup(input: string): string {
  return normalizeText(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/?(?:p|div|br|li|tr|h\d|section|article|header|footer)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+\n/g, '\n'),
  );
}

function stripRtf(input: string): string {
  return normalizeText(
    input
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\tab/g, '\t')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-z]+\d* ?/g, ' ')
      .replace(/[{}]/g, ' '),
  );
}

async function extractPdf(filePath: string): Promise<string> {
  try {
    const pdfMod = await import('pdf-parse');
    const pdfParse = (pdfMod as any).default ?? pdfMod;
    const buffer = await readFile(filePath);
    const data = await pdfParse(buffer);
    return normalizeText(data.text);
  } catch (err: any) {
    logger.warn('pdf-parse failed', { error: err.message });
    try {
      const { stdout } = await execFileAsync('pdftotext', [filePath, '-']);
      const text = stdout?.trim();
      if (text) return normalizeText(text);
    } catch (cliErr: any) {
      logger.warn('pdftotext fallback failed', { error: cliErr.message });
    }
    throw new Error('Cannot extract text from PDF.');
  }
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = await readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value);
}

async function extractSpreadsheet(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const texts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    texts.push(`## Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`);
  }
  return normalizeText(texts.join('\n\n'));
}

async function extractZipXmlEntries(filePath: string, matcher: RegExp): Promise<string> {
  const { stdout: listing } = await execFileAsync('unzip', ['-Z1', filePath]);
  const entries = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => matcher.test(line));
  if (entries.length === 0) throw new Error('No extractable XML entries found');

  const parts: string[] = [];
  for (const entry of entries) {
    try {
      const { stdout } = await execFileAsync('unzip', ['-p', filePath, entry], { maxBuffer: 8 * 1024 * 1024 });
      const cleaned = stripMarkup(stdout);
      if (cleaned) parts.push(cleaned);
    } catch (error: any) {
      logger.warn('Failed to unzip XML entry', { filePath, entry, error: error.message });
    }
  }

  const merged = normalizeText(parts.join('\n\n'));
  if (!merged) throw new Error('No text extracted from zipped office document');
  return merged;
}

async function extractLegacyBinaryWithTools(filePath: string, commands: Array<[string, string[]]>): Promise<string> {
  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFileAsync(command, [...args, filePath], { maxBuffer: 8 * 1024 * 1024 });
      const cleaned = normalizeText(stdout);
      if (cleaned) return cleaned;
    } catch (error: any) {
      logger.warn('Legacy office extractor command failed', { command, filePath, error: error.message });
    }
  }
  const { stdout } = await execFileAsync('strings', ['-n', '6', filePath], { maxBuffer: 8 * 1024 * 1024 });
  const cleaned = normalizeText(stdout);
  if (cleaned) return cleaned;
  throw new Error(`Cannot extract text from ${basename(filePath)}`);
}

async function extractViaExternalAdapter(filePath: string, ext: string): Promise<string | null> {
  if (!config.DOCUMENT_EXTRACTOR_ADAPTER_URL) return null;

  const fileBuffer = await readFile(filePath);
  const response = await fetch(config.DOCUMENT_EXTRACTOR_ADAPTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'extract',
      fileName: basename(filePath),
      extension: ext,
      dataBase64: fileBuffer.toString('base64'),
    }),
    signal: AbortSignal.timeout(config.DOCUMENT_EXTRACTOR_ADAPTER_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Extractor adapter ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json() as { text?: string };
  const text = normalizeText(payload.text ?? '');
  return text || null;
}

export async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();

  try {
    if (TEXT_FILE_EXTENSIONS.has(ext)) {
      const content = await readFile(filePath, 'utf-8');
      if (ext === 'html' || ext === 'htm' || ext === 'xml') return stripMarkup(content);
      if (ext === 'rtf') return stripRtf(content);
      return normalizeText(content);
    }

    if (ext === 'pdf') return extractPdf(filePath);
    if (ext === 'docx') return extractDocx(filePath);
    if (ext === 'odt') return extractZipXmlEntries(filePath, /content\.xml$/i);
    if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') return extractSpreadsheet(filePath);
    if (ext === 'pptx' || ext === 'odp') return extractZipXmlEntries(filePath, /ppt\/slides\/slide\d+\.xml$|content\.xml$/i);
    if (ext === 'doc') return extractLegacyBinaryWithTools(filePath, [['antiword', []], ['catdoc', []]]);
    if (ext === 'ppt') return extractLegacyBinaryWithTools(filePath, [['catppt', []], ['ppttotext', []]]);
  } catch (error: any) {
    logger.warn('Built-in extractor failed, trying external adapter if configured', {
      filePath,
      ext,
      error: error.message,
    });
    const adapterText = await extractViaExternalAdapter(filePath, ext).catch((adapterError: any) => {
      logger.warn('External extractor adapter failed', { filePath, ext, error: adapterError.message });
      return null;
    });
    if (adapterText) return adapterText;
    throw error;
  }

  const adapterText = await extractViaExternalAdapter(filePath, ext).catch((adapterError: any) => {
    logger.warn('External extractor adapter failed', { filePath, ext, error: adapterError.message });
    return null;
  });
  if (adapterText) return adapterText;

  throw new Error(`Unsupported file type: .${ext}`);
}
