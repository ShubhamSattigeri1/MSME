"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrderById, getMessages, sendMessage, respondToProposal, unwrap } from "@/lib/api";
import { ArrowLeft, Send } from "lucide-react";
import { io as socketIO } from "socket.io-client";

const statusStyles = {
  pending: { bg: "#fffbeb", color: "#92400e" },
  confirmed: { bg: "#eff6ff", color: "#1e40af" },
  in_production: { bg: "#f0fdf4", color: "#166534" },
  shipped: { bg: "#f0fdf4", color: "#166534" },
  cancelled: { bg: "#fef2f2", color: "#991b1b" },
};

function formatCurrency(v) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
}

function formatDate(v) {
  return v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
}

export default function OrderDetailPage({ params }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [respondingId, setRespondingId] = useState(null);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  async function loadOrder() {
    try {
      const data = await getOrderById(resolvedParams.id);
      setOrder(data);
    } catch (err) {
      setError(err.message);
      if (err.message.includes("Forbidden") || err.message.includes("401")) {
        router.push("/login");
      }
    }
  }

  async function loadMessages() {
    try {
      const data = await getMessages(resolvedParams.id);
      setMessages(data.messages || []);
    } catch {}
  }

  useEffect(() => {
    const token = localStorage.getItem("buyer_token");
    if (!token) { router.push("/login"); return; }
    async function load() {
      await loadOrder();
      await loadMessages();
      setLoading(false);
    }
    load();
  }, [resolvedParams.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // WebSocket: real-time updates
  useEffect(() => {
    if (!resolvedParams.id) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("buyer_token") : null;
    if (!token) return;
    const socket = socketIO(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000", {
      transports: ["websocket", "polling"],
      auth: { token },
    });
    socket.emit("join_order", resolvedParams.id);

    socket.on("new_message", (message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
    });

    socket.on("order_updated", async () => {
      try {
        const data = await getOrderById(resolvedParams.id);
        setOrder(data);
      } catch { /* non-critical */ }
    });

    return () => {
      socket.emit("leave_order", resolvedParams.id);
      socket.disconnect();
    };
  }, [resolvedParams.id]);

  async function handleSend(e) {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      setSending(true);
      await sendMessage(resolvedParams.id, body);
      setBody("");
      await loadMessages();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleRespondToProposal(messageId, action) {
    try {
      setRespondingId(messageId);
      const result = await respondToProposal(resolvedParams.id, messageId, action);

      // Use the order returned from the backend if available
      if (result?.order) {
        setOrder(result.order);
      } else {
        await loadOrder();
      }

      // Reload messages
      await loadMessages();
    } catch (err) {
      setError(err.message);
    } finally {
      setRespondingId(null);
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>;

  const st = order ? statusStyles[order.status] || { bg: "#f8fafc", color: "#475569" } : {};
  const priceItems = order?.price_breakdown?.items || [];
  const subtotal = Number(order?.price_breakdown?.order_total || order?.total_price || 0);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
      <button onClick={() => router.push("/orders")} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", fontSize: 13, color: "#64748b", cursor: "pointer", padding: 0, marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back to Orders
      </button>

      {error && (
        <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {/* Order Header */}
      {order && (
        <div style={{ background: "#fff", borderRadius: 8, padding: 24, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Order #{order.id.slice(0, 8).toUpperCase()}</h1>
            <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: 4, fontSize: 12, fontWeight: 500, background: st.bg, color: st.color }}>
              {order.status.replace("_", " ")}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, color: "#475569" }}>
            <div>Contact: <strong>{order.buyer_contact || "-"}</strong></div>
            <div>Deadline: <strong>{order.delivery_deadline ? formatDate(order.delivery_deadline) : "-"}</strong></div>
            <div>Created: <strong>{formatDate(order.created_at)}</strong></div>
          </div>
        </div>
      )}

      {/* Items */}
      {order && (
        <div style={{ background: "#fff", borderRadius: 8, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 14, fontWeight: 600 }}>Items Ordered</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Garment", "Fabric", "Colour", "Qty", "Size", "Unit Price", "Total"].map(h => (
                  <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(order.items || []).map(item => {
                const p = priceItems.find(x => x.order_item_id === item.id) || {};
                const unitPrice = Number(p.unit_price || item.unit_price || 0);
                const itemTotal = Number(p.item_total || 0) || unitPrice * Number(item.quantity || 0);
                const sb = item.size_breakdown && typeof item.size_breakdown === "object"
                  ? Object.entries(item.size_breakdown).filter(([,v]) => v).map(([k,v]) => `${k.toUpperCase()}:${v}`).join(", ")
                  : "-";
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 500 }}>{item.garment_type}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "#475569" }}>{item.fabric || "-"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "#475569" }}>{item.colour || "-"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{item.quantity}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "#475569" }}>{sb}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{formatCurrency(unitPrice)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>{formatCurrency(itemTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", textAlign: "right", borderTop: "1px solid #f1f5f9", fontSize: 16, fontWeight: 600 }}>
            Total: {formatCurrency(subtotal)}
            {order?.negotiated_margin_pct != null && (
              <span style={{ marginLeft: 8, display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>Negotiated price</span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ background: "#fff", borderRadius: 8, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Messages</span>
        </div>
        <div style={{ padding: 16, maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, minHeight: 120 }}>
          {messages.map(msg => {
            const isBuyer = msg.sender_type === "buyer";

            // Render price_proposal messages as special cards
            if (msg.message_type === "price_proposal") {
              const pData = typeof msg.proposal_data === "string" ? JSON.parse(msg.proposal_data) : msg.proposal_data;
              const statusStyles2 = {
                pending: { bg: "#fffbeb", color: "#92400e" },
                accepted: { bg: "#f0fdf4", color: "#166534" },
                rejected: { bg: "#fef2f2", color: "#991b1b" },
              };
              const st = statusStyles2[msg.proposal_status] || statusStyles2.pending;
              return (
                <div key={msg.id} style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{
                    maxWidth: "90%",
                    padding: 16,
                    borderRadius: 10,
                    fontSize: 13,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontWeight: 600, color: "#0f172a" }}>Price Proposal</span>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, background: st.bg, color: st.color }}>
                        {msg.proposal_status}
                      </span>
                    </div>
                    {pData?.items && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                        {pData.items.map((item) => (
                          <div key={item.order_item_id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 8px", background: "#f8fafc", borderRadius: 6 }}>
                            <span style={{ fontWeight: 600, color: "#0f172a", minWidth: 90 }}>{item.garment_type} <span style={{ color: "#94a3b8", fontWeight: 400 }}>x{item.quantity}</span></span>
                            <span style={{ color: "#64748b" }}>₹{item.original_unit_price?.toLocaleString("en-IN")}/pc</span>
                            <span style={{ color: "#94a3b8" }}>→</span>
                            <span style={{ fontWeight: 600, color: "#0f172a" }}>₹{item.proposed_unit_price?.toLocaleString("en-IN")}/pc</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {pData && (
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #f1f5f9", paddingTop: 8, fontSize: 12, marginBottom: pData?.notes ? 8 : 0 }}>
                        <span style={{ color: "#64748b" }}>Total: <span style={{ textDecoration: "line-through" }}>₹{pData.original_total?.toLocaleString("en-IN")}</span></span>
                        <span style={{ fontWeight: 600, color: "#0f172a" }}>₹{pData.proposed_total?.toLocaleString("en-IN")}</span>
                      </div>
                    )}
                    {pData?.notes && (
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Note: {pData.notes}</div>
                    )}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: msg.proposal_status === "pending" ? 8 : 0 }}>
                      {formatDate(msg.created_at)}
                    </div>
                    {msg.proposal_status === "pending" && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => handleRespondToProposal(msg.id, "accept")}
                          disabled={respondingId === msg.id}
                          style={{
                            flex: 1, padding: "8px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
                          }}
                        >
                          {respondingId === msg.id ? "..." : "Accept All"}
                        </button>
                        <button
                          onClick={() => handleRespondToProposal(msg.id, "reject")}
                          disabled={respondingId === msg.id}
                          style={{
                            flex: 1, padding: "8px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
                          }}
                        >
                          {respondingId === msg.id ? "..." : "Reject"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} style={{ display: "flex", justifyContent: isBuyer ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "75%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  background: isBuyer ? "#0f172a" : "#f1f5f9",
                  color: isBuyer ? "#fff" : "#0f172a",
                }}>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.body}</p>
                  <div style={{ marginTop: 4, fontSize: 10, opacity: 0.6, display: "flex", gap: 6 }}>
                    <span>{formatDate(msg.created_at)}</span>
                    {!isBuyer && msg.read_at && <span>✓ Read</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {!messages.length && <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 20 }}>No messages yet.</div>}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSend} style={{ borderTop: "1px solid #f1f5f9", padding: 16, display: "flex", gap: 8 }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message..."
            rows={2}
            style={{ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, resize: "none", fontFamily: "inherit" }}
            required
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 16px", background: sending ? "#94a3b8" : "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <Send size={14} />
            {sending ? "..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
