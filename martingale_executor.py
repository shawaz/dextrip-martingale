import warnings
warnings.filterwarnings("ignore")
import os
import json
import time
import requests
import threading
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
VERCEL_URL = os.getenv("VERCEL_URL", "https://your-dextrip-app.vercel.app").rstrip("/")
PRIVATE_KEY = os.getenv("POLYMARKET_PRIVATE_KEY", "").strip()
FUNDER = os.getenv("POLYMARKET_FUNDER", "").strip()
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "").strip()

from py_clob_client.client import ClobClient
from py_clob_client.clob_types import AssetType, BalanceAllowanceParams, MarketOrderArgs
from py_clob_client.order_builder.constants import BUY

HOST = "https://clob.polymarket.com"
GAMMA_BASE = "https://gamma-api.polymarket.com/markets/slug"
CHAIN_ID = 137

# --- CLIENT INIT ---
try:
    print(f"[INIT] Initializing Polymarket Client...")
    temp_client = ClobClient(HOST, key=PRIVATE_KEY, chain_id=CHAIN_ID, signature_type=2, funder=FUNDER)
    creds = temp_client.create_or_derive_api_creds()
    client = ClobClient(HOST, key=PRIVATE_KEY, chain_id=CHAIN_ID, creds=creds, signature_type=2, funder=FUNDER)
    print("[INIT] Polymarket Client Initialized Successfully")
except Exception as e:
    print(f"[FATAL] Polymarket Client Init Failed: {e}")
    client = None

# --- UTILS ---
def send_telegram(message):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID: return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "HTML"}, timeout=10)
    except: pass

MARKET_TOKEN_CACHE = {}
def get_market_tokens(slug):
    if slug in MARKET_TOKEN_CACHE: return MARKET_TOKEN_CACHE[slug]
    try:
        res = requests.get(f"{GAMMA_BASE}/{slug}", timeout=10).json()
        ids = json.loads(res["clobTokenIds"])
        MARKET_TOKEN_CACHE[slug] = (ids[0], ids[1])
        return ids[0], ids[1]
    except: return None, None

def place_buy(token_id, amount):
    try:
        order = MarketOrderArgs(token_id=token_id, amount=round(float(amount), 2), side=BUY)
        return client.post_order(client.create_market_order(order))
    except Exception as e:
        print(f"[ERROR] Buy Failed: {e}")
        return None

# --- MAIN MARTINGALE LOOP ---
def run_executor():
    print(f"[START] Dextrip Martingale Executor | Brain: {VERCEL_URL}")
    send_telegram("<b>Martingale Executor Started</b>\nPolling Strategy Engine for 5m signals.")
    
    last_processed_round = None

    while True:
        try:
            # 1. Poll the Vercel Strategy Engine
            # We call the main API which now includes 'recommendedTrades'
            response = requests.get(f"{VERCEL_URL}/api/btc-5m", timeout=15)
            data = response.json()
            
            current_window = data.get("currentWindow")
            recommended = data.get("recommendedTrades", [])
            target_profit = data.get("targetProfit", 5)
            
            if not current_window:
                time.sleep(10)
                continue
            
            round_id = current_window["roundId"]
            start_iso = current_window["startTime"]
            
            # 2. Timing Logic (Execute at T-60s)
            start_ts = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).timestamp()
            now_ts = time.time()
            seconds_to_start = start_ts - now_ts
            
            # Log status every 10s
            print(f"[STATUS] Round: {round_id} | T-minus: {int(seconds_to_start)}s | Active Signals: {len(recommended)}", end="\r")

            # 3. Execution Trigger (Window 1 min before start)
            if 0 < seconds_to_start <= 65 and last_processed_round != round_id:
                print(f"\n[TRIGGER] Executing Strategy for Round {round_id}...")
                
                # Fetch tokens for the slug
                window_ts = int(start_ts)
                slug = f"btc-updown-5m-{window_ts}"
                up_token, down_token = get_market_tokens(slug)
                
                if not up_token:
                    print(f"[ERROR] Market tokens not found for {slug}. Retrying...")
                    time.sleep(2)
                    continue

                executed_count = 0
                for trade in recommended:
                    agent = trade["agentId"]
                    side = trade["direction"]
                    stake = trade["stake"]
                    token_id = up_token if side == "UP" else down_token
                    
                    print(f"  > Agent: {agent} | {side} | Stake: ${stake}")
                    
                    res = place_buy(token_id, stake)
                    if res:
                        executed_count += 1
                        print(f"    [SUCCESS] Order Placed.")
                    else:
                        print(f"    [FAILED] Order Failed.")

                if executed_count > 0:
                    send_telegram(
                        f"<b>[EXECUTION] Round {round_id}</b>\n"
                        f"Agents Traded: {executed_count}\n"
                        f"Target Profit: ${target_profit}"
                    )
                
                last_processed_round = round_id
                print(f"[INFO] Round {round_id} processed successfully.\n")

            # High frequency polling when near execution, lower otherwise
            wait_time = 2 if seconds_to_start < 90 else 10
            time.sleep(wait_time)

        except Exception as e:
            print(f"\n[LOOP ERROR] {e}")
            time.sleep(5)

if __name__ == "__main__":
    if not PRIVATE_KEY:
        print("[FATAL] POLYMARKET_PRIVATE_KEY missing.")
    else:
        run_executor()
