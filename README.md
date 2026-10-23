# Brewhouse ERP

A free, browser-based ERP for Indian microbreweries and brewpubs. Grain to glass in one place: recipes, stores, brewing, packaging, kegs, dispatch, taproom sales and the excise register.

**Live app:** https://ankurnapa.github.io/brewery-erp-india/

It opens with a demo brewpub loaded. Use **Settings > Start empty** when you are ready to enter your own data.

## Modules

**Setup.** Masters for customers, vendors, tanks, kegs, machines, raw materials and recipes. Equipment register with a QR tag for every keg, tank and machine. Scanning a tag with a phone camera opens that item in the app.

**Home.** Alerts for low stock, near expiry, pending QC, overdue tasks, service due, kegs left at customers and beers running low. A live picture of the brewery floor with every tank's fill level.

**Schedule.** Month calendar of brewing, filling, dispatch, cleaning and maintenance tasks. A brew planner works out when to brew each beer from its sales rate, stock in hand, beer already in tanks and its average grain to glass cycle.

**Stores.** On hand, reserved for planned batches and available stock. Reorder levels, expiry dates and QC approval on receipt. Material wastage. MRP suggests orders and raises purchase orders per vendor. Receiving a PO adds the stock and holds it for QC.

**Recipes.** A mass balance engine: OG, FG, ABV, IBU (Tinseth), colour (Morey, in EBC), volumes at each step (pre-boil, post-boil, fermenter, sellable) and ingredient cost per batch and per sellable litre, recalculated as you build. Every edit saves a new version and batches remember the version they used.

**Production.** Batches move from Planned to Brewing, Fermenting, Conditioning, Ready and Sold out. Ingredients are issued when a batch leaves Planned. A step by step brew log captures mash temperature, gravities, volume and pitch temperature. Anything outside tolerance is flagged. Fermentation readings (gravity, temperature, pH) draw a curve per tank.

**Packaging.** Kegging, canning and bottling runs. Kegs are picked from empty stock and tagged to the batch.

**Dispatch.** Kegs and packaged beer sent to customers. Kegs are tracked through Filled, At customer, Cleaning and Empty.

**Batch lifecycle record.** One page per batch: brew day against target, deviations, ingredients issued with cost, fermentation curve, packaging, where every keg is now, dispatches and excise. Printable.

**Taproom sales.** Invoices with VAT on beer and GST on food, printable as tax invoices. Every pour comes off that beer's stock.

**Utilities and wastage.** Electricity, water, fuel and CO2 for COGS. Beer written off.

**Reports.** Business (revenue, COGS per litre, margin), production, consumption, dispatch, stock position, batch quality plus recipe versus batch with brewhouse and volume efficiency.

**Excise and tax.** Excise register booked when a batch is marked Ready, plus a monthly VAT and GST summary.

## Tax treatment

Alcoholic liquor for human consumption sits outside GST in India. Beer is taxed through state excise and state VAT, while food in a brewpub carries GST split as CGST and SGST. Rates differ by state, so set your own in Settings. The demo rates are placeholders.

## Where your data lives

Everything is stored in your browser (localStorage). Nothing is sent to a server. Use **Settings > Export backup** often. Import that file to move to another computer.

This also means each browser has its own copy. A QR scan on a phone shows the phone's data, not the office laptop's. Sharing one live dataset across devices and adding user logins with access levels both need a backend, which this version does not have.

## Design

Clean white cards in the spirit of modern brewery software, laid out to Apple's Human Interface Guidelines: system font and colours, a sidebar on wide screens, a tab bar and bottom sheets on phones, 44 px touch targets and full dark mode.

## Run it locally

Serve the folder with any static server, for example `python3 -m http.server`, then open `http://localhost:8000`. There is no build step. ES modules need a server, so opening `index.html` from disk will not work.

## Credits

The tank view and fermentation readings take their lead from [Brewery Pi](https://github.com/brewerypi/brewerypi) by Deschutes Brewery (MIT licence). The feature scope follows what brewery ERPs such as Worter describe publicly. No code from either is used here. QR codes are drawn with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT).

## Licence

MIT
