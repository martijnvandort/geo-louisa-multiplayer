"use client";

import { useEffect, useState } from "react";
import { GeosenseApp } from "@/components/game/geosense-app";

export default function Home() {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  useEffect(() => {
    const key = "geosense-player";
    const existing = window.sessionStorage.getItem(key);
    const id = existing || crypto.randomUUID();
    if (!existing) window.sessionStorage.setItem(key, id);
    const code = new URLSearchParams(window.location.search).get("room") ?? "";
    const timer = window.setTimeout(() => {
      setPlayerId(id);
      if (/^[A-Z0-9]{6}$/.test(code.toUpperCase())) setInviteCode(code.toUpperCase());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!playerId) {
    return (
      <main className="flex h-dvh items-center justify-center bg-[#e2f6fe]">
        <p className="font-mono text-sm tracking-[0.2em] text-[#2f4a52]">GEOSENSE</p>
      </main>
    );
  }

  return <GeosenseApp playerId={playerId} inviteCode={inviteCode} />;
}
