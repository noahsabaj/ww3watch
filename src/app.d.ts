// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
/// <reference types="vite-plugin-pwa/client" />
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}

		// Shallow-routing state for the reader panel. The panel is open iff
		// articleId is set, so browser Back closes it for free. Kept to plain ids
		// (page.state is devalue-serialized into history) — the Article itself is
		// resolved from the in-memory feed, or fetched on demand for a deep link.
		// storyId rides along only when the URL is a ?story= link, so closing can
		// restore the same URL shape the visitor arrived on.
		interface PageState {
			articleId?: string
			storyId?: string
		}
	}

	interface BeforeInstallPromptEvent extends Event {
		prompt(): Promise<void>
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
	}
}

export {};
