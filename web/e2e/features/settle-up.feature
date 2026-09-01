# Story 5/7 of #276. This is the one flow where a write closes the loop
# back onto the read that proposed it: tapping "Mark paid" books a
# settlement entry, which changes the balances, which recomputes the plan
# the user is looking at (useSettlePlan.ts, 5s poll). It also pins #150's
# actual requirement — the settle page renders straight from the polled
# plan with no local copy — because that's the only thing that keeps a
# transfer a recompute has dropped from staying tappable.
Feature: Settling up on the proposed plan

  Scenario: Marking the proposed transfer paid settles the group
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥2000 for "dinner" split equally
    And someone views the settle plan
    # Yuto paid 2000 and owes his own 1000 share, so he's owed 1000; Aoi
    # owes her 1000 share outright. One expense, two members: the minimal
    # plan is unambiguous, so asserting it here doesn't pin a solver choice
    # the Go suite should own instead.
    Then the settle plan proposes:
      | from | to   | amount |
      | Aoi  | Yuto | ¥1,000 |
    When Aoi pays Yuto ¥1000
    Then the settle plan is empty
    When someone returns to the group
    # Two different read models: the plan emptying proves the UI reacted,
    # the balances reading ¥0 proves the settlement actually reached the
    # ledger. A settlement booked in the wrong direction would fail both —
    # it would widen Aoi's debt instead of clearing it.
    And the balances are:
      | member | balance |
      | Yuto   | ¥0      |
      | Aoi    | ¥0      |
