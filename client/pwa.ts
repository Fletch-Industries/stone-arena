interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let pendingInstall: InstallPrompt | undefined;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); pendingInstall = event as InstallPrompt; });
window.addEventListener('appinstalled', () => { pendingInstall = undefined; });

// Installing or updating the worker never reloads a running match.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => { void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => console.info('Stone Arena offline launch registered.')).catch(() => console.warn('Stone Arena offline launch unavailable; online play is unaffected.')); };
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
}

export async function installGame() {
  if (pendingInstall) {
    const prompt = pendingInstall; pendingInstall = undefined;
    try { await prompt.prompt(); await prompt.userChoice; return; } catch { /* Show manual installation steps when a prompt is unavailable. */ }
  }
  const dialog = document.createElement('dialog'); dialog.className = 'install-dialog'; dialog.setAttribute('aria-labelledby', 'install-title');
  dialog.innerHTML = '<h2 id="install-title">Keep the arena close.</h2><p>Launch Stone Arena in its own window from your Dock or Home Screen.</p><ul><li><b>Mac · Safari:</b> choose File → Add to Dock (macOS Sonoma or newer).</li><li><b>Chrome or Edge:</b> use the install icon in the address bar or Install app in the browser menu.</li><li><b>iPhone or iPad:</b> tap Share → Add to Home Screen.</li></ul><p class="help">An internet connection is required to play. Open the app to create a room or join with a room code.</p><button class="btn gold wide">Got it</button>';
  document.body.append(dialog); dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
}
