# OstéoPeinture 2026 Finance System — Setup Guide

Written for Loric. No coding knowledge required.

---

## What Each File Does

| File | What it does |
|------|-------------|
| `create-sheet.gs` | Run once to build the entire Google Sheet from scratch — all tabs, columns, and formulas |
| `import-csv.gs` | Watches your Drive folder for bank exports, parses them, and stages them for review |
| `cash-entry-sidebar.gs` | Powers the "Add Transaction" sidebar you use on your phone |
| `sidebar.html` | The actual form that appears in the sidebar |
| `SETUP.md` | This file |

---

## Step-by-Step Deployment

Follow these steps in order. Don't skip ahead.

---

### Step 1 — Create the spreadsheet

1. Go to **script.google.com**
2. Click **New project** (top left)
3. You'll see a blank code editor. Delete everything that's already there.
4. Open the file `create-sheet.gs` on your computer and copy everything in it
5. Paste it into the Apps Script editor
6. At the top of the editor, make sure the function dropdown shows **createFinanceSheet2026**
7. Click the **Run** button (▶)
8. A popup will ask you to authorize the script — click **Review permissions**, choose your `loricstonge@gmail.com` account, click **Advanced** → **Go to Untitled project (unsafe)** → **Allow**
9. A dialog box will appear with a link to your new spreadsheet. **Copy that link and save it somewhere.**
10. Open the link — you should see a spreadsheet with 12 tabs along the bottom

> ✓ **Check:** You should see tabs named Transactions, Wages, Categories, Accounts, Monthly P&L, Account Balances, Owner Balances, Per-Job P&L, GST/QST Tracker, Reconciliation, Dashboard, Import.

---

### Step 2 — Add the import and sidebar scripts

Now you'll attach the remaining scripts to the new spreadsheet.

1. In your new spreadsheet, click **Extensions** → **Apps Script**
   - This opens an Apps Script editor *bound to this specific sheet*
   - It's different from the standalone script you used in Step 1
2. You'll see a default file called `Code.gs`. Delete everything in it.
3. Paste the entire contents of `import-csv.gs` into `Code.gs`
4. Click the **+** next to "Files" in the left sidebar → choose **Script**
5. Name it `cash-entry-sidebar` (no extension needed)
6. Paste the entire contents of `cash-entry-sidebar.gs` into it
7. Click the **+** again → choose **HTML**
8. Name it `sidebar` (must be exactly this name)
9. Paste the entire contents of `sidebar.html` into it
10. Click the **Save** button (floppy disk icon, or ⌘S)

> ✓ **Check:** You should have three files in the left panel: `Code.gs`, `cash-entry-sidebar.gs`, `sidebar` (HTML icon).

---

### Step 3 — Get your Drive folder ID

The import script needs to know which Google Drive folder to watch for bank exports.

1. Go to **drive.google.com**
2. Navigate to your `OstéoPeinture > Bank Exports` folder
3. Look at the URL in your browser. It looks like this:
   ```
   https://drive.google.com/drive/folders/1ABC2DEF3GHI4JKL5MNO
   ```
4. The folder ID is the long string of letters and numbers after `/folders/`
   In the example above: `1ABC2DEF3GHI4JKL5MNO`
5. Copy just that part — you'll need it in the next step

---

### Step 4 — Get your Claude API key

The import script uses Claude to read transaction screenshots as a fallback (when a bank CSV isn't available).

1. Go to **console.anthropic.com**
2. Sign in with your account
3. Click **API Keys** in the left sidebar
4. Click **Create Key** → give it a name like `OP Finance`
5. Copy the key — it starts with `sk-ant-...`
6. **Store this key safely.** A good place: your password manager (1Password, etc.), or a private note. Do not put it in a shared document or email it to anyone.

---

### Step 5 — Configure the script

1. In the Apps Script editor (from Step 2), make sure `Code.gs` is selected
2. In the function dropdown at the top, find and select **setupScriptProperties**
3. Click **Run**
4. Two popups will appear — one asking for the Drive folder ID, one for the Claude API key
5. Paste each value when prompted
6. You'll see a confirmation: *"Setup complete."*

---

### Step 6 — Install the hourly trigger

This makes the script automatically check your Drive folder every hour for new bank exports.

1. In the function dropdown, select **installTrigger**
2. Click **Run**
3. It may ask for authorization again — approve it
4. You'll see: *"Hourly trigger installed."*

---

### Step 7 — Test the setup

1. Go back to your spreadsheet (close or switch from Apps Script)
2. Reload the page
3. You should see a new menu called **OstéoPeinture** in the top menu bar
4. Click it — you should see:
   - Add Transaction
   - Check Bank Export Folder Now
   - Push Staged to Transactions
   - Setup options

> ✓ **Check:** If the OstéoPeinture menu appears, the scripts are loaded correctly.

5. Click **Add Transaction** — a sidebar should open on the right with the entry form
6. The form should show dropdowns for Account and Category (pulled live from your sheet)

> ✓ **Check:** If the form opens with dropdowns populated, the sidebar is working.

---

## Testing Each Piece

### Test the import pipeline
1. Download a CSV export from RBC (any date range, even one month)
2. Drop the file into your Google Drive `Bank Exports` folder (any subfolder is fine)
3. In the spreadsheet, click **OstéoPeinture → Check Bank Export Folder Now**
4. Switch to the **Import** tab
5. You should see rows of transactions staged there — Date, Description, Amount, Account pre-filled

> ✓ If rows appear in Import, the bank detection and normalization is working.

### Test pushing to Transactions
1. In the Import tab, find a staged row
2. Add a Category in column E (pick anything from the dropdown)
3. Click **OstéoPeinture → Push Staged to Transactions**
4. Switch to the **Transactions** tab
5. The row should appear there, with Month auto-filled

> ✓ If the row appears in Transactions, the push is working.

### Test the cash entry form on mobile
1. On your phone, open Google Sheets and navigate to this spreadsheet
2. Tap the three-dot menu (⋮) → **Extensions** → you may need to scroll to find it
3. Alternatively: tap **Extensions** from the top menu if visible
4. Tap **OstéoPeinture → Add Transaction**
5. Fill in a test entry (use today's date, any description, any amount)
6. Tap **Add Transaction**
7. Switch to the Transactions tab and confirm the row appears

> ✓ If the row appears, mobile entry is working.

---

## Monthly Routine

### What Claude in Chrome does
Once a month (usually first week of the new month):

1. Open Claude in Chrome
2. Ask Claude to navigate to each bank portal and download the previous month's transactions as CSV:
   - RBC online banking → Accounts → Download transactions → CSV format
   - BMO MC online banking → Statements → Download → CSV
   - CIBC → Accounts → Download → CSV
3. When prompted for MFA (text or email code), you handle that manually — Claude pauses and waits
4. Claude saves each CSV file to your `OstéoPeinture/Bank Exports/YYYY-MM/` folder in Google Drive

### What the script does automatically
Within the hour after the files land in Drive, the import script:
- Detects which bank each file is from
- Normalizes all three formats into the same columns
- Stages rows in the **Import** tab
- Flags any row that looks like a duplicate (already in Transactions)

### What you review
1. Open the **Import** tab
2. Go through each staged row:
   - **Column E (Category):** Assign a category. Most recurring expenses (Van - Gas, Supplies, etc.) will be obvious. Use the dropdown.
   - **Column F (Transfer Type):** Only needed if Category = Transfer (e.g. a credit card payment)
   - **Column G (Job):** Optional. Only fill in if you can clearly link it to a specific contract
   - **Column H (Duplicate flag):** Rows marked ⚠ DUPLICATE are already in Transactions — leave them, they'll be skipped automatically
3. When satisfied with your review, click **OstéoPeinture → Push Staged to Transactions**
4. Pushed rows turn gray. Transactions tab is updated.

**Time estimate:** 20–30 minutes per month once you're familiar with your categories.

---

## Adding a Cash Transaction on Mobile

Use this whenever you pay cash for something in the field, or receive cash from a client.

1. Open Google Sheets on your phone
2. Open the OstéoPeinture 2026 spreadsheet
3. Tap **Extensions** → **OstéoPeinture** → **Add Transaction**
4. Fill in the form:
   - **Date:** defaults to today — change if needed
   - **Description:** what was this (e.g. "Paint for ARCO_01 at Reno-Depot")
   - **Account:** which account did the money come from/go to (usually Cash or RBC)
   - **Counterpart:** the other side of the transaction (optional but useful)
   - **Amount:** positive = money coming in, negative = money going out
   - **Category:** what type of expense/revenue
   - **Transfer Type:** only needed for transfers between accounts
   - **Job:** the contract code if you know it (e.g. ARCO_01)
5. Toggle **"Add mirror entry automatically"** ON if you want both sides of the transaction entered at once (recommended for most entries)
6. Tap **Add Transaction**
7. The form clears (keeps date and account) so you can quickly add another

**Tip:** Keep the date and account pre-filled between entries. If you're paying several workers on the same day, you only need to change description, amount, and job each time.

---

## If Something Breaks

### "OstéoPeinture menu doesn't appear"
- Reload the spreadsheet (close and reopen)
- If still missing: go to Extensions → Apps Script, check that all three files are there and saved
- Make sure there are no red error lines in the code

### "Add Transaction sidebar doesn't open" or "dropdowns are empty"
- The sidebar needs the Accounts and Categories tabs to exist in the spreadsheet
- Open those tabs and confirm they have data in column A
- Try reloading the spreadsheet

### "Import tab shows nothing after dropping a CSV in Drive"
- Make sure the file is actually a `.csv` file (not `.xlsx` or `.pdf`)
- Click **OstéoPeinture → Check Bank Export Folder Now** to trigger it manually (don't wait for the hourly check)
- Check that the folder ID in Script Properties matches the actual Drive folder — run `setupScriptProperties()` again if unsure

### "Wrong bank detected / amounts look wrong"
- Open the CSV in a text editor and check the first line — does it have column headers?
- CIBC has no headers (data starts on line 1) — if your CIBC export suddenly has headers, the detection will fail
- Contact Loric or check `import-csv.gs` — the detection rules are in the `detectBank()` function

### "Row pushed to Transactions but amount sign is wrong"
- Positive = money flowing into that account. Negative = money flowing out.
- RBC: deposits should be positive, withdrawals negative
- BMO MC: charges should be negative (money out), payments to the card should be positive
- If signs are flipped for a whole bank, the parser needs a sign correction — flag it

### "Duplicate rows appearing in Transactions"
- The duplicate check compares Date + Amount + Description
- If a row slipped through as duplicate, find it in Transactions and delete the extra row manually
- The duplicate detection is a safety check, not a guarantee — always review before pushing

### "The script stopped running / hourly trigger disappeared"
- Google Apps Script triggers can lapse if the authorization expires
- Go to Extensions → Apps Script → Triggers (clock icon on left)
- If the hourly trigger is gone, run `installTrigger()` again

---

## Notes

- **Never modify the existing 2025 sheet.** It is your historical record. This 2026 sheet is separate.
- **Opening balances:** Before you start entering 2026 transactions, you'll need to enter one row per account in Transactions dated `2025-12-31`, Category = Transfer, Transfer Type = Opening Balance. This establishes the starting position. Ask Claude to help you calculate the correct figures when you're ready.
- **CIBC format:** If CIBC ever changes their CSV export format, the import script will stop recognizing it. Drop a new sample CSV to Claude and the parser can be updated in under 10 minutes.
- **Backing up:** Google Sheets autosaves. For extra safety, File → Download → Excel format monthly to your local drive.

---

*OstéoPeinture 2026 Finance System. Built April 2026.*
