---
title: "S/4HANA migration for operators"
type: service
updated: 2026-11-10T09:00:00.000Z
summary: "Planning an S/4HANA move for a business with depots, crews and meters that cannot stop."
sources: ["https://www.sap.com/"]
---

Operators cannot freeze maintenance or billing for a long cutover. What works:

- A readiness check first: custom code, data quality, interfaces. See [[Custom code before a brownfield conversion]].
- Brownfield conversion when the processes are sound; selective when one area (often billing) needs a redesign.
- Cutover planned around the billing run and the maintenance calendar, not the other way round.

Related: [[Utilities billing exceptions]], [[Data migration: master data first]], [[Larkwell Consulting]].
