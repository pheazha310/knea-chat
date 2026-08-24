import axios from 'axios';

/**
 * Shared HTTP client — part of the Model layer's data-access infrastructure.
 * Domain-specific endpoints live in `src/models/*` (e.g. UserModel, AuthModel),
 * which all talk through this axios instance so auth headers and 401 handling
 * stay in one place.
 */
export const API_BASE_URL =
  process.env.REACT_APP_API_URL || 'http://localhost:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('kneachat_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('kneachat_token');
      localStorage.removeItem('kneachat_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
