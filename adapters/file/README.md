# File Adapter Handlers

Drop a `.mjs` file here to extend the local file adapter service.

Each handler module should export:

```js
export const name = 'my-handler';
export const formats = ['ext1', 'ext2'];

export async function extract({ fileName, extension, buffer, body }) {
  return 'plain text';
}

export async function generate(request) {
  return {
    fileName: 'output.ext1',
    dataBase64: Buffer.from('content').toString('base64'),
  };
}
```

`extract` and `generate` are both optional, but at least one should exist.
