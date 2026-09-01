# Story 4/7 of #276. The pairwise "who owes whom" view is a derived read
# model, not the ledger itself (docs/architecture.md §3) — the server
# reconstructs directed edges from each entry's payer
# (GET /groups/{id}/pairwise-balances), and the client renders them raw.
# This is the only tier that can catch the two disagreeing about direction
# or amount.
Feature: Reading who owes whom

  Scenario: The pairwise view names the debtor, creditor, and amount
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥2000 for "lunch" split equally
    And Aoi adds an expense of ¥600 for "coffee" split equally
    And someone checks who owes whom
    # Aoi's 1000-yen share of lunch nets against Yuto's 300-yen share of
    # coffee — two entries, two different payers, one netted directed edge.
    # Only correct if the derivation nets across both entries rather than
    # just reflecting whichever entry landed last.
    Then Aoi owes Yuto ¥700

  Scenario: Once every balance is ¥0, the page says everyone's settled
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥1000 for "lunch" split equally
    And Aoi adds an expense of ¥1000 for "coffee" split equally
    And someone checks who owes whom
    # Two equal-and-opposite shares net to exactly zero — real ledger
    # activity that settles, not an untouched group. A brand-new group
    # never reaches this screen at all: the group page's own empty-ledger
    # state (isEmpty = entries.length === 0, page.tsx) preempts BalanceList
    # — and with it the "Who owes whom" link — until at least one entry
    # exists.
    Then the group is settled up
