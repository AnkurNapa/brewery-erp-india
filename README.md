# Brewhouse ERP

A free, browser-based ERP for Indian microbreweries and brewpubs.

**Live app:** https://ankurnapa.github.io/brewery-erp-india/

## What it does

- **Tanks:** every fermenter and brite tank with the batch inside, its gravity curve and latest temperature. Log gravity, temperature and pH readings as fermentation runs.
- **Batches:** start a batch from a recipe and its ingredients come out of stores. Move it through Brewing, Fermenting, Conditioning, Ready and Sold out.
- **Raw materials:** malt, hops, yeast and the rest, with reorder levels and stores value.
- **Recipes:** target OG and FG, ABV and ingredient cost per batch and per litre.
- **Menu and sales:** beer sold by serve size and drawn from that beer's stock. Printable tax invoices.
- **Excise and tax:** an excise register booked when a batch is marked Ready, plus a monthly VAT and GST summary.

## Tax treatment

Alcoholic liquor for human consumption sits outside GST in India. Beer is taxed through state excise and state VAT, while food in a brewpub carries GST split as CGST and SGST. Rates differ by state, so set your own in Settings. The demo rates are placeholders.

## Where your data lives

Everything is stored in your browser (localStorage). Nothing is sent to a server. Use **Settings > Export backup** often. Import that file to move to another computer.

## Run it locally

Open `index.html` in a browser. There is no build step and no install.

## Credits

The tank view and fermentation readings take their lead from [Brewery Pi](https://github.com/brewerypi/brewerypi) by Deschutes Brewery (MIT licence), a brewing data historian built for Raspberry Pi. No Brewery Pi code is used here.

## Licence

MIT
