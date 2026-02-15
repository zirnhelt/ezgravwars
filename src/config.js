// API configuration based on environment
export const API_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://YOUR_WORKER_NAME.YOUR_SUBDOMAIN.workers.dev');

export const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://');
