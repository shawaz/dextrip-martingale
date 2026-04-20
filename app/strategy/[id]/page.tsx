"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Crown } from "lucide-react"
import { Query } from "appwrite"
import { databases } from "@/lib/appwrite"
import { cn } from "@/lib/utils"

const dbId = "arena"

type Agent = {
  $id: string
  name: string
  init: string
  color: string
  won: number
  loss: number
  winRate: number
  timeframe: "15m" | "1h" | "4h"
  promoted?: boolean
  strategyCards?: string[]
}

type Trade = {
  $id: string
  $createdAt: string
  strategyName: string
  signal: "UP" | "DOWN"
  entry?: number
  exit?: number
  result: "pending" | "won" | "loss"
}

const strategyIdeas: Record<string, { summary: string; improve: string }> = {
  "Volume Surge": {
    summary: "Hits momentum when volume breaks above recent baseline.",
    improve: "Add higher timeframe trend confirmation before firing.",
  },
  "RSI Reversal": {
    summary: "Fades overstretched moves after RSI extremes.",
    improve: "Use structure levels so reversals only trigger near support or resistance.",
  },
  "Momentum Break": {
    summary: "Chases clean range breakouts.",
    improve: "Require retest strength before sizing bigger.",
  },
  "Trend Ride": {
    summary: "Keeps riding strong trends instead of scalping noise.",
    improve: "Use trailing logic to protect winners.",
  },
  "VWAP Reclaim": {
    summary: "Enters when price reclaims VWAP with intent.",
    improve: "Filter out flat sessions with weak participation.",
  },
}

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [agent, setAgent] = useState<Agent | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    const load = async () => {
      const { id } = await params
      const [agentDoc, tradesRes] = await Promise.all([
        databases.getDocument(dbId, "agents", id),
        databases.listDocuments(dbId, "trades", [Query.equal("agentId", id), Query.orderDesc("$createdAt"), Query.limit(20)]),
      ])

      setAgent(agentDoc as unknown as Agent)
      setTrades(tradesRes.documents as unknown as Trade[])
    }

    load().catch((error) => console.error("Failed to load strategy page:", error))
  }, [params])

  const latestTrade = trades[0]
  const winCount = trades.filter((trade) => trade.result === "won").length
  const lossCount = trades.filter((trade) => trade.result === "loss").length

  const cardData = useMemo(() => {
    return (agent?.strategyCards ?? []).map((card) => ({
      name: card,
      summary: strategyIdeas[card]?.summary ?? "Strategy card ready.",
      improve: strategyIdeas[card]?.improve ?? "Refine signal quality with stricter filters.",
      active: latestTrade?.strategyName === card,
    }))
  }, [agent?.strategyCards, latestTrade?.strategyName])

  if (!agent) {
    return <div className="min-h-screen bg-black text-white p-8">Loading agent...</div>
  }

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <Link href="/" className="inline-flex items-center gap-2 text-zinc-500 hover:text-white transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" /> Back to Arena
        </Link>

        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold border shadow-lg" style={{ backgroundColor: `${agent.color}20`, color: agent.color, borderColor: `${agent.color}30` }}>
            {agent.init}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
              {agent.promoted && <Crown className="h-4 w-4 text-amber-400" />}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="bg-zinc-900 text-zinc-200 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-zinc-700">{agent.timeframe}</span>
              <span className="bg-green-500/10 text-green-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-green-500/20">Wins: {agent.won}</span>
              <span className="bg-red-500/10 text-red-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-red-500/20">Losses: {agent.loss}</span>
              <span className="bg-amber-500/10 text-amber-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/20">Win rate: {Math.round(agent.winRate ?? 0)}%</span>
              {agent.promoted && <span className="bg-amber-500/10 text-amber-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold border border-amber-500/20">Live eligible</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#121212] border border-[#222222] rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Current signal</div>
            <div className={cn("text-lg font-semibold", latestTrade?.signal === "UP" ? "text-green-400" : latestTrade?.signal === "DOWN" ? "text-red-400" : "text-zinc-400")}>{latestTrade?.signal ?? "WAITING"}</div>
            <div className="text-xs text-zinc-500 mt-2">{latestTrade?.strategyName ?? "No active strategy yet"}</div>
          </div>
          <div className="bg-[#121212] border border-[#222222] rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Recent form</div>
            <div className="text-lg font-semibold text-white">{winCount}W / {lossCount}L</div>
            <div className="text-xs text-zinc-500 mt-2">Last {trades.length} trades tracked</div>
          </div>
          <div className="bg-[#121212] border border-[#222222] rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Last entry</div>
            <div className="text-lg font-semibold text-white">{latestTrade?.entry ? `$${latestTrade.entry.toFixed(2)}` : "---"}</div>
            <div className="text-xs text-zinc-500 mt-2">Last result: {latestTrade?.result ?? "pending"}</div>
          </div>
        </div>

        <div className="bg-[#121212] border border-[#222222] rounded-2xl p-6 space-y-4">
          <h3 className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Strategy cards</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cardData.map((card) => (
              <div key={card.name} className={cn("rounded-xl border p-4", card.active ? "border-amber-500/40 bg-amber-500/5" : "border-[#222222] bg-black/20")}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-zinc-100">{card.name}</div>
                  {card.active && <span className="text-[10px] rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 uppercase tracking-wide text-amber-300">active</span>}
                </div>
                <p className="mt-2 text-xs text-zinc-400">{card.summary}</p>
                <p className="mt-3 text-xs text-zinc-500">Improve: {card.improve}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#121212] border border-[#222222] rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#222222] text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Recent trades</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#1a1a1a] border-b border-[#222222]">
                <tr>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Time</th>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Strategy</th>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Signal</th>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Entry</th>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Exit</th>
                  <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {trades.map((trade) => (
                  <tr key={trade.$id} className="hover:bg-white/[0.01]">
                    <td className="px-4 py-4 text-zinc-500 font-mono">{new Date(trade.$createdAt).toLocaleString()}</td>
                    <td className="px-4 py-4 text-zinc-300">{trade.strategyName}</td>
                    <td className={cn("px-4 py-4 font-bold", trade.signal === "UP" ? "text-green-400" : "text-red-400")}>{trade.signal}</td>
                    <td className="px-4 py-4 text-zinc-300 font-mono">{trade.entry ? `$${trade.entry.toFixed(2)}` : "---"}</td>
                    <td className="px-4 py-4 text-zinc-300 font-mono">{trade.exit ? `$${trade.exit.toFixed(2)}` : "---"}</td>
                    <td className="px-4 py-4">
                      <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase", trade.result === "won" ? "bg-green-500/20 text-green-500 border border-green-500/20" : trade.result === "loss" ? "bg-red-500/20 text-red-500 border border-red-500/20" : "bg-zinc-800 text-zinc-400")}>
                        {trade.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
