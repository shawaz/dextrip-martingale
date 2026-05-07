"use client"

import { useState } from "react"
import Link from "next/link"
import { Wallet, ChevronDown, Bitcoin, Activity } from "lucide-react"
import { cn } from "@/lib/utils"

const CRYPTO_OPTIONS = [
  { id: "BTC", name: "Bitcoin", icon: "₿", color: "#F7931A" },
  { id: "ETH", name: "Ethereum", icon: "Ξ", color: "#627EEA" },
  { id: "SOL", name: "Solana", icon: "◎", color: "#14F195" },
  { id: "AVAX", name: "Avalanche", icon: "🔺", color: "#E84142" },
  { id: "LINK", name: "Chainlink", icon: "⬡", color: "#2A5ADA" },
]

const TIMEFRAME_OPTIONS = [
  { id: "1m", name: "1 Minute", seconds: 60 },
  { id: "5m", name: "5 Minutes", seconds: 300 },
  { id: "15m", name: "15 Minutes", seconds: 900 },
  { id: "1h", name: "1 Hour", seconds: 3600 },
]

interface NavbarProps {
  selectedCrypto?: string
  selectedTimeframe?: string
  onCryptoChange?: (crypto: string) => void
  onTimeframeChange?: (timeframe: string) => void
  walletConnected?: boolean
  walletAddress?: string
  onConnectWallet?: () => void
}

export function Navbar({
  selectedCrypto = "BTC",
  selectedTimeframe = "5m",
  onCryptoChange,
  onTimeframeChange,
  walletConnected = false,
  walletAddress,
  onConnectWallet,
}: NavbarProps) {
  const [cryptoOpen, setCryptoOpen] = useState(false)
  const [timeframeOpen, setTimeframeOpen] = useState(false)

  const selectedCryptoData = CRYPTO_OPTIONS.find((c) => c.id === selectedCrypto)
  const selectedTimeframeData = TIMEFRAME_OPTIONS.find((t) => t.id === selectedTimeframe)

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
            {/* Crypto Selector */}
            <div className="relative">
              <button
                onClick={() => setCryptoOpen(!cryptoOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-[#222222] bg-[#121212] px-3 py-2 text-sm font-medium text-white transition-all hover:border-[#333333] hover:bg-[#1a1a1a]",
                  cryptoOpen && "border-emerald-500/50"
                )}
              >
                <span className="text-lg">{selectedCryptoData?.icon}</span>
                <span className="hidden sm:inline">{selectedCryptoData?.name}</span>
                <span className="sm:hidden">{selectedCryptoData?.id}</span>
                <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", cryptoOpen && "rotate-180")} />
              </button>

              {cryptoOpen && (
                <div className="absolute left-0 top-full z-50 mt-2 w-48 rounded-xl border border-[#222222] bg-[#121212] p-1 shadow-2xl">
                  {CRYPTO_OPTIONS.map((crypto) => (
                    <button
                      key={crypto.id}
                      onClick={() => {
                        onCryptoChange?.(crypto.id)
                        setCryptoOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        selectedCrypto === crypto.id
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "text-zinc-300 hover:bg-[#1a1a1a] hover:text-white"
                      )}
                    >
                      <span className="text-lg">{crypto.icon}</span>
                      <span className="font-medium">{crypto.name}</span>
                      <span className="ml-auto text-xs text-zinc-500">{crypto.id}</span>
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
      {(cryptoOpen || timeframeOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setCryptoOpen(false)
            setTimeframeOpen(false)
          }}
        />
      )}
    </nav>
  )
}
