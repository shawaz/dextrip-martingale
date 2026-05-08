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
  capital: number
  ladder: number[]
  status: "idle" | "active" | "broken" | "ready"
  triggerActive?: boolean
  isLive?: boolean
}

export default function DextripMartingale() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [sseConnected, setSseConnected] = useState(false)
  const [timeLeft, setTimeLeft] = useState("0:00")
  const [targetValue, setTargetValue] = useState("5")
  const [multiplierValue, setMultiplierValue] = useState("3")
  const [stepsValue, setStepsValue] = useState("8")
  const [showSettings, setShowSettings] = useState(false)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [trendThresholdValue, setTrendThresholdValue] = useState("8")
  const [tradeFilter, setTradeFilter] = useState("")
  const [streakFilter, setStreakFilter] = useState("all")
  const [directionFilter, setDirectionFilter] = useState("all")
  const [toggling, setToggling] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"live" | "paper">("live")

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
      // Use display values when pending restart (current settings, not snapshot)
      if (json?.displayTargetProfit != null) setTargetValue(String(json.displayTargetProfit))
      else if (json?.targetProfit) setTargetValue(String(json.targetProfit))
      if (json?.displayMultiplier != null) setMultiplierValue(String(json.displayMultiplier))
      else if (json?.multiplier) setMultiplierValue(String(json.multiplier))
      if (json?.displayLadderSteps != null) setStepsValue(String(json.displayLadderSteps))
      else if (json?.ladderSteps) setStepsValue(String(json.ladderSteps))
      if (json?.displayTrendThreshold != null) setTrendThresholdValue(String(json.displayTrendThreshold))
      else if (json?.trendStrengthThreshold != null) setTrendThresholdValue(String(json.trendStrengthThreshold))
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
    return matchesText && matchesStreak && matchesDirection
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
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 min-w-[70px] text-center">
                      <span className={cn("text-xl font-bold font-mono", data.rsi > 70 ? "text-red-400" : data.rsi < 30 ? "text-emerald-400" : "text-white")}>
                        {Number(data.rsi).toFixed(1)}
                      </span>
                    </div>
                    <span className="text-[9px] uppercase tracking-tighter text-zinc-600 font-bold mt-1">RSI (14)</span>
                  </div>
                )}
                {data?.trend && (
                  <div className="flex flex-col items-center">
                    <div className={cn("rounded-lg border px-3 py-2 min-w-[70px] text-center",
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
              <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                <span>${targetValue}</span>
                <span className="text-zinc-700">|</span>
                <span>{multiplierValue}x</span>
                <span className="text-zinc-700">|</span>
                <span>{stepsValue} steps</span>
              </div>

              <button
                onClick={async () => {
                  if (confirm("Are you sure you want to reset all data? This will clear all paper trade history.")) {
                    const res = await fetch("/api/btc-5m?reset=true")
                    setData(await res.json())
                  }
                }}
                className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-bold uppercase tracking-widest text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Reset
              </button>

              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 rounded-lg border border-[#222222] bg-[#1a1a1a] px-3 py-2 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
              >
                <Bolt className="w-3.5 h-3.5" />
              </button>

            </div>
          </div>



          {activeTab === "live" ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "Live Balance", value: data?.liveSummary?.balance != null ? `$${Number(data.liveSummary.balance).toFixed(2)}` : `Check Wallet`, cayan: true },
                  { label: "Wallet", value: data?.wallet?.wallet ? `${data.wallet.wallet.slice(0, 6)}...${data.wallet.wallet.slice(-4)}` : "Not Set", danger: !data?.wallet?.wallet },
                  { label: "Status", value: data?.wallet?.connected ? "Connected" : "Disconnected", cayan: !!data?.wallet?.connected, danger: !data?.wallet?.connected },
                  { label: "Last Check", value: data?.wallet?.lastUpdated ? new Date(data.wallet.lastUpdated).toLocaleTimeString() : "Never", danger: true },
                ].map((stat: any) => (
                  <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                    <div className={cn("mt-2 text-xl font-semibold", stat.danger ? "text-red-400" : stat.cayan ? "text-cyan-400" : stat.emerald ? "text-emerald-400" : "text-white")}>{stat.value}</div>
                  </div>
                ))}
              </div>

            </>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-3">
              {[
                { label: "Earnings", value: `$${Number(stats.balance).toFixed(2)}`, cayan: true },
                { label: "Invested", value: `$${Number(stats.invested).toFixed(2)}`, warning: true },
                { label: "Total Capital", value: `$${Number(stats.capital).toFixed(2)}` },

              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-[#222222] bg-[#121212] p-4">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{stat.label}</div>
                  <div className={cn("mt-2 text-xl font-semibold", stat.warning ? "text-amber-400" : stat.cayan ? "text-emerald-400" : "text-white")}>{stat.value}</div>
                </div>
              ))}
            </div>
          )}

          {data?.pendingRestart && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-400 font-mono">
              New settings will take effect after the current candle closes
            </div>
          )}

          {data?.recentResultsIcons && data.recentResultsIcons.length > 0 && (
            <div className="flex items-center gap-2 p-4 rounded-xl border border-[#222222] bg-[#121212] overflow-x-auto">
              <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest shrink-0 mr-1">History:</span>
              {data.recentResultsIcons.map((icon: string, i: number) => (
                icon === "↑" ? (
                  <CircleArrowUp key={i} className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <CircleArrowDown key={i} className="w-4 h-4 text-red-400 shrink-0" />
                )
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
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Ladder</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Invested</th>
                  <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Returns</th>
                  {activeTab === "paper" ? <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Balance</th> : null}
                  {activeTab === "live" ? <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Live</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {rows.map((row) => (
                  <tr key={row.id} className={cn("hover:bg-white/[0.01]", row.status === "broken" && "bg-red-500/5")}>
                    <td className="px-4 py-4 font-mono text-zinc-300">{row.roundsCompleted}</td>

                    <td className="px-4 py-4 font-semibold text-zinc-100">{row.name.replace(/\s+(UP|DOWN)$/i, "")}</td>
                    <td className="px-4 py-4 text-zinc-300">{row.direction}</td>
                    <td className="px-4 py-4 text-zinc-400">
                      <div className="flex flex-wrap gap-2">
                        {row.ladder.map((value, index) => (
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
                    <td className="px-4 py-4 font-mono text-amber-400">${Number(activeTab === "live" ? row.liveInvested ?? 0 : row.invested).toFixed(2)}</td>
                    <td className="px-4 py-4 font-mono text-cyan-400">${(() => {
                      const ladder = row.ladder;
                      const step = row.currentStep;
                      if (step <= 0) return ladder[0].toFixed(2);
                      if (step > ladder.length) return "0.00";
                      const currentStake = ladder[step - 1];
                      const previousStakes = ladder.slice(0, step - 1).reduce((a, b) => a + b, 0);
                      return (currentStake - previousStakes).toFixed(2);
                    })()}</td>
                    {activeTab === "paper" ? (
                      <td className="px-4 py-4 font-mono text-white">${(row.balance ?? 0).toFixed(2)}</td>
                    ) : null}
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
                    <th className="px-4 py-3 font-bold uppercase tracking-widest text-zinc-500 text-[9px]">Balance</th>
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
                      <td className={cn("px-4 py-4 font-mono", trade.tradeProfit >= 0 ? "text-emerald-400" : "text-red-400")}>${Number(trade.tradeProfit ?? 0).toFixed(2)}</td>
                      <td className={cn("px-4 py-4 font-mono font-semibold", (trade.runningBalance ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>${Number(trade.runningBalance ?? 0).toFixed(2)}</td>
                      <td className={cn("px-4 py-4 font-semibold", trade.result === "won" ? "text-emerald-400" : trade.result === "loss" ? "text-red-400" : "text-amber-400")}>
                        {trade.result === "won" ? "WIN" : trade.result === "loss" ? "LOSS" : trade.orderStatus === "settled" ? "SETTLED" : "PENDING"}
                      </td>
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
                      <td className={cn("px-4 py-4 font-semibold", trade.result === "won" ? "text-emerald-400" : trade.result === "loss" ? "text-red-400" : "text-amber-400")}>
                        {trade.result === "won" ? "WIN" : trade.result === "loss" ? "LOSS" : "PENDING"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="rounded-2xl border border-[#333] bg-[#1a1a1a] p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-white mb-6">Settings</h2>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Base Target</label>
                <div className="flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2.5">
                  <span className="text-zinc-500 text-sm font-mono mr-2">$</span>
                  <input
                    type="number"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
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
                    value={multiplierValue}
                    onChange={(e) => setMultiplierValue(e.target.value)}
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
                    value={stepsValue}
                    onChange={(e) => setStepsValue(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-white text-sm font-mono w-full"
                  />
                </div>
              </div>

              <div className="bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-3">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Preview Ladder</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(() => {
                    const t = Number(targetValue) || 5
                    const m = Number(multiplierValue) || 3
                    const s = Number(stepsValue) || 8
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

              <div>
                <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2 block">Trend Threshold (0-20)</label>
                <div className="flex items-center bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2.5">
                  <input
                    type="number"
                    min="0"
                    max="20"
                    step="0.5"
                    value={trendThresholdValue}
                    onChange={(e) => setTrendThresholdValue(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-white text-sm font-mono w-full"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className={cn("h-1.5 rounded-full flex-1", Number(trendThresholdValue) >= 8 ? "bg-zinc-700" : "bg-zinc-800")}>
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all" style={{ width: `${Math.min(100, (Number(trendThresholdValue) || 0) * 5)}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 min-w-[20px] text-right">{trendThresholdValue}</span>
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">Higher = less sensitive to trend. Set to 0 to disable.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                className="flex-1 rounded-lg border border-[#333] bg-transparent py-2.5 text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setSettingsLoading(true)
                  const target = Number(targetValue)
                  const multiplier = Number(multiplierValue)
                  const steps = Number(stepsValue)
                  const trendThreshold = Number(trendThresholdValue)
                  if (target > 0 && multiplier > 1 && steps >= 2 && steps <= 20) {
                    await fetch(`/api/btc-5m?target=${target}&multiplier=${multiplier}&steps=${steps}&trendThreshold=${trendThreshold}&applyNextWindow=true`)
                    const res = await fetch("/api/btc-5m")
                    setData(await res.json())
                    setShowSettings(false)
                  }
                  setSettingsLoading(false)
                }}
                disabled={settingsLoading}
                className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {settingsLoading ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
