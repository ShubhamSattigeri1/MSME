"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getOrders, unwrap } from "@/lib/api";

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("buyer_token");
    if (!token) { router.push("/login"); return; }
    async function load() {
      try {
        const data = await getOrders();
        setOrders(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statusStyles = {
    pending: { bg: "#fffbeb", color: "#92400e" },
    confirmed: { bg: "#eff6ff", color: "#1e40af" },
    in_production: { bg: "#f0fdf4", color: "#166534" },
    shipped: { bg: "#f0fdf4", color: "#166534" },
    cancelled: { bg: "#fef2f2", color: "#991b1b" },
  };

  const totalQty = (order) => (order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0);
  const formatCurrency = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
  const formatDate = (v) => v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>My Orders</h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "4px 0 0" }}>View your order status and communicate with the factory.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => router.push("/orders/new")}
            style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >+ Place New Order</button>
          <button
            onClick={() => { localStorage.removeItem("buyer_token"); localStorage.removeItem("buyer_id"); router.push("/login"); }}
            style={{ padding: "8px 16px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, cursor: "pointer", color: "#64748b" }}
          >Sign Out</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {!orders.length ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", background: "#fff", borderRadius: 8 }}>No orders found.</div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Order ID", "Items", "Total", "Status", "Date"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const st = statusStyles[order.status] || { bg: "#f8fafc", color: "#475569" };
                return (
                  <tr
                    key={order.id}
                    onClick={() => router.push(`/orders/${order.id}`)}
                    style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "12px 14px", fontSize: 13, fontWeight: 500 }}>{order.id.slice(0, 8).toUpperCase()}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#475569" }}>
                      {(order.items || []).map(i => `${i.garment_type} x${i.quantity}`).join(", ") || "-"}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13 }}>{formatCurrency(order.total_price)}</td>
                    <td style={{ padding: "12px 14px" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, background: st.bg, color: st.color }}>
                        {order.status.replace("_", " ")}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "#475569" }}>{formatDate(order.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
