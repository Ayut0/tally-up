# The proving feature for the E2E tier (docs/adr/0006-gherkin-e2e-tier.md).
# It is deliberately written in the domain's vocabulary — group, member,
# expense, split, balance — not the UI's. Nothing here names a button, a
# field, or a route; that mapping lives in e2e/steps and e2e/screens, so a
# redesign of a screen changes the step, never this file.
Feature: Splitting an expense across a group

  The ledger is the truth. A balance is never stored as mutable state — it is
  derived by replaying every entry ever written (docs/architecture.md). This
  feature proves that end to end: through a real browser, the Next.js client,
  the Go API, and Postgres, with nothing mocked.

  Scenario: An equal split leaves the payer owed and the others owing
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
      | Ren  |
    When Yuto adds an expense of ¥3000 for "dinner" split equally
    # Postings always sum to zero: Yuto paid 3000 and owes his own 1000 share,
    # so he is owed 2000; the other two owe 1000 each.
    Then the balances are:
      | member | balance |
      | Yuto   | +¥2,000 |
      | Aoi    | −¥1,000 |
      | Ren    | −¥1,000 |
    And the history shows "dinner" paid by Yuto
