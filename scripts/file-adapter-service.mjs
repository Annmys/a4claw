import express from 'express';
import { readdir } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HANDLER_DIR = resolve(__dirname, '../adapters/file');

const app = express();
app.use(express.json({ limit: '50mb' }));

const handlers = new Map();

async function loadHandlers() {
  handlers.clear();
  let files = [];
  try {
    files = await readdir(HANDLER_DIR);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.endsWith('.mjs')) continue;
    const mod = await import(`${pathToFileURL(join(HANDLER_DIR, file)).href}?ts=${Date.now()}`);
    const formats = Array.isArray(mod.formats) ? mod.formats : [];
    for (const format of formats) {
      handlers.set(String(format).toLowerCase(), {
        name: mod.name || file,
        extract: typeof mod.extract === 'function' ? mod.extract : null,
        generate: typeof mod.generate === 'function' ? mod.generate : null,
      });
    }
  }
}

function getHandler(key) {
  return handlers.get(String(key || '').toLowerCase()) || null;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    handlers: Array.from(handlers.keys()).sort(),
  });
});

app.post('/extract', async (req, res) => {
  const { action, fileName, extension, dataBase64 } = req.body ?? {};
  if (action !== 'extract') {
    res.status(400).json({ error: 'unsupported action' });
    return;
  }

  const handler = getHandler(extension);
  if (!handler?.extract) {
    res.status(404).json({ error: `no extractor for .${extension || 'unknown'}` });
    return;
  }

  try {
    const text = await handler.extract({
      fileName,
      extension,
      buffer: Buffer.from(String(dataBase64 || ''), 'base64'),
      body: req.body,
    });
    res.json({ text: String(text ?? '') });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'extract failed' });
  }
});

app.post('/generate', async (req, res) => {
  const { format, request } = req.body ?? {};
  const handler = getHandler(format);
  if (!handler?.generate) {
    res.status(404).json({ error: `no generator for ${format || 'unknown'}` });
    return;
  }

  try {
    const result = await handler.generate(request ?? {});
    if (result?.filePath || result?.dataBase64) {
      res.json(result);
      return;
    }
    if (result?.buffer) {
      res.json({
        fileName: result.fileName || `output.${format}`,
        dataBase64: Buffer.from(result.buffer).toString('base64'),
      });
      return;
    }
    res.status(500).json({ error: 'generator returned no file payload' });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'generate failed' });
  }
});

const port = Number(process.env.PORT || 18901);

await loadHandlers();
app.listen(port, '127.0.0.1', () => {
  console.log(`file adapter service listening on http://127.0.0.1:${port}`);
  console.log(`handler dir: ${HANDLER_DIR}`);
  console.log(`loaded handlers: ${Array.from(handlers.keys()).sort().join(', ') || '(none)'}`);
});
