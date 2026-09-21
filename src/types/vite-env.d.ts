/// <reference types="vite/client" />

/**
 * Type declarations for Vite environment variables used in this project.
 * All VITE_* variables are inlined at build time and safe to expose to the browser.
 * Do NOT add MONGODB_URI, JWT_SECRET, or ADMIN_PASSWORD here.
 */
interface ImportMetaEnv {
  /**
   * Backend API base URL.
   * - Vercel production: https://hoh-ticket-portal.onrender.com
   * - Local development: leave empty — Vite proxy forwards /api/* to localhost:5000
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
