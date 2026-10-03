// Original winged gold charm with an emerald core. No imported game artwork.
export const totemIcon = () => '<svg viewBox="0 0 32 32" aria-hidden="true" shape-rendering="crispEdges"><path fill="#65432a" d="M12 1h8v3h4v9h7v7h-7v5h-4v6h-8v-6H8v-5H1v-7h7V4h4z"/><path fill="#d39e42" d="M12 4h8v3h2v16h-4v5h-4v-5h-4V7h2zM3 15h7v3H3zM22 15h7v3h-7z"/><path fill="#ffe59a" d="M12 6h8v3h-8zM4 15h5v2H4zM23 15h5v2h-5zM12 21h8v2h-8z"/><path fill="#185d56" d="M14 10h4v3h3v6h-3v2h-4v-2h-3v-6h3z"/><path fill="#64e8bf" d="M14 12h4v3h2v2h-2v2h-4v-2h-2v-2h2z"/><path fill="#e2fff0" d="M14 12h3v3h-3z"/></svg>';

export const totemNotice = () => `<div class="totem-activation" role="status" aria-live="polite">${totemIcon()}<strong>Totem saved you</strong><span>Two hearts · Totem consumed</span></div>`;
