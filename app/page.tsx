"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Row = {
  id: string
  name: string
  direction: "UP" | "DOWN"
  roundsCompleted: number
  currentStep: number
  previousStep: number
  invested: number
  liveInvested?: number
  targetProfit: number
  profit: number
  liveProfit?: number
  loss: number
  capital: number
  ladder: number[]
  status: "idle" | "active" | "broken" | "ready"
  triggerActive?: boolean
  isLive?: boolean
}

export default function DextripMartingale() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState("0:00")
  const [targetValue, setTargetValue] = useState("5")
  const [tradeFilter, setTradeFilter] = useState("")
  const [streakFilter, setStreakFilter] = useState("all")
  const [directionFilter, setDirectionFilter] = useState("all")
  const [toggling, setToggling] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"live" | "paper">("live")

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/btc-5m")
      const json = await res.json()
      setData(json)
      if (json?.targetProfit) setTargetValue(String(json.targetProfit))
      setLoading(false)
    }
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const updateTimer = () => {
      const ms = Date.now()
      const nextWindow = Math.ceil(ms / 300000) * 300000
      const diff = nextWindow - ms
      const mins = Math.floor(diff / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${mins}:${secs.toString().padStart(2, "0")}`)
    }
    updateTimer()
    const timer = setInterval(updateTimer, 1000)
    return () => clearInterval(timer)
  }, [])

  const rows: Row[] = data?.rows ?? []
  const stats = data?.stats ?? { invested: 0, profits: 0, capital: 0, portfolio: 0 }
  const filteredTrades = (data?.recentTrades ?? []).filter((trade: any) => {
    const row = rows.find((item) => item.id === trade.agentId)
    const haystack = `${row?.name ?? trade.agentId} ${trade.windowLabel ?? trade.roundId} ${trade.signal} ${trade.result}`.toLowerCase()
    const matchesText = haystack.includes(tradeFilter.toLowerCase())
    const matchesStreak = streakFilter === "all" || trade.agentId === streakFilter
    const matchesDirection = directionFilter === "all" || trade.signal === directionFilter
    return matchesText && matchesStreak && matchesDirection
  })
  const filteredLadderCount = new Set(filteredTrades.map((trade: any) => trade.roundId)).size

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-4 font-sans text-white md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">



        <div className="rounded-3xl border border-[#222222] bg-[#121212] overflow-hidden shadow-2xl">
          <div className="p-6 md:p-8 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">BTC-5M</h1>
                {data?.currentWindow && (
                  <p className="text-zinc-500 font-medium text-sm">
                    {new Date(data.currentWindow.startTime).toLocaleDateString("en-US", { month: "long", day: "numeric" })}, {new Date(data.currentWindow.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })} - {new Date(data.currentWindow.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-4">
                {data?.rsi != null && (
                  <div className="flex flex-col items-center">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 min-w-[70px] text-center">
                      <span className={cn("text-xl font-bold font-mono", data.rsi > 70 ? "text-red-400" : data.rsi < 30 ? "text-emerald-400" : "text-white")}>
                        {Number(data.rsi).toFixed(1)}
                      </span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">RSI (14)</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <div className="flex flex-col items-center">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 min-w-[50px] text-center">
                      <span className="text-xl font-bold text-white font-mono">{timeLeft.split(":")[0]}</span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">Mins</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 min-w-[50px] text-center">
                      <span className="text-xl font-bold text-white font-mono">{timeLeft.split(":")[1]}</span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">Secs</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="h-1 w-full bg-zinc-800">
            <div className="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style={{ width: `${(1 - (parseInt(timeLeft.split(":")[0]) * 60 + parseInt(timeLeft.split(":")[1])) / 300) * 100}%` }} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("live")}
                className={cn(
                  "rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest",
                  activeTab === "live"
                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-400"
                    : "border-[#222222] bg-[#121212] text-zinc-500"
                )}
              >
                Live
              </button>
              <button
                onClick={() => setActiveTab("paper")}
                className={cn(
                  "rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest",
                  activeTab === "paper"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-[#222222] bg-[#121212] text-zinc-500"
                )}
              >
                Paper
              </button>

            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Base Target:</span>
              <div className="flex items-center bg-[#1a1a1a] border border-[#222222] rounded-lg px-2 py-2">
                <span className="text-zinc-500 text-xs font-mono mr-2">$</span>
                <input
                  type="number"
                  value={targetValue}
                  onChange={async (e) => {
                    const val = e.target.value
                    setTargetValue(val)
                    const num = Number(val)
                    if (num > 0) {
                      const res = await fetch(`/api/btc-5m?target=${num}`)
                      setData(await res.json())
                    }
                  }}
                  className="bg-transparent border-none focus:outline-none text-white text-xs font-mono w-12"
                />
              </div>

            </div>
          </div>



          {activeTab === "live" ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "Live Balance", value: data?.liveSummary?.balance != null ? `$${Number(data.liveSummary.balance).toFixed(2)}` : `$0.00` },
                  { label: "Connection", value: data?.wallet?.connected ? "Connected" : "Disconnected", cayan: !!data?.wallet?.connected, danger: !data?.wallet?.connected },
                  { label: "Live Invested", value: data?.liveSummary?.invested != null ? `$${Number(data.liveSummary.invested).toFixed(2)}` : `$0.00`, danger: true },
                  { label: "Live Profits", value: data?.liveSummary?.profits != null ? `$${Number(data.liveSummary.profits).toFixed(2)}` : `$0.00`, emerald: true },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                    <div className={cn("mt-2 text-xl font-semibold", stat.danger ? "text-red-400" : stat.cayan ? "text-cyan-400" : stat.emerald ? "text-emerald-400" : "text-white")}>{stat.value}</div>
                  </div>
                ))}
              </div>

            </>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "Paper Balance", value: `$${Number(stats.capital).toFixed(2)}` },
                { label: "Paper Returns", value: `$${Number(stats.portfolio).toFixed(2)}`, cayan: true },
                { label: "Paper Invested", value: `$${Number(stats.invested).toFixed(2)}`, danger: true },
                { label: "Paper Profits", value: `$${Number(stats.profits).toFixed(2)}`, emerald: true },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                  <div className={cn("mt-2 text-xl font-semibold", stat.danger ? "text-red-400" : stat.cayan ? "text-cyan-400" : stat.emerald ? "text-emerald-400" : "text-white")}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}

          {data?.recentResultsIcons && data.recentResultsIcons.length > 0 && (
            <div className="flex items-center gap-1 p-3 rounded-xl border border-[#222222] bg-[#121212] overflow-x-auto">
              {data.recentResultsIcons.map((icon: string, i: number) => (
                <span
                  key={i}
                  className={cn(
                    "text-lg font-bold shrink-0",
                    icon === "↑" ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {icon}
                </span>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-[#222222] bg-[#121212]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                <tr>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Rounds</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Direction</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Status</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Ladder</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Break</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Target</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Invested</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Profit</th>
                  {activeTab === "live" ? <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Live</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {rows.map((row) => (
                  <tr key={row.id} className={cn("hover:bg-white/[0.01]", row.status === "broken" && "bg-red-500/5")}>
                    <td className="px-4 py-4 font-mono text-zinc-300">{row.roundsCompleted}</td>

                    <td className="px-4 py-4 font-semibold text-zinc-100">{row.name.replace(/\s+(UP|DOWN)$/i, "")}</td>
                    <td className="px-4 py-4 text-zinc-300">{row.direction}</td>
                    <td className="px-4 py-4">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tighter",
                        row.status === "broken"
                          ? "bg-red-500/10 text-red-400"
                          : row.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : row.triggerActive
                              ? "bg-cyan-500/10 text-cyan-400"
                              : "bg-zinc-800 text-zinc-400"
                      )}>
                        {row.status === "active" ? "active" : row.triggerActive ? "armed" : row.status === "broken" ? "broken" : "idle"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-zinc-400">
                      <div className="flex flex-wrap gap-2">
                        {row.ladder.slice(0, 5).map((value, index) => (
                          <span
                            key={value}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[10px] font-bold",
                              row.currentStep === index + 1
                                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                                : row.previousStep === index + 1
                                  ? "border-red-500/20 bg-red-500/10 text-red-400"
                                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
                            )}
                          >
                            ${value}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-zinc-400">
                      <div className="flex flex-wrap gap-2">
                        {row.ladder.slice(4, 5).map((value) => (
                          <span key={value} className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold text-sky-300">
                            ${value}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-cyan-400">${row.targetProfit.toFixed(2)}</td>
                    <td className="px-4 py-4 font-mono text-red-400">${Number(activeTab === "live" ? row.liveInvested ?? 0 : row.invested).toFixed(2)}</td>
                    <td className="px-4 py-4 font-mono text-emerald-400">${Number(activeTab === "live" ? row.liveProfit ?? 0 : row.profit).toFixed(2)}</td>
                    {activeTab === "live" ? (
                      <td className="px-4 py-4">
                        <button
                          disabled={toggling === row.id}
                          onClick={async () => {
                            setToggling(row.id)
                            const newEnabled = !row.isLive
                            await fetch(`/api/btc-5m?toggleLive=${row.id}&liveEnabled=${newEnabled}`)
                            const res = await fetch("/api/btc-5m")
                            setData(await res.json())
                            setToggling(null)
                          }}
                          className={cn(
                            "rounded-lg px-3 py-1 text-[10px] font-bold uppercase tracking-widest border",
                            row.isLive
                              ? "border-red-500/20 bg-red-500/10 text-red-400"
                              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          )}
                        >
                          {toggling === row.id ? "..." : row.isLive ? "Stop" : "Live"}
                        </button>
                      </td>
                    ) : null}

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {activeTab === "paper" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Paper Trade History</h2>
                <div className="text-xs text-zinc-500">Rows: {filteredTrades.length} • Ladder count: {filteredLadderCount}</div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value)}
                  placeholder="Filter trade history"
                  className="bg-[#121212] border border-[#222222] rounded-lg px-3 py-2 text-xs text-white outline-none"
                />
                <select value={streakFilter} onChange={(e) => setStreakFilter(e.target.value)} className="bg-[#121212] border border-[#222222] rounded-lg px-3 py-2 text-xs text-white outline-none">
                  <option value="all">All streaks</option>
                  {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="bg-[#121212] border border-[#222222] rounded-lg px-3 py-2 text-xs text-white outline-none">
                  <option value="all">All directions</option>
                  <option value="UP">UP</option>
                  <option value="DOWN">DOWN</option>
                </select>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#222222] bg-[#121212]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                  <tr>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Window</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Signal</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stake</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stage</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Profit</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {filteredTrades.map((trade: any) => (
                    <tr key={trade.id} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-4 text-zinc-100 font-semibold">{rows.find((row) => row.id === trade.agentId)?.name ?? trade.agentId}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.windowLabel ?? trade.roundId}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.signal}</td>
                      <td className="px-4 py-4 font-mono text-zinc-300">${Number(trade.stake ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.closedStage ? `Closed ${trade.closedStage}` : trade.ladderStage ? `Stage ${trade.ladderStage}` : "--"}</td>
                      <td className="px-4 py-4 font-mono text-emerald-400">${Number(trade.tradeProfit ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Live Trade History</h2>
            <div className="overflow-hidden rounded-2xl border border-[#222222] bg-[#121212]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                  <tr>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Window</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Direction</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stake</th>
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {(data?.liveHistory ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">No live trades yet</td>
                    </tr>
                  ) : (data.liveHistory ?? []).map((trade: any) => (
                    <tr key={trade.id} className="hover:bg-white/[0.01]">
                      <td className="px-4 py-4 text-zinc-100 font-semibold">{rows.find((row) => row.id === trade.agentId)?.name ?? trade.agentId}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.windowLabel ?? trade.roundId}</td>
                      <td className="px-4 py-4 text-zinc-300">{trade.signal}</td>
                      <td className="px-4 py-4 font-mono text-zinc-300">${Number(trade.stake ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-4 text-emerald-400">{trade.orderStatus ?? trade.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
