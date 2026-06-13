"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmToken, confirmAction, login, register } from "@/lib/api";

function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [step, setStep] = useState("loading");
  const [orderPreview, setOrderPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  const [result, setResult] = useState(null);

  const loggedIn = typeof window !== "undefined" && localStorage.getItem("buyer_token");
  const formatCurrency = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));

  useEffect(() => {
    if (!token) {
      setError("No confirmation token found in URL");
      setStep("error");
      return;
    }
    async function load() {
      try {
        const data = await confirmToken(token);
        setOrderPreview(data);
        if (loggedIn) {
          setStep("proceed");
        } else {
          setStep("auth");
        }
      } catch (err) {
        setError(err.message);
        setStep("error");
      }
    }
    load();
  }, [token]);

  async function handleLogin(e) {
    e.preventDefault();
    try {
      setLoading(true);
      setError("");
      const result = await login(loginEmail, loginPassword);
      localStorage.setItem("buyer_token", result.token);
      localStorage.setItem("buyer_id", result.buyer_id);
      setStep("proceed");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      setError("Passwords do not match");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const result = await register(regEmail, regPassword, regName);
      localStorage.setItem("buyer_token", result.token);
      localStorage.setItem("buyer_id", result.buyer_id);
      setStep("proceed");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    try {
      setLoading(true);
      setError("");
      const data = await confirmAction(token);
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === "loading") {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ color: "#94a3b8" }}>Loading...</div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ maxWidth: 480, width: "100%", background: "#fff", borderRadius: 8, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Invalid Link</h2>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 520, width: "100%" }}>
        {orderPreview && step !== "done" && (
          <div style={{ background: "#fff", borderRadius: 8, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: 16 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Order Preview</h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>Review your quotation details below.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Buyer</span>
                <span style={{ fontWeight: 500 }}>{orderPreview.buyer_name}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#64748b" }}>Items</span>
                <span style={{ fontWeight: 500, textAlign: "right" }}>{orderPreview.items_summary}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                <span style={{ fontWeight: 600 }}>Grand Total</span>
                <span style={{ fontWeight: 600, fontSize: 18 }}>{formatCurrency(orderPreview.grand_total)}</span>
              </div>
            </div>
          </div>
        )}

        {step === "auth" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>Sign In</h3>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>Sign in to your account to confirm this order.</p>
              <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="email" placeholder="Email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required />
                <input type="password" placeholder="Password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required />
                <button type="submit" disabled={loading} style={{ padding: "10px 16px", background: loading ? "#94a3b8" : "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{loading ? "Signing in..." : "Sign In"}</button>
              </form>
            </div>

            <div style={{ background: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>Create Account</h3>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>New here? Create an account to confirm your order.</p>
              <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input type="text" placeholder="Full Name" value={regName} onChange={e => setRegName(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required />
                <input type="email" placeholder="Email" value={regEmail} onChange={e => setRegEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required />
                <input type="password" placeholder="Password (min 6 chars)" value={regPassword} onChange={e => setRegPassword(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required minLength={6} />
                <input type="password" placeholder="Confirm Password" value={regConfirm} onChange={e => setRegConfirm(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} required />
                <button type="submit" disabled={loading} style={{ padding: "10px 16px", background: loading ? "#94a3b8" : "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{loading ? "Creating account..." : "Create Account & Confirm"}</button>
              </form>
            </div>
          </div>
        )}

        {step === "proceed" && (
          <div style={{ background: "#fff", borderRadius: 8, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 20 }}>
              You are logged in. Ready to {orderPreview?.action === 'confirm' ? 'confirm' : 'request changes to'} this order?
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={handleConfirm} disabled={loading} style={{ padding: "12px 32px", background: loading ? "#94a3b8" : orderPreview?.action === 'confirm' ? "#16a34a" : "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                {loading ? "Processing..." : orderPreview?.action === 'confirm' ? "✅ Confirm Order" : "❌ Request Changes"}
              </button>
              <button onClick={() => router.push("/orders")} style={{ padding: "12px 24px", background: "transparent", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, cursor: "pointer", color: "#64748b" }}>
                Back to Orders
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div style={{ background: "#fff", borderRadius: 8, padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", textAlign: "center" }}>
            {result.action === 'confirm' ? (
              <>
                <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
                <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>Order Confirmed!</h2>
                <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 24px" }}>Production will begin shortly. You can track progress in your orders.</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 56, marginBottom: 16 }}>📝</div>
                <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>Changes Requested</h2>
                <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 24px" }}>Your change request has been noted. The factory will contact you shortly.</p>
              </>
            )}
            <button onClick={() => router.push("/orders")} style={{ padding: "12px 32px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              View My Orders
            </button>
          </div>
        )}

        {error && (
          <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 13, marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: 20 }}><div style={{ color: "#94a3b8" }}>Loading...</div></div>}>
      <ConfirmContent />
    </Suspense>
  );
}
