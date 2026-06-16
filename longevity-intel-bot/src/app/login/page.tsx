"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      setError("管理员口令不正确。");
      setLoading(false);
      return;
    }

    window.location.href = new URLSearchParams(window.location.search).get("next") || "/";
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={onSubmit}>
        <div className="brand-lock">
          <LockKeyhole size={22} />
        </div>
        <h1>Compound Longevity 科学情报后台</h1>
        <p>请输入内部管理员口令后继续。</p>
        <label>
          管理员口令
          <input
            autoFocus
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ADMIN_TOKEN"
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-button" type="submit" disabled={loading || !token}>
          {loading ? "校验中..." : "进入后台"}
        </button>
      </form>
    </main>
  );
}
