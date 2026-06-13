import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("buyer_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("buyer_token");
        window.location.href = "/login";
      }
    }
    const message =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      `Request failed (${error.response?.status || "network"})`;
    return Promise.reject(new Error(message));
  }
);

export function unwrap(response) {
  return response?.data?.data ?? response?.data;
}

export async function login(email, password) {
  const response = await api.post("/api/buyer-portal/login", { email, password });
  return unwrap(response);
}

export async function getOrders() {
  const response = await api.get("/api/buyer-portal/orders");
  return unwrap(response);
}

export async function getOrderById(id) {
  const response = await api.get(`/api/buyer-portal/orders/${id}`);
  return unwrap(response);
}

export async function getMessages(orderId) {
  const response = await api.get(`/api/buyer-portal/orders/${orderId}/messages`);
  return unwrap(response);
}

export async function sendMessage(orderId, body) {
  const response = await api.post(`/api/buyer-portal/orders/${orderId}/messages`, { body });
  return unwrap(response);
}

export async function register(name, email, password, phone) {
  const body = { buyer_name: name, email, password };
  if (phone) body.phone = phone;
  const response = await api.post("/api/buyer-portal/register", body);
  return unwrap(response);
}

export async function confirmToken(token) {
  const response = await api.get(`/api/confirm/${token}`);
  return unwrap(response);
}

export async function confirmAction(token) {
  const response = await api.post(`/api/confirm/${token}`);
  return unwrap(response);
}

export async function placeOrder(orderData) {
  const response = await api.post("/api/buyer-portal/orders", orderData);
  return unwrap(response);
}

export async function getSuggestedDeadline(items) {
  const response = await api.post("/api/orders/suggest-deadline", { items });
  return unwrap(response);
}

export async function respondToProposal(orderId, messageId, action, notes) {
  const response = await api.post(`/api/buyer-portal/orders/${orderId}/messages/${messageId}/respond`, { action, notes });
  return unwrap(response);
}

export default api;
