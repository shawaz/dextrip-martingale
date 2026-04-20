"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, Clock, Crown, History, LayoutGrid, Zap } from "lucide-react"
import { Query } from "appwrite"
import { databases, client } from "@/lib/appwrite"
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

type Round = {
  $id: string
  roundId: string
  asset: string
  timeframe: "15m" | "1h" | "4h"
  startTime: string
  endTime: string
  entryPrice?: number
  exitPrice?: number
  status: "active" | "closed"
}

type Trade = {
  $id: string
  $createdAt: string
  agentId: string
  roundId: string
  strategyName: string
  signal: "UP" | "DOWN"
  entry?: number
  exit?: number
  result: "pending" | "won" | "loss"
}

function formatCountdown(endTime?: string): string {
  if (!endTime) return "--:--"
  const diff = new Date(endTime).getTime() - Date.now()
  if (diff <= 0) return "00:00"
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
}

export default function ArenaPage() {
  const [activeTab, setActiveTab] = useState("arena")
  const [agents, setAgents] = useState<Agent[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [timeLeft, setTimeLeft] = useState("--:--")

  const fetchData = async () => {
    try {
      const [agentsRes, roundsRes, tradesRes] = await Promise.all([
        databases.listDocuments(dbId, "agents", [Query.limit(100)]),
        databases.listDocuments(dbId, "rounds", [Query.orderDesc("startTime"), Query.limit(50)]),
        databases.listDocuments(dbId, "trades", [Query.orderDesc("$createdAt"), Query.limit(100)]),
      ])
      setAgents(agentsRes.documents as unknown as Agent[])
      setRounds(roundsRes.documents as unknown as Round[])
      setTrades(tradesRes.documents as unknown as Trade[])
    } catch (error) {
      console.error("Failed to fetch data:", error)
    }
  }

  useEffect(() => {
    fetchData()
    const unsubscribe = client.subscribe(
      [
        `databases.${dbId}.collections.agents.documents`,
        `databases.${dbId}.collections.rounds.documents`,
        `databases.${dbId}.collections.trades.documents`,
      ],
      () => fetchData(),
    )
    return () => unsubscribe()
  }, [])

  const activeRounds = useMemo(() => rounds.filter((round) => round.status === "active"), [rounds])

  useEffect(() => {
    const timer = setInterval(() => {
      const nextEnding = [...activeRounds].sort(
        (left, right) => new Date(left.endTime).getTime() - new Date(right.endTime).getTime(),
      )[0]
      setTimeLeft(formatCountdown(nextEnding?.endTime))
    }, 1000)

    return () => clearInterval(timer)
  }, [activeRounds])

  const leaderboardData = useMemo(() => {
    return agents
      .map((agent) => {
        const activeRound = activeRounds.find((round) => round.timeframe === agent.timeframe)
        const latestTrade = trades.find((trade) => trade.agentId === agent.$id && trade.roundId === activeRound?.roundId)
        return {
          ...agent,
          currentTrade: latestTrade,
        }
      })
      .sort((a, b) => Number(b.winRate) - Number(a.winRate) || Number(b.won) - Number(a.won))
  }, [agents, activeRounds, trades])

  const promotedAgents = leaderboardData.filter((agent) => agent.promoted)
  const totalWins = agents.reduce((sum, agent) => sum + Number(agent.won ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Dextrip Arena</h1>
            <p className="text-sm text-zinc-500">Simpsons agents battle across 15m, 1h, and 4h. Top agent per timeframe gets execution rights.</p>
          </div>
          <div className="flex items-center gap-2 bg-red-950/30 border border-red-900/50 text-red-500 px-3 py-1.5 rounded-full text-xs font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            {activeRounds.length ? "Rounds Live" : "Waiting For Bot"}
          </div>
        </div>

        <div className="bg-[#121212] border border-[#222222] rounded-xl p-5 flex flex-col md:flex-row justify-between gap-6 shadow-sm">
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Promoted for live execution</span>
              <div className="flex flex-wrap gap-2 pt-1">
                {promotedAgents.length ? promotedAgents.map((agent) => (
                  <div key={agent.$id} className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs">
                    <Crown className="h-3.5 w-3.5 text-amber-400" />
                    <span>{agent.name}</span>
                    <span className="text-zinc-400">{agent.timeframe}</span>
                    <span className="text-zinc-400">{Math.round(agent.winRate ?? 0)}%</span>
                  </div>
                )) : <span className="text-sm text-zinc-500">No promoted agents yet</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-zinc-400">
              {activeRounds.map((round) => (
                <div key={round.$id} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500/50" />
                  {round.timeframe} entry <span className="text-zinc-100 font-mono font-bold">${round.entryPrice?.toLocaleString() || "0.00"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end justify-center">
            <div className="text-3xl font-mono font-medium tracking-tighter">{timeLeft}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">next round close</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active Agents", value: agents.length, icon: LayoutGrid },
            { label: "Promoted", value: promotedAgents.length, icon: Crown },
            { label: "Total Rounds", value: rounds.length, icon: History },
            { label: "Total Wins", value: totalWins, color: "text-amber-500", icon: Zap },
          ].map((stat, i) => (
            <div key={i} className="bg-[#121212] p-4 rounded-xl space-y-2 border border-[#222222]">
              <div className="flex items-center justify-between text-zinc-500">
                <span className="text-[10px] uppercase tracking-wider font-bold">{stat.label}</span>
                <stat.icon className="w-3 h-3 opacity-50" />
              </div>
              <div className={cn("text-xl font-medium", stat.color)}>{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-[#121212] p-1 rounded-lg border border-[#222222] w-fit shadow-inner">
          {[
            { id: "arena", label: "Arena Leaderboard" },
            { id: "round", label: "Round History" },
            { id: "trade", label: "Trade History" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200",
                activeTab === tab.id ? "bg-[#1a1a1a] text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-[#121212] border border-[#222222] rounded-xl overflow-hidden shadow-sm">
          {activeTab === "arena" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1a1a] border-b border-[#222222]">
                  <tr>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">#</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Agent</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Timeframe</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Strategy</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Signal</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Cards</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Loss</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Won</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Win Rate</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {leaderboardData.map((agent, i) => (
                    <tr key={agent.$id} className="group transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-4 whitespace-nowrap text-zinc-500 font-mono">{i + 1}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg" style={{ backgroundColor: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}30` }}>
                            {agent.init}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-100">{agent.name}</span>
                            {agent.promoted && <Crown className="h-3.5 w-3.5 text-amber-400" />}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-zinc-300">{agent.timeframe}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-zinc-400 italic">{agent.currentTrade?.strategyName || "Searching..."}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold tracking-tighter uppercase border",
                          agent.currentTrade?.signal === "UP" ? "bg-green-500/10 text-green-500 border-green-500/20" : agent.currentTrade?.signal === "DOWN" ? "bg-red-500/10 text-red-500 border-red-500/20" : "bg-zinc-800 text-zinc-500 border-zinc-700",
                        )}>
                          {agent.currentTrade?.signal === "UP" && "▲"}
                          {agent.currentTrade?.signal === "DOWN" && "▼"}
                          {agent.currentTrade?.signal || "WAITING"}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-[240px] flex-wrap gap-1">
                          {(agent.strategyCards ?? []).slice(0, 3).map((card) => (
                            <span key={card} className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[9px] uppercase tracking-wide text-zinc-300">
                              {card}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap font-mono text-red-500/70">{agent.loss}</td>
                      <td className="px-4 py-4 whitespace-nowrap font-mono text-green-500/70">{agent.won}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3 min-w-[100px]">
                          <div className="flex-1 h-1 bg-[#1a1a1a] rounded-full overflow-hidden border border-[#222222]">
                            <div className="h-full rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ width: `${agent.winRate ?? 0}%`, backgroundColor: agent.color }} />
                          </div>
                          <span className="font-mono text-zinc-400 font-bold">{Math.round(agent.winRate ?? 0)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-right">
                        <Link href={`/strategy/${agent.$id}`} className="inline-flex items-center gap-1 bg-transparent border border-[#333333] hover:bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-md transition-all duration-200 text-[10px] font-bold uppercase tracking-wider">
                          Details <ArrowUpRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "round" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1a1a] border-b border-[#222222]">
                  <tr>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Round ID</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Timeframe</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Asset</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Entry</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Exit</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {rounds.map((round) => (
                    <tr key={round.$id} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-4 font-mono text-zinc-400">{round.roundId}</td>
                      <td className="px-4 py-4 text-zinc-300">{round.timeframe}</td>
                      <td className="px-4 py-4 text-zinc-100 font-bold">{round.asset}</td>
                      <td className="px-4 py-4 font-mono text-zinc-300">${round.entryPrice?.toLocaleString() || "---"}</td>
                      <td className="px-4 py-4 font-mono text-zinc-300">${round.exitPrice?.toLocaleString() || "---"}</td>
                      <td className="px-4 py-4">
                        <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest", round.status === "active" ? "bg-green-500/20 text-green-500 border border-green-500/30" : "bg-zinc-800 text-zinc-500")}>
                          {round.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "trade" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1a1a] border-b border-[#222222]">
                  <tr>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Time</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Agent</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Timeframe</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Strategy</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Signal</th>
                    <th className="px-4 py-3 font-bold text-zinc-500 uppercase tracking-widest text-[9px]">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {trades.map((trade) => {
                    const agent = agents.find((candidate) => candidate.$id === trade.agentId)
                    return (
                      <tr key={trade.$id} className="hover:bg-white/[0.01]">
                        <td className="px-4 py-4 text-zinc-500 font-mono">{new Date(trade.$createdAt).toLocaleTimeString()}</td>
                        <td className="px-4 py-4 font-bold text-zinc-100">{agent?.name}</td>
                        <td className="px-4 py-4 text-zinc-400">{agent?.timeframe}</td>
                        <td className="px-4 py-4 text-zinc-400 italic">{trade.strategyName}</td>
                        <td className="px-4 py-4">
                          <span className={cn("font-bold", trade.signal === "UP" ? "text-green-500" : "text-red-500")}>{trade.signal}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={cn("px-2 py-0.5 rounded text-[9px] font-bold uppercase", trade.result === "won" ? "bg-green-500/20 text-green-500 border border-green-500/20" : trade.result === "loss" ? "bg-red-500/20 text-red-500 border border-red-500/20" : "bg-zinc-800 text-zinc-400")}>
                            {trade.result}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
