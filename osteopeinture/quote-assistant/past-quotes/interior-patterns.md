# Ostéopeinture — Interior Quotes: Structured Analysis

---

## 1. Common Scope Items and Line Item Patterns

### Most Frequently Appearing Tasks (interior quotes only)

| Task | Frequency | Typical Description Pattern |
|---|---|---|
| Wall painting | ~100% | "Murs" / "Walls" — included in almost every room-level line |
| Ceiling painting | ~90% | "Plafonds" / "Ceilings" — sometimes broken out, sometimes bundled |
| Trim / baseboards | ~80% | "Plinthes, cadres de porte, moulures" / "Baseboards, trim, doorframes" |
| Door painting | ~75% | "Portes" / "Doors" — sometimes per door, sometimes bundled |
| Staircase | ~55% | "Cage d'escaliers / Montée d'escaliers / Staircase" — walls, ceilings, trim; spindles/risers often broken out separately |
| Repairs (minor) | ~80% | Described inline: "Réparations mineures incluses" or "Minor repairs as discussed" |
| Repairs (major/billed extra) | ~95% | Always charged at $60–$75/h + materials; often listed as a separate $0 or hourly line |
| Window frames | ~40% | "Cadres de fenêtres" — sometimes included, sometimes specifically excluded |
| Spindles / risers / stringers | ~25% | Exclusive to staircase quotes; broken out from general staircase work; high unit cost |
| Closets | ~30% | Itemized when included; often explicitly excluded (e.g., FOSSOU, KENNERKNECHT) |
| Wainscoting | ~20% | Appears in larger, higher-end jobs (GIRARD, BISSON); includes caulking of panels |
| Crown moulding | ~20% | Noted as included in room prices or as supplement |
| Heaters / calorifères | ~25% | Noted inline ("incluant les calorifères") or as a separate line ($200–$600) |
| Furniture moving/covering | ~30% | Usually included as standard; occasionally priced separately ($150 — BAJAJ) |

### Line Item Description Conventions
- **Room-level lump sums** are the dominant pattern — most rooms carry a single price with a description that lists inclusions/exclusions
- **Sub-line breakdowns** appear within complex rooms (e.g., staircase walls vs. spindles/risers, or ceiling vs. walls)
- **Exclusions** are frequently made explicit inline: "Exclut le garde-robe," "Exclut le mur de briques," "Excl. treads, risers, stringers"
- **Supplemental charges** (multiple colours, extra primer coat, furniture moving) are added as named line items under a "Suppléments" or "Extras" section

---

## 2. Typical Price Ranges by Task Type

> Notes: These are room- or task-level totals unless stated otherwise. Ranges reflect actual line item values across the dataset.

### Walls (standalone, per room)
| Room Type | Range |
|---|---|
| Small bathroom / powder room | $300 – $450 |
| Single bedroom | $550 – $1,100 |
| Master bedroom | $800 – $1,700 |
| Living room / salon | $1,000 – $1,500 |
| Open-plan kitchen + dining + living | $1,000 – $2,500 |
| Vestibule / hallway / corridor | $300 – $900 |
| Office / bureau | $500 – $700 |

### Ceilings (standalone, where broken out)
| Surface | Range |
|---|---|
| Small room ceiling (refresh / 1 coat) | $100 – $300 |
| Standard room ceiling (full, 2 coats) | $300 – $550 |
| Kitchen ceiling | $350 – $850 |
| Bathroom ceiling only | $200 – $300 |
| Popcorn / decorative ceiling (extra complexity) | premium noted inline |

### Trim / Baseboards / Doorframes (standalone)
| Scope | Range |
|---|---|
| Small room trim only | $250 – $450 |
| Full floor trim package | $600 – $2,800 |
| Heater cover painting | $200 – $400 |
| French door (per unit) | $250 – $300 |
| Single door (2 faces) | $250 – $350 |
| Leaded glass windows (per set ~3 panes) | $350 – $550 approx. |

### Staircase (full, bundled)
| Scope | Range |
|---|---|
| Walls + ceiling only | $275 – $800 |
| Walls + ceiling + trim | $600 – $1,200 |
| Full staircase (walls, trim, spindles, risers, stringers) | $1,575 – $3,600 |
| Spindles / risers / stringers only | $1,200 – $1,575 |
| Bay window painting (as staircase-adjacent) | $550 |

### Repairs
| Type | Rate |
|---|---|
| Minor repairs (standard) | Included in room price |
| Major repairs (most quotes) | $60/h + materials |
| Major repairs (later quotes 2024–2025) | $65–$75/h + materials |
| Plaster repairs (estimated range) | $400–$1,000 approx. in notes |

### Multiple-Colour Supplement
- Consistently priced at **$350** (MATTE_01)

---

## 3. Quote Structure by Room and Floor

### Single-Floor / No Floor Label
- Most smaller jobs (~40% of dataset) group all rooms without a floor tag
- Sections correspond directly to room names: Vestibule, Salon, Cuisine, Salle de bain, Chambre, Corridor, Cage d'escaliers
- Total per section is given; individual line item prices may or may not be filled in

### Multi-Floor Structure
- Used in ~60% of quotes
- Floors follow one of two label conventions:
  - **English:** "Ground Floor," "2nd Floor," "Basement," "3rd Floor"
  - **French:** "Rez-de-chaussée," "2ème étage," "Sous-sol," "3ème étage," etc.
- Each floor becomes a named section; rooms within floors are sub-items
- Floor subtotals are displayed; grand subtotal aggregated below all floors
- **Optional or supplemental sections** are always placed last, clearly labeled: "[OPTION EN EXTRA]," "[OPTIONAL / ADD-ONS]," or "Suppléments"

### Largest multi-floor quotes in dataset:
| Project | Floors | Subtotal |
|---|---|---|
| GIRARD_01 (Phase 1+2) | GF + 2nd + 3rd | $26,750 |
| KENNERKNECHT_01 | GF + 2nd | $18,250 |
| A.BISSON_01 | Basement + GF + 2nd | $19,800 |
| LANDO_01 | Basement + GF + 2nd + 3rd | $16,000–$16,500 |

---

## 4. Paint Product Patterns (Interior)

### Most Frequently Specified Products

| Surface | Most Common Product | Second Choice | Notes |
|---|---|---|---|
| **Walls** | **Sherwin Williams Duration INT** | SW SuperPaint / SW Emerald | Duration appears in ~70% of quotes; Emerald in premium/2025 jobs |
| **Ceilings** | **SW ProMar 400** (Flat / Extra White) | BM ceiling paint (rare) | Near-universal — appears in ~95% of interior quotes |
| **Trim / Doors / Baseboards** | **SW B53** (or equivalent) | SW ProClassic / SW ProMar 200 HP | B53 becomes dominant from mid-2024 onward; ProClassic in early quotes |
| **Primer** | **SW Multi-purpose Latex Primer** | SW PM200 / SW Extreme Bond | Used on wainscoting, bare gypsum, previously wallpapered surfaces |
| **Bathrooms** | **SW ProMar 200** (Satin, anti-mold) | — | Explicitly flagged for bathroom surfaces |
| **Floors** | **SW Porch & Floors** | — | Appears only in BORETSKY_01 (basement floor) |

### Secondary / Client-Specified Products
- **Benjamin Moore Aura** — appears as an upgrade option in several quotes (+$350–$600 over SW Emerald base)
- **Benjamin Moore Ben** — used for LEGERMAIN_02 commercial and THÉRIAULT_01; listed with finish/cost upgrade options (Regal +$200, Aura +$350)
- **Benjamin Moore Advance** — appears once (FURTADO_01, trim/doors)
- **Sico Évolution / Sico ProLuxe** — appears in hotel ALT_04 and COSSETTE exterior; Sico specified when matching an existing hotel finish

### Finish Pattern by Surface

| Surface | Finish |
|---|---|
| Walls | Satin (Satiné / Velouté) — most common; Matte occasionally; Low Sheen in 2025 Emerald jobs |
| Ceilings | Flat / Mat / Ultra-Mat — universal |
| Trim / Doors | Semi-Gloss (Semi-lustré) — universal |
| Bathrooms | Satin |
| Staircase metalwork | Eggshell (Sir-George_01) |

---

## 5. Duration and Day-Count Patterns

| Project Scale / Scope | Typical Duration |
|---|---|
| Single room or very small scope | 1–2 days |
| Small apartment refresh (3–5 rooms) | 2–4 days |
| Mid-size full floor (5–8 rooms) | 3–5 days |
| Full two-floor residential | 1 week / 4–7 days |
| Large multi-floor (3+ floors, full prep) | 2–3 weeks |
| Staircase-only (complex with spindles) | 6 days – 2 weeks |
| Commercial / hotel (multi-room, multi-visit) | 3–5 visits spread over days |

### Specific values observed:
- **1–2 days:** REINGOLD (office), BD_MARLOWE, DEACON, ALT_02, BRIAND/FOSSOU_02
- **2–3 days:** COSEREANU, ARTAUD, MORELLO, WALLACK
- **3–4 days:** CHARRON, NADEAU, FOSSOU, MATTE, BAJAJ, THÉRIAULT
- **4–5 days:** LEGERMAIN_02, MATTE
- **1 week:** DAVID, MÉNARD, BISSON (sub-floors each ~1 week), JACQUES
- **2 weeks:** REDFERN, LANDO
- **3 weeks:** A.BISSON, KENNERKNECHT
- **Phased:** GIRARD Phase 1+2 (3 weeks + 5–7 days, split across Nov–Dec)

---

## 6. Deposit Patterns

| Deposit Amount | Context |
|---|---|
| $100 | NADEAU (tiny single-room job, $632 grand total) |
| $250 | DECASSON ($1,322 total) |
| $300 | LEGERMAIN_03 / ALT_02 (small commercial) |
| $400 | BD_MARLOWE, DEACON, LEGERMAIN_2024 |
| $500 | ARTAUD, COSEREANU, FURTADO, MERCILLE, ALT_04 |
| $600 | DESERRES |
| $700 | MORELLO |
| $750 | WALLACK |
| $800 | MOINZAD, BAJAJ, FOSSOU_02, BRIAND |
| $1,000 | MATTE, FOSSOU_01, LANAUDIÈRE, BD_MARLOWE upgrade, MÉNARD, THÉRIAULT, GIRARD_01, JACQUES |
| $1,000–$1,700 | Mid-size multi-room jobs |
| $1,500 | LEGERMAIN_02, DAVID |
| $1,700 | LANDO |
| $2,000 | Sir-George, KENNERKNECHT |
| $2,400 | REDFERN |
| $2,500 | LANAUDIÈRE (large multi-room), WEI |
| $3,000 | A.BISSON |

### Deposit as Percentage of Grand Total (where calculable)
| Range | Typical Context |
|---|---|
| ~10–15% | Very large projects ($15,000–$30,000+); LANDO (~10%), GIRARD Phase 2 (~9%) |
| ~18–25% | Most mid-size residential jobs |
| ~25–33% | Small to medium jobs |
| ~40–50% | Very small jobs or early quotes (MOINZAD 50%, LEGERMAIN_01 40%) |

**Key observations:**
- Deposit is **never described as a fixed percentage** in the quote text — it is always a round number
- Cash/e-transfer is always noted as the accepted method for deposit
- Quote language: "Dépôt de X$" or "Deposit of $X" — no "%" language used
- Balance payment structures vary (see below)

---

## 7. Formatting and Grouping Conventions

### Document Structure
1. **Header:** Company name, client name, address, date, RBQ number
2. **Project description line** (1–2 sentences describing overall scope)
3. **Scope / line items table:** Grouped by floor → then by room/section → with inclusions/exclusions noted inline
4. **Paint specifications table:** Separate section listing surface type, product, colour, finish
5. **Total / taxes block:** Subtotal → TPS (5%) → TVQ (9.975%) → Grand Total
6. **Terms block:** Deposit, payment schedule, validity (always 30 days), standard conditions

### Standard "Special Conditions" Boilerplate (appears in nearly every quote)
- Preparation, primer where needed, 2 coats of paint on all designated surfaces
- Covering of all floors and furniture present in the space
- Cleanup at end of each day
- Respectful, quiet working environment
- Major repairs charged at $60–$75/h + materials
- Additional work billed at same hourly rate
- Quote valid 30 days
- Client responsible for permit compliance
- High-end paint and all materials included in total

### Payment Schedule Conventions
| Structure | When Used |
|---|---|
| Deposit + balance at completion | Small/simple jobs (1–3 days) |
| Deposit + 50% mid + 50% at completion | Medium projects (3–7 days, 2 floors) |
| Deposit + weekly installments | Large/multi-week projects |
| NET 30 days at completion | Commercial/hotel clients (Le Germain, Alt) |

### Tax Treatment
- **TPS (5%) + TVQ (9.975%)** applied in majority of quotes
- Some quotes show $0 for both taxes (REDFERN, FOSSOU, MOINZAD, MORELLO, BRIAND) — likely pre-tax or cash arrangements
- Optional add-ons and repairs are **never included in the taxable subtotal** — they appear as separate line items outside the main total
- A clear pattern of **"Option en Extra" or "Add-Ons" sections** placed at the bottom of the itemized list, always labeled and excluded from the displayed grand total

### Revision/Versioning Convention
- When quotes are revised (FOSSOU, LANDO, WALLACK), a new document is issued with explicit revision notes (e.g., "Soustraction d'une couche de peinture au plafond: -$400")
- Negative line items are used to show deductions in revised quotes

### Language Convention
- Bilingual practice: English-language quotes for Anglophone clients (Westmount, NDG); French-language quotes for Francophone clients
- Terminology is consistent within each language version; no mixing within a single quote

---

*Analysis based on 37 extracted quote records, predominantly from 2024 with several 2025 entries. One exterior quote (COSSETTE) was present in the dataset and