// Backend configuration for desktop app
// Default to localhost, can be overridden with environment variable
import axios from 'axios';

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
export const API_BASE_URL = BACKEND_URL;

// Create and configure axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add request interceptor to include auth token from localStorage
apiClient.interceptors.request.use(
  (config) => {
    // Add Authorization header if token exists in localStorage (for desktop app)
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    console.log('[API Request]', config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => {
    console.error('[API Request Error]', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      console.error('[API] 401 Unauthorized - Cookie may not be set or sent properly');
      console.error('[API] Request URL:', error.config?.url);
      console.error('[API] Request headers:', error.config?.headers);
    }
    return Promise.reject(error);
  }
);

export default apiClient;
