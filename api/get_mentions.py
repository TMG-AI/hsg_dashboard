import json
from http.server import BaseHTTPRequestHandler
from _shared import get_latest_mentions

class handler(BaseHTTPRequestHandler ):
    def do_GET(self):
        try:
            mentions = get_latest_mentions()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(mentions).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        return
