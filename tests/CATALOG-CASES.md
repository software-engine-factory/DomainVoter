# Shared selection acceptance cases

The oracle is seven named, ordered fixture records, with prices 10 through 16, split into ranges of three, three and one. Expected counts and positions are arithmetic, not snapshots of the implementation.

| Guarantee | Case | Fault exposed |
| --- | --- | --- |
| One membership copy | Seven selection rows expose seven catalog rows and zero eager domain rows. | Eagerly duplicate membership, drop or repeat a boundary item. |
| Stable interaction IDs | Materialize two negative IDs twice, then add a vote and view under existing foreign keys. Catalog still contains exactly seven rows; IDs and order are unchanged. | ID changes, duplicate union rows or broken FKs. |
| Snapshot and live display contracts | Change a pool price after opening. Admin result/export retains the opening price; voter cards use the live price. | Join live prices into historical exports or stale live voter cards. |
| Range paging | Request a subrange starting at position two. Return only the remaining names in that round, with stable IDs. | Offset a range twice, cross into another reviewer range. |
| Existing workflows | Derive from a compact round, then delete the parent. Child names survive and source links clear. | FK failure on an unmaterialized source, accidental removal of shared membership. |
| Open later | A first-only batch opens its next range after prices change. New range snapshots the new price while old range snapshots remain unchanged. | Freeze all historical prices at initial batch time or overwrite an existing range's price. |
| Used-name filtering | Compact names count as used before anyone votes or views them. | Treat only interacted names as used. |

The creation suite separately checks real worker ordering, cancellation, interruption/resume, publication, legacy worker recovery, prices and assignments. Local browser checks cover authorization and the real vote action.
