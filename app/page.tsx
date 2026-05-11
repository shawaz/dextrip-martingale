"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Loader2, CircleArrowUp, CircleArrowDown, Settings, Bolt } from "lucide-react"
import { cn } from "@/lib/utils"
import { Navbar } from "@/components/navbar"

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
  balance: number
  realBalance?: number
  capital: number
  ladder: number[]
  status: "idle" | "active" | "broken" | "ready"
  triggerActive?: boolean
  isLive?: boolean
  agentTarget: number
  agentMultiplier: number
  agentSteps: number
}

export default function DextripMartingale() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [sseConnected, setSseConnected] = useState(false)
  const [timeLeft, setTimeLeft] = useState("0:00")
  const [tradeFilter, setTradeFilter] = useState("")
  const [streakFilter, setStreakFilter] = useState("all")
  const [directionFilter, setDirectionFilter] = useState("all")
  const [toggling, setToggling] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"live" | "paper">("live")
  const [editingAgent, setEditingAgent] = useState<string | null>(null)
  const [agentTarget, setAgentTarget] = useState("5")
  const [agentMultiplier, setAgentMultiplier] = useState("3")
  const [agentSteps, setAgentSteps] = useState("8")
  const [displayLimit, setDisplayLimit] = useState(25)
  const [stageFilter, setStageFilter] = useState("all")

  useEffect(() => {
    let isMounted = true

    const connectSSE = async () => {
      try {
        const eventSource = new EventSource("/api/btc-5m/stream")

        eventSource.onmessage = (event) => {
          if (!isMounted) return
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === "update" && msg.data) {
              setData((prev: any) => ({ ...prev, ...msg.data }))
            } else if (msg.type === "ping" || msg.type === "connected") {
              fetchData()
            }
          } catch { }
        }

        eventSource.onerror = () => {
          eventSource.close()
          setTimeout(() => {
            if (isMounted) connectSSE()
          }, 5000)
        }

        setSseConnected(true)
      } catch { }
    }

    const fetchData = async () => {
      const res = await fetch("/api/btc-5m")
      const json = await res.json()
      setData(json)
      setLoading(false)
    }

    fetchData()
    connectSSE()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date()
      const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
      const etSeconds = etTime.getHours() * 3600 + etTime.getMinutes() * 60 + etTime.getSeconds() + etTime.getMilliseconds() / 1000
      const windowSeconds = Math.floor(etSeconds / 300) * 300 + 300
      const diff = (windowSeconds - etSeconds) * 1000
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
    const matchesStage = stageFilter === "all" || String(trade.ladderStage) === stageFilter || String(trade.closedStage) === stageFilter
    return matchesText && matchesStreak && matchesDirection && matchesStage
  })
  const filteredLadderCount = new Set(filteredTrades.map((trade: any) => trade.roundId)).size

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-sans text-white">
      <Navbar
        selectedAsset="BTC"
        selectedTimeframe="5m"
        onAssetChange={(asset) => console.log("Selected asset:", asset)}
        onTimeframeChange={(timeframe) => console.log("Selected timeframe:", timeframe)}
        walletConnected={data?.wallet?.connected}
        walletAddress={data?.wallet?.wallet}
        onConnectWallet={() => console.log("Connect wallet clicked")}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <div className="rounded-3xl border border-[#222222] bg-[#121212] overflow-hidden shadow-2xl">
          <div className="p-6 md:p-8 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">BTC-5M</h1>
                {data?.currentWindow && (
                  <span className="text-sm text-zinc-400">
                    {new Date(data.currentWindow.startTime).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" })}, {new Date(data.currentWindow.startTime).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })} - {new Date(data.currentWindow.endTime).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true })}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {data?.rsi != null && (
                  <div className="flex flex-col items-center">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 min-w-[55px] md:min-w-[70px] text-center">
                      <span className={cn("text-xl font-bold font-mono", data.rsi > 70 ? "text-red-400" : data.rsi < 30 ? "text-emerald-400" : "text-white")}>
                        {Number(data.rsi).toFixed(1)}
                      </span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">RSI (14)</span>
                  </div>
                )}
                {data?.trend && (
                  <div className="flex flex-col items-center">
                    <div className={cn("rounded-lg border px-3 py-2 min-w-[55px] md:min-w-[70px] text-center",
                      data.trend.direction === "up" ? "bg-emerald-500/10 border-emerald-500/30" :
                        data.trend.direction === "down" ? "bg-red-500/10 border-red-500/30" :
                          "bg-zinc-900 border-zinc-800"
                    )}>
                      <span className={cn("text-lg font-bold font-mono",
                        data.trend.direction === "up" ? "text-emerald-400" :
                          data.trend.direction === "down" ? "text-red-400" :
                            "text-zinc-400"
                      )}>
                        {data.trend.direction === "up" ? "UP" : data.trend.direction === "down" ? "DOWN" : "—"}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500 ml-1">
                        {data.trend.strength}
                      </span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">
                      {data.trend.strength >= (data.trendStrengthThreshold ?? 8)
                        ? `TREND ≥${data.trendStrengthThreshold ?? 8}`
                        : `TREND <${data.trendStrengthThreshold ?? 8}`}
                    </span>
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
        {data?.recentResultsIcons && data.recentResultsIcons.length > 0 && (
          <div className="flex items-center gap-2 p-4 rounded-xl border border-[#222222] bg-[#121212] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest shrink-0 mr-1">RESULTS:</span>
            <span className="text-[10px] text-zinc-500 font-mono mr-2">{data.recentResultsIcons.length}</span>
            {data.recentResultsIcons.map((icon: string, i: number) => (
              icon === "↑" ? (
                <CircleArrowUp key={i} className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <CircleArrowDown key={i} className="w-4 h-4 text-red-400 shrink-0" />
              )
            ))}
          </div>
        )}
        <div className="space-y-4">
          {activeTab === "live" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Invested", value: `$${Number(data?.liveStats?.invested ?? 0).toFixed(2)}`, warning: true },
                { label: "Earnings", value: `$${Number(data?.liveStats?.profits ?? 0).toFixed(2)}`, emerald: true },
                { label: "Balance", value: `$${Number(data?.liveStats?.balance ?? 0).toFixed(2)}`, cayan: true },
                { label: "Capital", value: `$${Number(data?.liveStats?.capital ?? 0).toFixed(2)}` },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                  <div className={cn("mt-2 text-xl font-semibold", stat.warning ? "text-amber-400" : stat.emerald ? "text-emerald-400" : stat.cayan ? "text-cayan-400" : "text-white")}>{stat.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Invested", value: `$${Number(stats.invested).toFixed(2)}`, warning: true },
                { label: "Earnings", value: `$${Number(stats.profits).toFixed(2)}`, emerald: true },
                { label: "Balance", value: `$${Number(stats.balance).toFixed(2)}`, cayan: true },
                { label: "Capital", value: `$${Number(stats.capital).toFixed(2)}` },


              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                  <div className={cn("mt-2 text-xl font-semibold", stat.warning ? "text-amber-400" : stat.emerald ? "text-emerald-400" : stat.cayan ? "text-cayan-400" : "text-white")}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-[#222222] bg-[#121212]">
            <table className="w-full min-w-[580px] text-left text-xs">
              <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                <tr>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Rounds</th>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Direction</th>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Ladder</th>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Returns</th>
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Invested</th>
                  {activeTab === "paper" ? <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Earnings</th> : null}
                  {activeTab === "live" ? <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Live</th> : null}
                  <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Config</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {rows.map((row) => (
                  <tr key={row.id} className={cn("hover:bg-white/[0.01]", row.status === "broken" && "bg-red-500/5")}>
                    <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-zinc-300 text-nowrap">{row.roundsCompleted}</td>
                    <td className="px-2 md:px-4 py-2 md:py-4 font-semibold text-zinc-100 text-nowrap">{row.name.replace(/\s+(UP|DOWN)$/i, "")}</td>
                    <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{row.direction}</td>
                    <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-400">
                      <div className="flex flex-wrap gap-1 md:gap-2">
                        {row.ladder.map((value, index) => {
                          const isCurrent = row.currentStep === index + 1
                          const pmPrice = data?.polymarketPrices
                            ? (row.direction === "UP" ? data.polymarketPrices.up : data.polymarketPrices.down)
                            : null
                          const pmColor = pmPrice != null
                            ? (pmPrice < 0.50
                                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-300")
                            : null
                          return (
                            <span
                              key={value}
                              className={cn(
                                "rounded-full border px-1.5 md:px-2.5 py-0.5 md:py-1 text-[8px] md:text-[10px] font-bold whitespace-nowrap",
                                isCurrent
                                  ? (pmColor ?? "border-amber-500/20 bg-amber-500/10 text-amber-300")
                                  : row.previousStep === index + 1
                                    ? "border-red-500/20 bg-red-500/10 text-red-400"
                                    : "border-zinc-700 bg-zinc-900 text-zinc-500"
                              )}
                            >
                              ${value}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-cyan-400 text-nowrap">${(() => {
                      const ladder = row.ladder;
                      const step = row.currentStep;
                      if (step <= 0) return ladder[0].toFixed(2);
                      if (step > ladder.length) return "0.00";
                      const currentStake = ladder[step - 1];
                      const previousStakes = ladder.slice(0, step - 1).reduce((a, b) => a + b, 0);
                      return (currentStake - previousStakes).toFixed(2);
                    })()}</td>
                    <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-amber-400 text-nowrap">${Number(activeTab === "live" ? row.liveInvested ?? 0 : row.invested).toFixed(2)}</td>

                    {activeTab === "paper" ? (
                      <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-emerald-400 text-nowrap">${(row.realBalance ?? row.balance ?? 0).toFixed(2)}</td>
                    ) : null}
                    {activeTab === "live" ? (
                      <td className="px-2 md:px-4 py-2 md:py-4 text-nowrap">
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
                    <td className="px-2 md:px-4 py-2 md:py-4">
                      <button
                        onClick={() => {
                          setEditingAgent(row.id)
                          setAgentTarget(String(row.agentTarget))
                          setAgentMultiplier(String(row.agentMultiplier))
                          setAgentSteps(String(row.agentSteps))
                        }}
                        className="flex items-center gap-1 rounded-lg border border-[#222] bg-[#0a0a0a] p-2 text-[10px] font-mono text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
                      >
                        <Bolt className="w-3 h-3" />
                        {/* ${row.agentTarget} / {row.agentMultiplier}x / {row.agentSteps}s */}
                      </button>
                    </td>

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
                <div className="text-xs text-zinc-500">Showing {Math.min(displayLimit, filteredTrades.length)} of {filteredTrades.length} • Ladder count: {filteredLadderCount}</div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <input
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value)}
                  placeholder="Filter trade history"
                  className="bg-[#121212] border border-[#222222] rounded-lg px-3 py-2 text-xs text-white outline-none w-full sm:w-auto"
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
                <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="bg-[#121212] border border-[#222222] rounded-lg px-3 py-2 text-xs text-white outline-none">
                  <option value="all">All stages</option>
                  {[1,2,3,4,5,6,7,8].map((s) => <option key={s} value={s}>Stage {s}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-[#222222] bg-[#121212]">
              <table className="w-full min-w-[580px] text-left text-xs">
                <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                  <tr>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Window</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Signal</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">PM $</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stake</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stage</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Profit</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {filteredTrades.slice(0, displayLimit).map((trade: any) => (
                    <tr key={trade.id} className="hover:bg-white/[0.01]">
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-100 font-semibold text-nowrap">{rows.find((row) => row.id === trade.agentId)?.name ?? trade.agentId}</td>
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{trade.windowLabel ?? trade.roundId}</td>
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{trade.signal}</td>
                      <td className={cn("px-2 md:px-4 py-2 md:py-4 font-mono text-nowrap", trade.polymarketPrice == null ? "text-zinc-600" : Number(trade.polymarketPrice) < 0.50 ? "text-emerald-400" : "text-amber-400")}>
                        {trade.polymarketPrice == null ? "—" : `$${Number(trade.polymarketPrice).toFixed(2)}`}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-zinc-300 text-nowrap">${Number(trade.stake ?? 0).toFixed(2)}</td>
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{trade.closedStage ? `Closed ${trade.closedStage}` : trade.ladderStage ? `Stage ${trade.ladderStage}` : "--"}</td>
                      <td className={cn("px-2 md:px-4 py-2 md:py-4 font-mono text-nowrap", trade.result === "pending" ? "text-zinc-600" : (trade.tradeProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {trade.result === "pending" ? "—" : `$${Number(trade.tradeProfit ?? 0).toFixed(2)}`}
                      </td>
                      <td className={cn("px-2 md:px-4 py-2 md:py-4 font-semibold text-nowrap", trade.result === "won" ? "text-emerald-400" : trade.result === "loss" ? "text-red-400" : "text-amber-400")}>
                        {trade.result === "won" ? "WIN" : trade.result === "loss" ? "LOSS" : trade.orderStatus === "settled" ? "SETTLED" : "PENDING"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredTrades.length > displayLimit && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setDisplayLimit((prev) => prev + 25)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                >
                  Load More ({filteredTrades.length - displayLimit} remaining)
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500">Live Trade History</h2>
            <div className="overflow-x-auto rounded-2xl border border-[#222222] bg-[#121212]">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="border-b border-[#222222] bg-[#1a1a1a]">
                  <tr>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Streak</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Window</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Direction</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">PM $</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Stake</th>
                    <th className="px-2 md:px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {(data?.liveHistory ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 md:px-4 py-6 text-center text-zinc-500">No live trades yet</td>
                    </tr>
                  ) : (data.liveHistory ?? []).slice(0, displayLimit).map((trade: any) => (
                    <tr key={trade.id} className="hover:bg-white/[0.01]">
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-100 font-semibold text-nowrap">{rows.find((row) => row.id === trade.agentId)?.name ?? trade.agentId}</td>
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{trade.windowLabel ?? trade.roundId}</td>
                      <td className="px-2 md:px-4 py-2 md:py-4 text-zinc-300 text-nowrap">{trade.signal}</td>
                      <td className={cn("px-2 md:px-4 py-2 md:py-4 font-mono text-nowrap", trade.polymarketPrice == null ? "text-zinc-600" : Number(trade.polymarketPrice) < 0.50 ? "text-emerald-400" : "text-amber-400")}>
                        {trade.polymarketPrice == null ? "—" : `$${Number(trade.polymarketPrice).toFixed(2)}`}
                      </td>
                      <td className="px-2 md:px-4 py-2 md:py-4 font-mono text-zinc-300 text-nowrap">${Number(trade.stake ?? 0).toFixed(2)}</td>
                      <td className={cn("px-2 md:px-4 py-2 md:py-4 font-semibold text-nowrap", trade.result === "won" ? "text-emerald-400" : trade.result === "loss" ? "text-red-400" : "text-amber-400")}>
                        {trade.result === "won" ? "WIN" : trade.result === "loss" ? "LOSS" : "PENDING"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data?.liveHistory?.length ?? 0) > displayLimit && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setDisplayLimit((prev) => prev + 25)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                >
                  Load More ({(data?.liveHistory?.length ?? 0) - displayLimit} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {editingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setEditingAgent(null)}>
          <div className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-6">Settings — {editingAgent.replace("_5M", "").replace(/_/g, " ")}</h2>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Target</label>
                <div className="flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2.5">
                  <span className="text-zinc-500 text-sm font-mono mr-2">$</span>
                  <input
                    type="number"
                    value={agentTarget}
                    onChange={(e) => setAgentTarget(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-white text-sm font-mono w-full"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Multiplier</label>
                <div className="flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2.5">
                  <input
                    type="number"
                    step="0.1"
                    value={agentMultiplier}
                    onChange={(e) => setAgentMultiplier(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-white text-sm font-mono w-full"
                  />
                  <span className="text-zinc-500 text-sm font-mono ml-1">x</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Steps</label>
                <div className="flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2.5">
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={agentSteps}
                    onChange={(e) => setAgentSteps(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-white text-sm font-mono w-full"
                  />
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-3">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Preview Ladder</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(() => {
                    const t = Number(agentTarget) || 5
                    const m = Number(agentMultiplier) || 3
                    const s = Number(agentSteps) || 8
                    const lad: number[] = []
                    let cur = t
                    for (let i = 0; i < s; i++) {
                      lad.push(Math.max(1, Math.round(cur)))
                      cur *= m
                    }
                    return lad.map((v, i) => (
                      <span key={i} className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[10px] font-bold text-zinc-400">
                        ${v}
                      </span>
                    ))
                  })()}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingAgent(null)}
                className="flex-1 rounded-lg border border-[#333] bg-transparent py-2.5 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const target = Number(agentTarget)
                  const multiplier = Number(agentMultiplier)
                  const steps = Number(agentSteps)
                  if (target > 0 && multiplier > 1 && steps >= 2 && steps <= 20) {
                    await fetch(`/api/btc-5m?saveAgent=${editingAgent}&saveTarget=${target}&saveMultiplier=${multiplier}&saveSteps=${steps}`)
                    const res = await fetch("/api/btc-5m")
                    setData(await res.json())
                    setEditingAgent(null)
                  }
                }}
                className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
