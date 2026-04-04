"""
mirror-entries.py
OstéoPeinture 2026 — Double-Entry Mirror Generator

Given a list of bank-imported transactions, generates the counterpart
(mirror) entry for every Transfer-category row.

Rules:
- Only Transfer-category rows get mirrors
- P&L categories (Revenue, Expenses) do NOT get mirrors — they're single-entry
- If both sides of a transfer are already imported (e.g. RBC outflow + BMO inflow
  for a CC payment), skip — don't create a third row

Mirror account mapping:
  Transfer Type          | Mirror Account
  -----------------------|------------------
  Owner Advance          | Owner: {name from description}
  Owner Reimbursement    | Owner: {name from description}
  Owner Payment          | Owner: {name from description}
  Owner Draw             | Owner: {name from description}
  Credit Card Payment    | BMO MC (if source is RBC) or RBC (if source is BMO)
  Third Party Transfer   | Inferred from description (ATM → Cash, Fred → n/a)
  Client Payment         | Receivable: Client
  Loan Received          | Loan: Alex
  Loan Repayment         | Loan: Alex

Owner name resolution from descriptions:
  "Loric" / "St-Onge"       → Owner: Loric
  "Graeme" / "Hanley"       → Owner: Graeme
  "Lyubomir" / "Zehtinski"  → Owner: Lubo
  "BOSS" / "Shah"           → Owner: BOSS

Usage:
  This module is imported by the import pipeline. Call generate_mirrors()
  with a list of transaction dicts and it returns the mirror entries.
"""

import re
import json

# Owner name patterns → account mapping
OWNER_PATTERNS = [
    (r'loric|st-onge|st.onge', 'Owner: Loric'),
    (r'graeme|hanley', 'Owner: Graeme'),
    (r'lyubomir|zehtinski|lubo', 'Owner: Lubo'),
    (r'boss|shah', 'Owner: BOSS'),
]


def resolve_owner(description):
    """Extract owner account from transaction description."""
    desc_lower = description.lower()
    for pattern, account in OWNER_PATTERNS:
        if re.search(pattern, desc_lower):
            return account
    return None


def is_paired(txn, all_txns):
    """
    Check if this transfer already has its counterpart in the dataset.
    E.g. RBC -2312.69 "BMO MASTERCD" paired with BMO MC +2312.69 "PAYMENT RECEIVED"
    Match on: same date, opposite amount (within $0.01), different account.
    """
    for other in all_txns:
        if other is txn:
            continue
        if (other['date'] == txn['date'] and
            other['account'] != txn['account'] and
            abs(other['amount'] + txn['amount']) < 0.02 and
            other['category'] == 'Transfer'):
            return True
    return False


def generate_mirrors(transactions):
    """
    Given a list of transaction dicts, return mirror entries for Transfer rows.

    Each transaction dict must have:
      date, description, account, amount, category, transfer_type, month, job, source

    Returns a list of mirror transaction dicts.
    """
    transfers = [t for t in transactions if t.get('category') == 'Transfer']
    mirrors = []

    for txn in transfers:
        # Skip if both sides already exist
        if is_paired(txn, transactions):
            continue

        tt = txn.get('transfer_type', '')
        desc = txn.get('description', '')
        account = txn.get('account', '')
        amount = txn.get('amount', 0)

        # Determine mirror account
        mirror_account = None

        if tt in ('Owner Advance', 'Owner Reimbursement', 'Owner Payment', 'Owner Draw'):
            mirror_account = resolve_owner(desc)

        elif tt == 'Credit Card Payment':
            if account == 'RBC':
                mirror_account = 'BMO MC'
            elif account == 'BMO MC':
                mirror_account = 'RBC'

        elif tt == 'Third Party Transfer':
            # ATM withdrawals
            if re.search(r'retrait gab|atm|guichet', desc.lower()):
                mirror_account = 'Cash'
            # Bank to cash
            elif re.search(r'bank.?to.?cash|cash withdrawal', desc.lower()):
                mirror_account = 'Cash'

        elif tt == 'Client Payment':
            mirror_account = 'Receivable: Client'

        elif tt in ('Loan Received', 'Loan Repayment'):
            mirror_account = 'Loan: Alex'

        elif tt == 'Opening Balance':
            # Opening balances don't need mirrors — they're equity entries
            continue

        if not mirror_account:
            # Can't determine mirror account — flag for manual review
            print(f"WARNING: Cannot mirror row {txn.get('date')} | {account} | {amount} | {desc[:50]} — unknown counterpart")
            continue

        mirror = {
            'date': txn['date'],
            'description': f"[Mirror] {desc}",
            'account': mirror_account,
            'counterpart': account,
            'amount': -amount,
            'category': 'Transfer',
            'transfer_type': tt,
            'month': txn.get('month', ''),
            'job': txn.get('job', ''),
            'source': txn.get('source', 'Bank Import'),
        }
        mirrors.append(mirror)

    return mirrors


def mirrors_to_sheet_rows(mirrors):
    """Convert mirror dicts to sheet row arrays (for Sheets API)."""
    return [
        [
            m['date'], m['description'], m['account'], m['counterpart'],
            m['amount'], m['category'], m['transfer_type'],
            m['month'], m['job'], m['source']
        ]
        for m in mirrors
    ]


if __name__ == '__main__':
    # Example usage / test
    test_txns = [
        {'date': '2026-01-02', 'description': 'Virement envoyé — Graeme Hanley',
         'account': 'RBC', 'amount': -750.00, 'category': 'Transfer',
         'transfer_type': 'Owner Advance', 'month': '2026-01', 'job': '', 'source': 'Bank Import'},
        {'date': '2026-02-27', 'description': 'Retrait GAB - ME478365',
         'account': 'RBC', 'amount': -800.00, 'category': 'Transfer',
         'transfer_type': 'Third Party Transfer', 'month': '2026-02', 'job': '', 'source': 'Bank Import'},
    ]

    mirrors = generate_mirrors(test_txns)
    for m in mirrors:
        print(json.dumps(m, indent=2))
