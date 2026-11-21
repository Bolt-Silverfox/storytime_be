export function isThrowawayDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return false;
  }
  if (!['', 'localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    return false;
  }
  if (parsed.searchParams.has('host') || parsed.searchParams.has('dbname')) {
    return false;
  }
  const match = /^\/([^/]+)$/.exec(parsed.pathname);
  if (!match) return false;
  const name = match[1];
  return (
    name === 'throwaway' ||
    name.endsWith('_throwaway') ||
    name.endsWith('_test')
  );
}
