# Plan: CIP, beer loss tracking and inventory reconciliation

Status: approved and built 23 Oct 2026.

## 1. CIP (clean in place)

- Every tank carries a hygiene state: Dirty, Cleaned or Sanitised. A tank turns Dirty when its batch leaves (transfer or Sold out).
- Log CIP from a tank card or its QR tag: cycle (Rinse, Caustic, Acid, Sanitiser, Full CIP), chemical strength, temperature, minutes, operator and a pass or fail check (ATP swab or visual).
- Chemicals used come off stores and count in cost per litre.
- Brewing or transferring into a tank that is not sanitised, or was cleaned more than N days ago (Settings, default 3), asks for confirmation.
- Alerts and an automatic CIP task when a tank turns Dirty.
- The batch record shows the CIP that cleaned its tank before filling.
- CIP log with cycles per tank, chemical used and failed checks.

## 2. Beer loss tracking

| Stage | Captured how |
|---|---|
| Brewhouse | recipe volume against actual volume into the fermenter |
| Fermentation | yeast and trub dumps, dry hop loss |
| Transfer | litres out against litres in, recorded automatically on transfer |
| Packaging | litres drawn against litres filled, recorded automatically |
| Taproom | line flush, foam, spillage |
| Dispatch | breakage and returns |
| QC samples and dumps | entered against the batch |
| Unexplained | found by stock take: expected litres against counted litres |

- Losses panel on every batch record: litres and % by stage against a target %.
- Beer losses screen: loss % by stage and by beer, worst batches, total loss against the state excise allowance.
- Alerts when a batch passes the loss target.
- Excise is booked on litres in tank at Ready, after recorded losses.

## 3. Inventory reconciliation (stock take)

1. New count builds a sheet: raw materials, packaged goods, beer in every tank, kegs owned.
2. Blind count: system figures stay hidden while counting.
3. Review shows variance in quantity and value. Lines over 2% or ₹1,000 are highlighted.
4. Each line gets a reason. Posting updates stock and writes a permanent adjustment record. Beer variances post as Unexplained losses on that batch.
5. Beer reconciliation since the last posted count: opening + brewed − sold − packaged − losses = expected closing, against counted closing.

## Build order

1. Transfer from fermenter to brite tank (needed by CIP and losses).
2. CIP.
3. Beer loss tracking.
4. Stock take.
5. Demo data, browser tests, README.

## Risks

| Risk | Mitigation |
|---|---|
| Existing data has no hygiene state or loss stages | tanks default to Cleaned; old beer wastage counts as Taproom |
| Adjustments could hide theft | adjustments are permanent, with reason and date |
| Allowed excise loss differs by state | a Settings value with a placeholder |
