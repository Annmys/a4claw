import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export async function extractText(filePath: string): Promise<string> {
  const ext = filePath.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv':
    case 'json':
    case 'ts':
    case 'js':
    case 'py':
      return readFile(filePath, 'utf-8');

    case 'pdf': {
      try {
        const pdfMod = await import('pdf-parse');
        const pdfParse = (pdfMod as any).default ?? pdfMod;
        const buffer = await readFile(filePath);
        const data = await pdfParse(buffer);
        return data.text;
      } catch (err: any) {
        logger.warn('pdf-parse failed', { error: err.message });
        try {
          const { stdout } = await execFileAsync('pdftotext', [filePath, '-']);
          const text = stdout?.trim();
          if (text) return text;
        } catch (cliErr: any) {
          logger.warn('pdftotext fallback failed', { error: cliErr.message });
        }
        throw new Error('Cannot extract text from PDF.');
      }
    }

    case 'docx': {
      const mammoth = await import('mammoth');
      const buffer = await readFile(filePath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    case 'xlsx':
    case 'xls': {
      const XLSX = await import('xlsx');
      const buffer = await readFile(filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const texts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        texts.push(`## Sheet: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`);
      }
      return texts.join('\n\n');
    }

    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
