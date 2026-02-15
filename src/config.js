// API configuration based on environment
export const API_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : '');

export const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Validate configuration in production
if (!import.meta.env.DEV && !API_URL) {
  console.error('VITE_API_URL is not configured! Set it in GitHub Secrets or .env file');
}
