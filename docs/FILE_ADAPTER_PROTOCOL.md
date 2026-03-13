# File Adapter Protocol

## Goal

This protocol lets `a4claw` extend file parsing and file generation without changing the chat pipeline.

Two optional adapters are supported:

- `DOCUMENT_EXTRACTOR_ADAPTER_URL`
- `ARTIFACT_ADAPTER_URL`

If they are not configured, `a4claw` uses built-in handlers only.

## 1. Document Extractor Adapter

Used when a user uploads a file whose text cannot be reliably extracted by built-in logic.

Environment variables:

- `DOCUMENT_EXTRACTOR_ADAPTER_URL`
- `DOCUMENT_EXTRACTOR_ADAPTER_TIMEOUT_MS`

### Request

`POST <DOCUMENT_EXTRACTOR_ADAPTER_URL>`

```json
{
  "action": "extract",
  "fileName": "demo.cadx",
  "extension": "cadx",
  "dataBase64": "<base64 file bytes>"
}
```

### Response

```json
{
  "text": "Extracted plain text content"
}
```

Notes:

- Return plain text only.
- The adapter should do format-specific parsing itself.
- If parsing fails, return non-2xx with a short error body.

## 2. Artifact Generator Adapter

Used when a user requests an output format not covered by built-in generators.

Environment variables:

- `ARTIFACT_ADAPTER_URL`
- `ARTIFACT_ADAPTER_TIMEOUT_MS`

### Request

`POST <ARTIFACT_ADAPTER_URL>`

```json
{
  "format": "cadx-report",
  "request": {
    "fileName": "input.pdf",
    "userText": "整理成专有报告格式",
    "content": "Final generated content body",
    "userId": "user_123"
  }
}
```

### Response

Return one of these forms:

```json
{
  "filePath": "/tmp/result.cadx",
  "fileName": "result.cadx"
}
```

or

```json
{
  "dataBase64": "<base64 file bytes>",
  "fileName": "result.cadx"
}
```

Notes:

- `a4claw` will copy the file into `/data/gongxiang/<user>/...`.
- If both `filePath` and `dataBase64` are returned, `filePath` is used first.

## 3. Current Built-in Coverage

Input parsing:

- `txt md csv tsv json ts js py html htm xml yaml yml ini log sql sh rtf`
- `pdf docx doc xlsx xls ods pptx ppt odp odt`

Output generation:

- `pdf md txt json html csv xlsx docx pptx`

## 4. Operational Advice

- Keep adapters stateless.
- Do not expose them publicly unless protected.
- Prefer localhost or internal network deployment.
- Log format, duration, and failure reason.
- Keep adapter error messages short; `a4claw` already handles fallback logic.
