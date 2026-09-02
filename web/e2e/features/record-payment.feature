# Story 6/7 of #276. Real money doesn't arrive in the amounts a solver
# proposes — partial, rounded, or fronted by someone else. #161 added
# record-payment as the escape hatch for exactly that, deep-linked from the
# settle plan with payer and counterparty prefilled.
#
# A partial payment is the sharpest available check that a settlement is a
# normal ledger entry, not a "mark settled" flag: after ¥600 of a ¥1,000
# debt, the balance must be exactly ¥400 and the settle plan must propose
# the smaller remainder. A boolean-flag implementation would pass every
# unit test in the repo and fail this scenario.
Feature: Recording a payment that isn't on the plan

  Scenario: A partial payment leaves the remainder owed and on the plan
    Given a group named "Kyoto trip" with members:
      | name |
      | Yuto |
      | Aoi  |
    When Yuto adds an expense of ¥2000 for "dinner" split equally
    And someone views the settle plan
    Then the settle plan proposes:
      | from | to   | amount |
      | Aoi  | Yuto | ¥1,000 |
    # Reached via the settle plan's own link, not a raw goto — that's what
    # makes this a user's path, and the only way to actually exercise the
    # deep link (?payer=Aoi&counterparty=Yuto) rather than assume it's wired.
    When Aoi asks to pay Yuto a different amount
    # Asserted before anything is typed. A step that fills every field
    # itself would pass whether or not the query params were ever read.
    Then the payment form is prefilled with payer Aoi and counterparty Yuto
    When Aoi pays Yuto ¥600 with memo "cash tonight"
    # Aoi handed over 600 of the 1,000 she owed: her balance moves by
    # exactly that amount, not to zero — the remaining ¥400 is a fact the
    # ledger now holds, not something a boolean flag could represent.
    Then the balances are:
      | member | balance |
      | Yuto   | +¥400   |
      | Aoi    | −¥400   |
    When someone views the settle plan
    # The plan proposes the smaller remainder, not the original ¥1,000 —
    # proof the settlement posted as a real amount, not a "settled" marker
    # that would have zeroed the whole debt regardless of what was paid.
    Then the settle plan proposes:
      | from | to   | amount |
      | Aoi  | Yuto | ¥400   |
    When someone returns to the group
    And the history shows "cash tonight" paid by Aoi
