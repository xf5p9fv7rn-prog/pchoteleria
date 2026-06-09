import urllib.request, json
SUPABASE_URL = "https://pnkajjduvadcxealodcp.supabase.co"
ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBua2FqamR1dmFkY3hlYWxvZGNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDQ1MzIsImV4cCI6MjA5MDgyMDUzMn0.NsL16NP16MVEwTSN-1ggAtwzTA-2tDPF7Ndbcsdl-Ro"
HEADERS = {"apikey": ANON_KEY, "Authorization": f"Bearer {ANON_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}
req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/v2_camas?id_cama=eq.COPC000253-C3", data=json.dumps({"estado": "Deshabilitada"}).encode(), headers=HEADERS, method="PATCH")
try:
    with urllib.request.urlopen(req) as r:
        print(f"Status: {r.status}\n{r.read().decode()}")
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode()}")
