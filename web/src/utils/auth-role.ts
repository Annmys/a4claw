export function decodeJwtRole(token: string | null): string {
  if (!token) return '';
  const parts = token.split('.');
  if (parts.length < 2) return '';
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded)) as { role?: string };
    return typeof parsed.role === 'string' ? parsed.role : '';
  } catch {
    return '';
  }
}

export function isAdminRole(token: string | null): boolean {
  return decodeJwtRole(token) === 'admin';
}
