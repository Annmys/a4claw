export const name = 'echo-proprietary';
export const formats = ['cadx', 'cadx-report', 'flowdoc'];

export async function extract({ fileName, extension, buffer }) {
  return [
    `适配器示例已接管文件解析：${fileName || 'unknown'}`,
    `扩展名：.${extension || 'bin'}`,
    `字节数：${buffer?.length || 0}`,
    '',
    '这是一个示例专有格式解析器，请按实际软件 SDK 或命令行工具替换这里的逻辑。',
  ].join('\n');
}

export async function generate(request) {
  const content = [
    `Proprietary format stub output`,
    `Source file: ${request?.fileName || 'unknown'}`,
    '',
    String(request?.content || ''),
  ].join('\n');

  return {
    fileName: `${String(request?.fileName || 'output').replace(/\.[^.]+$/, '')}.cadx-report`,
    dataBase64: Buffer.from(content, 'utf-8').toString('base64'),
  };
}
