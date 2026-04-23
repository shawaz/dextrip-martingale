from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from datetime import datetime, timezone, timedelta

class MockHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/btc-5m":
            # Set window to start 60 seconds from now
            start_time = datetime.now(timezone.utc) + timedelta(seconds=60)
            start_iso = start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
            
            response = {
                "currentWindow": {
                    "roundId": "BTC5M-MOCK-123",
                    "startTime": start_iso
                },
                "recommendedTrades": [
                    {"agentId": "EVERY_UP_5M", "direction": "UP", "stake": 5},
                    {"agentId": "RSI_DOWN_5M", "direction": "DOWN", "stake": 12}
                ],
                "targetProfit": 5
            }
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

print("Mock Vercel API running on http://localhost:8080")
HTTPServer(("localhost", 8080), MockHandler).serve_forever()
