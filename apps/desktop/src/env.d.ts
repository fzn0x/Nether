// The build's settings the page reads, from VITE_ variables of the environment.
interface ImportMetaEnv {
  /** "on" shows sync and collaboration, which releases leave out until Phase 3 ships. */
  readonly VITE_NETHER_SYNC?: string;
  /** "web" builds the web app, which its server serves (ADR 0053); the desktop app otherwise. */
  readonly VITE_NETHER_TARGET?: string;
}
