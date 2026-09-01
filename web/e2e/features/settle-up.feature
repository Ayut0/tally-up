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

  Scenario: Marking one of several transfers paid leaves the rest of the plan intact
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
      | Ren  |
    When Yuto adds an expense of ¥3000 for "dinner" split equally
    And someone views the settle plan
    # Yuto is the sole payer, so both Aoi and Ren owe their 1000-yen share
    # straight to him — the minimal plan is exactly these two transfers,
    # unambiguous regardless of solver ordering.
    Then the settle plan proposes:
      | from | to   | amount |
      | Aoi  | Yuto | ¥1,000 |
      | Ren  | Yuto | ¥1,000 |
    When Aoi pays Yuto ¥1000
    # The one-transfer scenario above can't tell a correct recompute apart
    # from a buggy local copy that just always shows whatever it last saw —
    # there's nothing left to have kept. With two transfers, this is real
    # proof of #150: exactly the paid row drops, the other stays untouched.
    Then the settle plan no longer proposes Aoi pays Yuto
    And the settle plan proposes:
      | from | to   | amount |
      | Ren  | Yuto | ¥1,000 |
    When someone returns to the group
    # Aoi's share is cleared but Ren's isn't — a genuinely partial
    # settlement, not the group's end state, which is what makes this a
    # different case from the scenario above rather than a rerun of it.
    And the balances are:
      | member | balance |
      | Yuto   | +¥1,000 |
      | Aoi    | ¥0      |
      | Ren    | −¥1,000 |

  Scenario: A transfer marked paid on one phone disappears from another's open plan
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    # Aoi's own phone — a second browser that has never seen this group —
    # joins early, the way a real second phone would: the invite link, then
    # picking who she is (issue #277's fixture). Deliberately before Yuto's
    # own browser navigates anywhere else — the invite link is just Yuto's
    # current URL (docs/architecture.md §2), so a second phone must open it
    # while that's still the group page, not wherever Yuto has since gone.
    When a second phone opens the invite link
    And picks Aoi
    And Yuto adds an expense of ¥2000 for "dinner" split equally
    And someone views the settle plan
    Then the settle plan proposes:
      | from | to   | amount |
      | Aoi  | Yuto | ¥1,000 |
    When the second phone views the settle plan
    And the second phone marks Aoi pays Yuto ¥1000
    # Only Aoi's phone made the write. Yuto's browser is still sitting on
    # the plan it fetched earlier — the only thing that can make it agree
    # is its own next poll landing, never a page reload it never asked for.
    # That's #150's actual defence against the two of them somehow
    # recording the same handover twice: whoever looks second sees it's
    # already gone, rather than being free to tap a stale row.
    Then the settle plan no longer proposes Aoi pays Yuto
