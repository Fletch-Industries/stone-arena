/** Explain SDK admission refusals without changing server guards or retrying. */
export function joinError(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not connect. Check the room code and try again.';
  const code = (error as Error & { code?: unknown }).code;
  if (code === 522) {
    // A locked arena can be at capacity OR have a competitive round underway.
    if (/^room "[^"\r\n]+" is locked$/.test(error.message)) return 'That arena is full or its round has started. Refresh open arenas, or try again after someone leaves.';
    if (/^room "[^"\r\n]+" (?:not found|has been disposed\.)$/.test(error.message)) return 'That arena is no longer available. Check the code, or refresh open arenas.';
  }
  if (code === 524 && error.message === 'reconnection token invalid or expired.') return 'Your return connection expired. Join the world or arena again.';
  // Authored break, profile, version, tab-seat and saved-world messages stay intact.
  return error.message;
}
