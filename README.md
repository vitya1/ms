# market-scanner
Cryptocurrency market price scanner

Description
---
Is was written in nodejs. No database is using (historical data are stored in files yet).
See working version [here](https://scan.coinbison.com).

How it works
---
Scanner collects Coinigy trading data and detects lowest prices for the specific period.
There are two separated processes:

scanner - collecting data looking for dumps

web - web interface

Installation
---
It can be easily installed with node js:
```bash
git clone https://github.com/vitya1/market-scanner.git
cd market-scanner/

npm install
bower install
```
After installation run:
```bash
node scanner.js

#...then
node web.js

```
It will be available on localhost 3001 port.

Contribution
---
Thank you for interesting in Scanner.
My mental hug is for you if you do something of follow list:
- Report bug, submit issues
- Suggest enhancement
- Submit pull request
