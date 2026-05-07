"use client"

import { useState } from "react"
import Link from "next/link"
import { Wallet, ChevronDown, Bitcoin, Activity } from "lucide-react"
import { cn } from "@/lib/utils"

// Polymarket Event Structure
const ASSET_OPTIONS = [
  { id: "BTC", name: "Bitcoin", icon: "₿", color: "#F7931A", fullName: "BTC Up or Down" },
  { id: "ETH", name: "Ethereum", icon: "Ξ", color: "#627EEA", fullName: "ETH Up or Down" },
  { id: "SOL", name: "Solana", icon: "◎", color: "#14F195", fullName: "SOL Up or Down" },
  { id: "XRP", name: "XRP", icon: "✕", color: "#23292F", fullName: "XRP Up or Down" },
  { id: "DOGE", name: "Dogecoin", icon: "Ð", color: "#C2A633", fullName: "DOGE Up or Down" },
  { id: "HYPE", name: "Hyperliquid", icon: "H", color: "#00FF94", fullName: "HYPE Up or Down" },
  { id: "BNB", name: "BNB", icon: "B", color: "#F3BA2F", fullName: "BNB Up or Down" },
]

const TIMEFRAME_OPTIONS = [
  { id: "5m", name: "5M", label: "5 Minutes", seconds: 300 },
  { id: "15m", name: "15M", label: "15 Minutes", seconds: 900 },
  { id: "1h", name: "1H", label: "1 Hour", seconds: 3600 },
  { id: "4h", name: "4H", label: "4 Hours", seconds: 14400 },
]

interface NavbarProps {
  selectedAsset?: string
  selectedTimeframe?: string
  onAssetChange?: (asset: string) => void
  onTimeframeChange?: (timeframe: string) => void
  walletConnected?: boolean
  walletAddress?: string
  onConnectWallet?: () => void
}

export function Navbar({
  selectedAsset = "BTC",
  selectedTimeframe = "5m",
  onAssetChange,
  onTimeframeChange,
  walletConnected = false,
  walletAddress,
  onConnectWallet,
}: NavbarProps) {
  const [assetOpen, setAssetOpen] = useState(false)
  const [timeframeOpen, setTimeframeOpen] = useState(false)

  const selectedAssetData = ASSET_OPTIONS.find((a) => a.id === selectedAsset)
  const selectedTimeframeData = TIMEFRAME_OPTIONS.find((t) => t.id === selectedTimeframe)
  
  // Polymarket-style event name: "BTC Up or Down 5m"
  const eventName = selectedAssetData && selectedTimeframeData 
    ? `${selectedAssetData.fullName} ${selectedTimeframeData.name}`
    : "Select Event"

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#222222] bg-[#0a0a0a]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0a0a0a]/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500">
                <Activity className="h-6 w-6 text-white" />
              </div>
              <span className="hidden text-xl font-bold text-white sm:block">Dextrip</span>
            </Link>
          </div>

          {/* Center Controls */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Event Display */}
            <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-[#222222] bg-[#121212]">
              <span className="text-sm font-medium text-white">{eventName}</span>
              <span className="text-xs text-emerald-400">● Live</span>
            </div>

            {/* Asset Selector */}
            <div className="relative">
              <button
                onClick={() => setAssetOpen(!assetOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-[#222222] bg-[#121212] px-3 py-2 text-sm font-medium text-white transition-all hover:border-[#333333] hover:bg-[#1a1a1a]",
                  assetOpen && "border-emerald-500/50"
                )}
              >
                <span className="text-lg">{selectedAssetData?.icon}</span>
                <span className="hidden sm:inline">{selectedAssetData?.name}</span>
                <span className="sm:hidden">{selectedAssetData?.id}</span>
                <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", assetOpen && "rotate-180")} />
              </button>

              {assetOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-xl border border-[#222222] bg-[#121212] p-1 shadow-2xl">
                  {ASSET_OPTIONS.map((asset) => (
                    <button
                      key={asset.id}
                      onClick={() => {
                        onAssetChange?.(asset.id)
                        setAssetOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        selectedAsset === asset.id
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "text-zinc-300 hover:bg-[#1a1a1a] hover:text-white"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{asset.icon}</span>
                        <div>
                          <span className="font-medium block">{asset.name}</span>
                          <span className="text-[10px] text-zinc-500">{asset.fullName}</span>
                        </div>
                      </div>
                      <span className="text-xs text-zinc-500">{asset.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Timeframe Selector */}
            <div className="relative">
              <button
                onClick={() => setTimeframeOpen(!timeframeOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-[#222222] bg-[#121212] px-3 py-2 text-sm font-medium text-white transition-all hover:border-[#333333] hover:bg-[#1a1a1a]",
                  timeframeOpen && "border-cyan-500/50"
                )}
              >
                <span className="hidden sm:inline">{selectedTimeframeData?.name}</span>
                <span className="sm:hidden">{selectedTimeframeData?.id}</span>
                <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", timeframeOpen && "rotate-180")} />
              </button>

              {timeframeOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-44 rounded-xl border border-[#222222] bg-[#121212] p-1 shadow-2xl">
                  {TIMEFRAME_OPTIONS.map((timeframe) => (
                    <button
                      key={timeframe.id}
                      onClick={() => {
                        onTimeframeChange?.(timeframe.id)
                        setTimeframeOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        selectedTimeframe === timeframe.id
                          ? "bg-cyan-500/10 text-cyan-400"
                          : "text-zinc-300 hover:bg-[#1a1a1a] hover:text-white"
                      )}
                    >
                      <span className="font-medium">{timeframe.name}</span>
                      <span className="text-xs text-zinc-500">{timeframe.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Connect Wallet */}
          <div className="flex items-center">
            <button
              onClick={onConnectWallet}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                walletConnected
                  ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400"
              )}
            >
              <Wallet className="h-4 w-4" />
              <span className="hidden sm:inline">
                {walletConnected
                  ? `${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}`
                  : "Connect Wallet"}
              </span>
              <span className="sm:hidden">{walletConnected ? "Connected" : "Connect"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Click outside to close dropdowns */}
      {(assetOpen || timeframeOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setAssetOpen(false)
            setTimeframeOpen(false)
          }}
        />
      )}
    </nav>
  )
}
