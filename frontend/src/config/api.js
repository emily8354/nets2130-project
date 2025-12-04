// API configuration for environment-based URLs
// In development: uses localhost
// In production: uses environment variable or falls back to window.location.origin
// For GitHub Pages: Set VITE_API_BASE to your backend URL (Railway, Render, etc.)
export const API_BASE = import.meta.env.VITE_API_BASE || 
  (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);

