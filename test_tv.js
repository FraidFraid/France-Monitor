fetch("https://scanner.tradingview.com/france/scan", {
  "headers": { "content-type": "application/x-www-form-urlencoded" },
  "body": '{"symbols":{"tickers":["EURONEXT:PX1","EURONEXT:TTE","EURONEXT:AIR"],"query":{"types":[]}},"columns":["name","close","change"]}',
  "method": "POST"
}).then(r => r.json()).then(console.log);
