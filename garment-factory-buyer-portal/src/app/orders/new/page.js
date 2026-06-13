"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { placeOrder, getSuggestedDeadline } from "@/lib/api";

const GARMENT_SUGGESTIONS = [
  "formal shirt", "t-shirt", "kurta", "ladies kurti",
  "denim jeans", "kids frock", "casual shirt", "trouser",
];
const FABRIC_SUGGESTIONS = [
  "cotton", "polyester", "linen", "georgette", "denim",
  "silk", "rayon", "wool", "synthetic",
];
const SIZE_OPTIONS = ["S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36", "38", "40", "42"];

function createEmptyItem() {
  return {
    garment_type: "",
    fabric_type: "",
    colour: "",
    quantity: "",
    size_breakdown: {},
    special_notes: "",
    active_sizes: [],
  };
}

function getMinDeadline() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split("T")[0];
}

function formatCurrency(v) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
}

export default function PlaceOrderPage() {
  const router = useRouter();
  const [items, setItems] = useState([createEmptyItem()]);
  const [deliveryDeadline, setDeliveryDeadline] = useState("");
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestion, setSuggestion] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem("buyer_token");
    if (!token) router.push("/login");
  }, [router]);

  function updateItem(index, field, value) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function toggleSize(index, size) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      const active = item.active_sizes.includes(size)
        ? item.active_sizes.filter((s) => s !== size)
        : [...item.active_sizes, size];
      item.active_sizes = active;
      const breakdown = { ...item.size_breakdown };
      if (!active.includes(size)) {
        delete breakdown[size];
      } else if (!breakdown[size]) {
        breakdown[size] = 0;
      }
      item.size_breakdown = breakdown;
      next[index] = item;
      return next;
    });
  }

  function updateSizeQty(index, size, qty) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      item.size_breakdown = { ...item.size_breakdown, [size]: Number(qty) || 0 };
      next[index] = item;
      return next;
    });
  }

  function addItem() {
    if (items.length < 10) setItems((prev) => [...prev, createEmptyItem()]);
  }

  function removeItem(index) {
    if (items.length > 1) setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function getSizeSum(item) {
    return Object.values(item.size_breakdown || {}).reduce((s, v) => s + Number(v || 0), 0);
  }

  async function handleSuggestDeadline() {
    try {
      setSuggesting(true);
      setError("");
      const validItems = items
        .filter((i) => i.garment_type && i.quantity)
        .map((i) => ({ garment_type: i.garment_type, quantity: Number(i.quantity) }));
      const result = await getSuggestedDeadline(validItems);
      setSuggestion(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggesting(false);
    }
  }

  function canSubmit() {
    const hasValidItem = items.some((i) => i.garment_type && Number(i.quantity) > 0);
    if (!hasValidItem || !deliveryDeadline) return false;
    for (const item of items) {
      if (item.garment_type && Number(item.quantity) > 0 && item.active_sizes.length > 0) {
        if (getSizeSum(item) !== Number(item.quantity)) return false;
      }
    }
    return true;
  }

  function handlePlaceOrder() {
    setShowConfirm(true);
  }

  async function confirmPlaceOrder() {
    setShowConfirm(false);
    setLoading(true);
    setError("");
    try {
      const payload = {
        items: items
          .filter((i) => i.garment_type && Number(i.quantity) > 0)
          .map((i) => ({
            garment_type: i.garment_type,
            fabric_type: i.fabric_type || undefined,
            colour: i.colour || undefined,
            quantity: Number(i.quantity),
            size_breakdown: i.active_sizes.length > 0 ? i.size_breakdown : undefined,
            special_notes: i.special_notes || undefined,
          })),
        delivery_deadline: deliveryDeadline,
        special_instructions: specialInstructions || null
      };
      const result = await placeOrder(payload);
      setSuccess(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const totalPieces = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const totalItems = items.filter((i) => i.garment_type && Number(i.quantity) > 0).length;

  if (success) {
    return (
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 16px", textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 32 }}>✓</div>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Order Placed Successfully!</h1>
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 24 }}>The factory will review your order and send a quotation shortly.</p>
        <div style={{ background: "#f8fafc", borderRadius: 8, padding: 20, marginBottom: 24, textAlign: "left", fontSize: 14 }}>
          <div style={{ marginBottom: 8 }}><strong>Order #:</strong> {success.order_id?.slice(0, 8).toUpperCase()}</div>
          <div style={{ marginBottom: 8 }}><strong>Status:</strong> {success.status}</div>
          {success.total_price && <div style={{ marginBottom: 8 }}><strong>Estimated price:</strong> {formatCurrency(success.total_price)}</div>}
          {success.suggested_deadline && <div style={{ marginBottom: 8 }}><strong>Suggested deadline:</strong> {new Date(success.suggested_deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>}
          {success.availability_result && (
            <div style={{ marginBottom: 8 }}>
              <strong>Materials:</strong>{" "}
              {success.availability_result.sufficient ? (
                <span style={{ color: "#16a34a" }}>All materials available</span>
              ) : (
                <span style={{ color: "#ea580c" }}>Some materials need to be procured</span>
              )}
            </div>
          )}
          <div style={{ color: "#64748b", marginTop: 12 }}>{success.message}</div>
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => router.push("/orders")}
            style={{ padding: "10px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            View My Orders
          </button>
          <button
            onClick={() => { setSuccess(null); setItems([createEmptyItem()]); setDeliveryDeadline(""); setSpecialInstructions(""); setSuggestion(null); }}
            style={{ padding: "10px 20px", background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            Place Another Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push("/orders")}
          style={{ background: "none", border: "none", color: "#64748b", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 8 }}
        >
          ← Back to My Orders
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Place New Order</h1>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: "10px 14px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* SECTION 1 — ITEMS */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Items</h2>
        {items.map((item, idx) => {
          const qty = Number(item.quantity) || 0;
          const sizeSum = getSizeSum(item);
          const sizeStatus = item.active_sizes.length === 0 ? null
            : sizeSum === qty ? "ok"
            : sizeSum < qty ? "under" : "over";

          return (
            <div key={idx} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Item {idx + 1}</span>
                {items.length > 1 && (
                  <button
                    onClick={() => removeItem(idx)}
                    style={{ background: "none", border: "none", color: "#dc2626", fontSize: 13, cursor: "pointer" }}
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Garment Type */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Garment Type *</label>
                <input
                  type="text"
                  list={`garment-${idx}`}
                  value={item.garment_type}
                  onChange={(e) => updateItem(idx, "garment_type", e.target.value)}
                  placeholder="e.g. formal shirt"
                  required
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
                />
                <datalist id={`garment-${idx}`}>
                  {GARMENT_SUGGESTIONS.map((g) => <option key={g} value={g} />)}
                </datalist>
              </div>

              {/* Fabric + Colour + Quantity */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Fabric Type</label>
                  <input
                    type="text"
                    list={`fabric-${idx}`}
                    value={item.fabric_type}
                    onChange={(e) => updateItem(idx, "fabric_type", e.target.value)}
                    placeholder="e.g. cotton"
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
                  />
                  <datalist id={`fabric-${idx}`}>
                    {FABRIC_SUGGESTIONS.map((f) => <option key={f} value={f} />)}
                  </datalist>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Colour</label>
                  <input
                    type="text"
                    value={item.colour}
                    onChange={(e) => updateItem(idx, "colour", e.target.value)}
                    placeholder="e.g. navy blue"
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Total Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    required
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
                  />
                </div>
              </div>

              {/* Size Breakdown */}
              {qty > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "#334155" }}>
                    Size Breakdown (must add up to {qty})
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {SIZE_OPTIONS.map((size) => {
                      const active = item.active_sizes.includes(size);
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => toggleSize(idx, size)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: "pointer",
                            border: active ? "1px solid #0f172a" : "1px solid #e2e8f0",
                            background: active ? "#0f172a" : "#fff",
                            color: active ? "#fff" : "#64748b",
                          }}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                  {item.active_sizes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {item.active_sizes.map((size) => (
                        <div key={size} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 13, color: "#475569" }}>{size}:</span>
                          <input
                            type="number"
                            min="0"
                            value={item.size_breakdown[size] || ""}
                            onChange={(e) => updateSizeQty(idx, size, e.target.value)}
                            style={{ width: 60, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 4, fontSize: 13 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {sizeStatus && (
                    <div style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: sizeStatus === "ok" ? "#16a34a" : sizeStatus === "under" ? "#d97706" : "#dc2626" }}>
                      {sizeStatus === "ok" && "✓ Sizes add up correctly"}
                      {sizeStatus === "under" && `${qty - sizeSum} pieces unallocated`}
                      {sizeStatus === "over" && `${sizeSum - qty} pieces over total quantity`}
                    </div>
                  )}
                </div>
              )}

              {/* Special Notes */}
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Special Notes</label>
                <textarea
                  value={item.special_notes}
                  onChange={(e) => updateItem(idx, "special_notes", e.target.value)}
                  placeholder="Any special requirements for this item"
                  rows={2}
                  style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
                />
              </div>
            </div>
          );
        })}

        {items.length < 10 && (
          <button
            type="button"
            onClick={addItem}
            style={{ width: "100%", padding: "10px", background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 8, fontSize: 14, color: "#475569", cursor: "pointer" }}
          >
            + Add Another Item
          </button>
        )}
      </div>

      {/* SECTION 2 — DELIVERY */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Delivery</h2>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Delivery Deadline *</label>
            <input
              type="date"
              value={deliveryDeadline}
              min={getMinDeadline()}
              onChange={(e) => setDeliveryDeadline(e.target.value)}
              required
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }}
            />
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Factory needs at least 14 days</p>
          </div>

          <button
            type="button"
            onClick={handleSuggestDeadline}
            disabled={suggesting || !items.some((i) => i.garment_type && Number(i.quantity) > 0)}
            style={{
              width: "100%", padding: "10px", background: suggesting ? "#f1f5f9" : "#eff6ff",
              border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 14, color: "#1d4ed8",
              cursor: suggesting || !items.some((i) => i.garment_type && Number(i.quantity) > 0) ? "not-allowed" : "pointer",
              marginBottom: 12,
            }}
          >
            {suggesting ? "Calculating..." : "📅 Get Deadline Suggestion"}
          </button>

          {suggestion && suggestion.suggested_deadline && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#1e40af" }}>
                  📅 Suggested: {new Date(suggestion.suggested_deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                  background: suggestion.confidence === "high" ? "#dcfce7" : suggestion.confidence === "medium" ? "#fef3c7" : "#fee2e2",
                  color: suggestion.confidence === "high" ? "#166534" : suggestion.confidence === "medium" ? "#92400e" : "#991b1b",
                }}>
                  {suggestion.confidence}
                </span>
              </div>
              {suggestion.breakdown && (
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
                  {suggestion.breakdown.production_days > 0 && <span>Production: {suggestion.breakdown.production_days}d | </span>}
                  {suggestion.breakdown.queue_delay_days > 0 && <span>Queue: {suggestion.breakdown.queue_delay_days}d | </span>}
                  {suggestion.breakdown.material_delay_days > 0 && <span>Material: {suggestion.breakdown.material_delay_days}d | </span>}
                  <span>Buffer: {suggestion.breakdown.buffer_days}d</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setDeliveryDeadline(suggestion.suggested_deadline)}
                style={{ background: "none", border: "none", color: "#1d4ed8", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" }}
              >
                Use this date
              </button>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#334155" }}>Special Instructions</label>
            <textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value)}
              placeholder="Any special instructions for the entire order"
              rows={3}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box", resize: "vertical" }}
            />
          </div>
        </div>
      </div>

      {/* SECTION 3 — ORDER SUMMARY */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Order Summary</h2>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Garment Type", "Fabric", "Colour", "Qty", "Sizes"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.filter((i) => i.garment_type && Number(i.quantity) > 0).map((item, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px" }}>{item.garment_type}</td>
                  <td style={{ padding: "8px 12px" }}>{item.fabric_type || "-"}</td>
                  <td style={{ padding: "8px 12px" }}>{item.colour || "-"}</td>
                  <td style={{ padding: "8px 12px" }}>{item.quantity}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {item.active_sizes.length > 0
                      ? item.active_sizes.map((s) => `${s}:${item.size_breakdown[s] || 0}`).join(", ")
                      : "-"}
                  </td>
                </tr>
              ))}
              {!items.some((i) => i.garment_type && Number(i.quantity) > 0) && (
                <tr><td colSpan={5} style={{ padding: "16px", textAlign: "center", color: "#94a3b8" }}>Add items to see summary</td></tr>
              )}
            </tbody>
          </table>
          <div style={{ padding: "10px 12px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span><strong>Total pieces:</strong> {totalPieces}</span>
            <span><strong>Deadline:</strong> {deliveryDeadline ? new Date(deliveryDeadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "not set"}</span>
          </div>
        </div>
      </div>

      {/* FORM ACTIONS */}
      <button
        type="button"
        onClick={handlePlaceOrder}
        disabled={loading || !canSubmit()}
        style={{
          width: "100%", padding: "14px", background: loading || !canSubmit() ? "#94a3b8" : "#0f172a",
          color: "#fff", border: "none", borderRadius: 8, fontSize: 16, fontWeight: 600,
          cursor: loading || !canSubmit() ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Placing order..." : "Place Order"}
      </button>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: 8, padding: 24, maxWidth: 400, width: "90%", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Confirm Order</h3>
            <p style={{ fontSize: 14, color: "#475569", marginBottom: 16 }}>
              Are you sure you want to place this order?
              <br /><br />
              <strong>Total:</strong> {totalPieces} pieces across {totalItems} garment type{totalItems !== 1 ? "s" : ""}
              <br />
              <strong>Deadline:</strong> {deliveryDeadline ? new Date(deliveryDeadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}
              <br /><br />
              The factory will review and send you a quotation.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{ padding: "8px 16px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmPlaceOrder}
                style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
